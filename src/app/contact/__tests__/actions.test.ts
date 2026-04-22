import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the email send wrapper. Each test asserts the inputs we pass to
// it (recipient, replyTo, template, subject) — the actual provider call
// is exercised in src/lib/email/__tests__/send.test.ts.
const mockSendEmail = vi.fn()
vi.mock('@/lib/email/send', () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
}))

// Pin the support inbox so the assertions are stable across env changes.
vi.mock('@/lib/email/config', () => ({
  REPLY_TO_ADDRESS: 'info@the-social-seen.com',
}))

import {
  sendContactMessage,
  sendCollaborationPitch,
} from '../actions'

const FAR_PAST = String(Date.now() - 60_000) // 60s ago — well past the 2s gate.

function makeContactForm(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData()
  fd.set('name', 'Charlotte Davis')
  fd.set('email', 'charlotte@example.com')
  fd.set('subject', 'general')
  fd.set('message', 'Hello — would love to know more about membership.')
  fd.set('ts', FAR_PAST)
  // Honeypot left empty.
  for (const [k, v] of Object.entries(overrides)) fd.set(k, v)
  return fd
}

function makeCollabForm(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData()
  fd.set('company_name', 'The Cellar Room')
  fd.set('contact_name', 'Anna Lee')
  fd.set('contact_email', 'anna@cellarroom.com')
  fd.set('collaboration_type', 'venue')
  fd.set('website', 'https://cellarroom.com')
  fd.set('message', 'We have a private dining space and would love to collaborate.')
  fd.set('ts', FAR_PAST)
  for (const [k, v] of Object.entries(overrides)) fd.set(k, v)
  return fd
}

beforeEach(() => {
  vi.clearAllMocks()
  mockSendEmail.mockResolvedValue({ success: true, messageId: 'msg-1' })
})

// ════════════════════════════════════════════════════════════════════════════
// sendContactMessage
// ════════════════════════════════════════════════════════════════════════════

describe('sendContactMessage', () => {
  it('happy path — calls sendEmail with REPLY_TO_ADDRESS as `to` and visitor email as `replyTo`', async () => {
    const result = await sendContactMessage(makeContactForm())
    expect(result).toEqual({ success: true })
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
    expect(mockSendEmail.mock.calls[0][0]).toMatchObject({
      to: 'info@the-social-seen.com',
      replyTo: 'charlotte@example.com',
      templateName: 'contact_message',
    })
    expect(mockSendEmail.mock.calls[0][0].subject).toContain('Charlotte Davis')
  })

  it('honeypot trip silently returns success without sending', async () => {
    const fd = makeContactForm({ company_website: 'https://spammer.example' })
    const result = await sendContactMessage(fd)
    expect(result).toEqual({ success: true })
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('sub-2s timing trip silently returns success without sending', async () => {
    const fd = makeContactForm({ ts: String(Date.now() - 500) })
    const result = await sendContactMessage(fd)
    expect(result).toEqual({ success: true })
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('rejects an invalid email', async () => {
    const result = await sendContactMessage(
      makeContactForm({ email: 'not-an-email' }),
    )
    expect(result).toEqual({ error: expect.stringMatching(/email/i) })
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('rejects a too-short message', async () => {
    const result = await sendContactMessage(
      makeContactForm({ message: 'too short' }),
    )
    expect(result).toEqual({ error: expect.stringMatching(/Message/i) })
  })

  it('rejects a subject value outside the enum', async () => {
    const result = await sendContactMessage(
      makeContactForm({ subject: 'malware_install' }),
    )
    expect('error' in result).toBe(true)
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('rejects header-injection attempt via CRLF in name', async () => {
    const result = await sendContactMessage(
      makeContactForm({ name: 'Anna\r\nBcc: victim@example.com' }),
    )
    expect(result).toEqual({ error: expect.stringMatching(/Name.*line breaks/i) })
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('returns a generic error when the provider fails (does not leak provider message)', async () => {
    mockSendEmail.mockResolvedValue({
      success: false,
      error: 'Resend HTTP 500: internal',
    })
    const result = await sendContactMessage(makeContactForm())
    expect(result).toEqual({
      error: 'Could not send your message. Please try again shortly.',
    })
  })
})

// ════════════════════════════════════════════════════════════════════════════
// sendCollaborationPitch
// ════════════════════════════════════════════════════════════════════════════

describe('sendCollaborationPitch', () => {
  it('happy path — sends with replyTo set to contactEmail + tags include type', async () => {
    const result = await sendCollaborationPitch(makeCollabForm())
    expect(result).toEqual({ success: true })
    const call = mockSendEmail.mock.calls[0][0]
    expect(call.to).toBe('info@the-social-seen.com')
    expect(call.replyTo).toBe('anna@cellarroom.com')
    expect(call.templateName).toBe('collaboration_pitch')
    expect(call.tags).toEqual(
      expect.arrayContaining([
        { name: 'collaboration_type', value: 'venue' },
      ]),
    )
  })

  it('treats empty website as null (does not pass through to template)', async () => {
    await sendCollaborationPitch(makeCollabForm({ website: '' }))
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
    // Template would render the website row; here we just confirm the
    // call was made — template tests cover the render path.
  })

  it('rejects a website that lacks http(s)://', async () => {
    const result = await sendCollaborationPitch(
      makeCollabForm({ website: 'cellarroom.com' }),
    )
    expect(result).toEqual({
      error: expect.stringMatching(/Website must start with http/i),
    })
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('honeypot trip returns success silently', async () => {
    const fd = makeCollabForm({ company_website: 'spam' })
    const result = await sendCollaborationPitch(fd)
    expect(result).toEqual({ success: true })
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('rejects header-injection attempt via CRLF in companyName', async () => {
    const result = await sendCollaborationPitch(
      makeCollabForm({
        company_name: 'Cellar Room\r\nBcc: victim@example.com',
      }),
    )
    expect(result).toEqual({
      error: expect.stringMatching(/Company name.*line breaks/i),
    })
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('rejects CRLF in website even if it has http:// prefix', async () => {
    const result = await sendCollaborationPitch(
      makeCollabForm({
        website: 'https://cellarroom.com\r\nX-Inject: bad',
      }),
    )
    expect(result).toEqual({
      error: expect.stringMatching(/Website.*line breaks/i),
    })
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('rejects collaboration_type outside enum', async () => {
    const result = await sendCollaborationPitch(
      makeCollabForm({ collaboration_type: 'malware' }),
    )
    expect('error' in result).toBe(true)
    expect(mockSendEmail).not.toHaveBeenCalled()
  })
})
