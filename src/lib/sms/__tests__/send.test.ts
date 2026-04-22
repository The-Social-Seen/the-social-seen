import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock the admin client. Tests build a chain-of-calls for each scenario.
const mockAdminFrom = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: mockAdminFrom }),
}))

// Twilio client singleton mock. The real `twilio.messages.create` is
// replaced per-test.
const mockMessagesCreate = vi.fn()
vi.mock('../twilio', () => ({
  getTwilioClient: () => ({
    messages: { create: mockMessagesCreate },
  }),
}))

// Mock ./config so tests don't depend on process.env vars being set
// before the send module is evaluated.
vi.mock('../config', () => ({
  TWILIO_SENDER_ID: 'SocialSeen',
  SMS_SANDBOX_FALLBACK_RECIPIENT: undefined,
  isSmsConfigured: () => true,
}))

beforeEach(() => {
  vi.resetAllMocks()
})

afterEach(() => {
  // Nothing to restore — env vars aren't read by the mocked config.
})

function chain(response: { data?: unknown; error?: unknown }) {
  const c: Record<string, ReturnType<typeof vi.fn>> = {}
  for (const m of ['select', 'insert', 'eq', 'maybeSingle']) {
    c[m] = vi.fn().mockReturnValue(c)
  }
  c.maybeSingle = vi.fn().mockResolvedValue(response)
  return c
}

import { sendSms, SUPPRESSED_NO_CONSENT, SUPPRESSED_NO_PHONE } from '../send'

describe('sendSms preference + consent gating', () => {
  it('returns SUPPRESSED_NO_CONSENT when sms_consent is false', async () => {
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return chain({
          data: { sms_consent: false, phone_number: '+447123456789' },
          error: null,
        })
      }
      return chain({ data: null, error: null })
    })

    const result = await sendSms({
      to: '+447123456789',
      body: 'hi',
      templateName: 'venue_reveal_sms',
      relatedProfileId: 'u1',
      recipientUserId: 'u1',
    })

    expect(result.success).toBe(false)
    if (!result.success) expect(result.error).toBe(SUPPRESSED_NO_CONSENT)
    // Twilio must NOT be called when consent is missing.
    expect(mockMessagesCreate).not.toHaveBeenCalled()
  })

  it('returns SUPPRESSED_NO_PHONE when phone_number is null', async () => {
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return chain({
          data: { sms_consent: true, phone_number: null },
          error: null,
        })
      }
      return chain({ data: null, error: null })
    })

    const result = await sendSms({
      to: '',
      body: 'hi',
      templateName: 'venue_reveal_sms',
      relatedProfileId: 'u2',
      recipientUserId: 'u2',
    })

    expect(result.success).toBe(false)
    if (!result.success) expect(result.error).toBe(SUPPRESSED_NO_PHONE)
    expect(mockMessagesCreate).not.toHaveBeenCalled()
  })

  it('sends when sms_consent is true and phone_number is set', async () => {
    let insertCalled = false
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return chain({
          data: { sms_consent: true, phone_number: '+447123456789' },
          error: null,
        })
      }
      if (table === 'notifications') {
        insertCalled = true
        return chain({ data: null, error: null })
      }
      return chain({ data: null, error: null })
    })
    mockMessagesCreate.mockResolvedValue({ sid: 'SMabc123' })

    const result = await sendSms({
      to: '+447123456789',
      body: 'Venue reveal',
      templateName: 'venue_reveal_sms',
      relatedProfileId: 'u3',
      recipientUserId: 'u3',
    })

    expect(result.success).toBe(true)
    if (result.success) expect(result.messageSid).toBe('SMabc123')
    expect(mockMessagesCreate).toHaveBeenCalledTimes(1)
    expect(insertCalled).toBe(true) // audit row written
  })

  it('normalises UK 07... numbers to +44 E.164 before sending', async () => {
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return chain({
          // Stored as UK national 07... — Twilio would reject this as-is.
          data: { sms_consent: true, phone_number: '07123456789' },
          error: null,
        })
      }
      return chain({ data: null, error: null })
    })
    mockMessagesCreate.mockResolvedValue({ sid: 'SMnorm' })

    const result = await sendSms({
      to: '07123456789',
      body: 'x',
      templateName: 'venue_reveal_sms',
      relatedProfileId: 'u5',
      recipientUserId: 'u5',
    })

    expect(result.success).toBe(true)
    expect(mockMessagesCreate).toHaveBeenCalledTimes(1)
    const sentPayload = mockMessagesCreate.mock.calls[0]?.[0] as { to: string }
    expect(sentPayload.to).toBe('+447123456789')
  })

  it('leaves E.164 numbers (+44...) untouched', async () => {
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return chain({
          data: { sms_consent: true, phone_number: '+447123456789' },
          error: null,
        })
      }
      return chain({ data: null, error: null })
    })
    mockMessagesCreate.mockResolvedValue({ sid: 'SMe164' })

    await sendSms({
      to: '+447123456789',
      body: 'x',
      templateName: 'venue_reveal_sms',
      relatedProfileId: 'u6',
      recipientUserId: 'u6',
    })

    const sentPayload = mockMessagesCreate.mock.calls[0]?.[0] as { to: string }
    expect(sentPayload.to).toBe('+447123456789')
  })

  it('writes a failed audit row when Twilio rejects', async () => {
    let notifInsertCount = 0
    let notifInsertedStatus: string | null = null
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return chain({
          data: { sms_consent: true, phone_number: '+447123456789' },
          error: null,
        })
      }
      if (table === 'notifications') {
        notifInsertCount++
        const c = chain({ data: null, error: null })
        c.insert = vi.fn((payload: { status?: string }) => {
          notifInsertedStatus = payload.status ?? null
          return c
        })
        return c
      }
      return chain({ data: null, error: null })
    })
    mockMessagesCreate.mockRejectedValue(new Error('Invalid phone number'))

    const result = await sendSms({
      to: '+44bogus',
      body: 'x',
      templateName: 'venue_reveal_sms',
      relatedProfileId: 'u4',
      recipientUserId: 'u4',
    })

    expect(result.success).toBe(false)
    expect(notifInsertCount).toBe(1)
    expect(notifInsertedStatus).toBe('failed')
  })
})
