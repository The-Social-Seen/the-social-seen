import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockAdminFrom = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: mockAdminFrom }),
}))

const mockSendEmail = vi.fn()
vi.mock('@/lib/email/send', () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
}))

// Turnstile fails open when unconfigured — match that default.
vi.mock('@/lib/turnstile/verify', () => ({
  extractTurnstileToken: () => null,
  verifyTurnstileToken: async () => ({ ok: true }),
}))

vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
}))

// Brevo sync — confirm flow calls upsertContact; skip real network.
const mockUpsertContact = vi.fn()
const mockRemoveFromList = vi.fn()
vi.mock('@/lib/brevo/sync', () => ({
  upsertContact: (...args: unknown[]) => mockUpsertContact(...args),
  removeFromList: (...args: unknown[]) => mockRemoveFromList(...args),
}))

function chain(final: { data?: unknown; error?: unknown }) {
  const c: Record<string, ReturnType<typeof vi.fn>> = {}
  for (const m of [
    'select',
    'insert',
    'update',
    'upsert',
    'eq',
    'ilike',
    'maybeSingle',
    'single',
  ]) {
    c[m] = vi.fn().mockReturnValue(c)
  }
  c.maybeSingle = vi.fn().mockResolvedValue(final)
  c.single = vi.fn().mockResolvedValue(final)
  c.upsert = vi.fn().mockResolvedValue(final)
  c.update = vi.fn().mockReturnValue({
    ...c,
    ilike: vi.fn().mockResolvedValue(final),
    eq: vi.fn().mockResolvedValue(final),
  })
  return c
}

import {
  subscribeToNewsletter,
  confirmNewsletter,
} from '../actions'
import { issueNewsletterToken } from '@/lib/email/newsletter-token'

beforeEach(() => {
  vi.resetAllMocks()
  mockSendEmail.mockResolvedValue({ success: true, messageId: 'm-1' })
  mockUpsertContact.mockResolvedValue({ success: true, brevoContactId: 42 })
  process.env.UNSUBSCRIBE_TOKEN_SECRET =
    'deterministic-test-secret-for-newsletter-actions-12345'
  process.env.NEXT_PUBLIC_SITE_URL = 'https://test.example.com'
})

function makeForm(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData()
  fd.set('email', 'user@example.com')
  fd.set('source', 'footer')
  for (const [k, v] of Object.entries(overrides)) fd.set(k, v)
  return fd
}

describe('subscribeToNewsletter', () => {
  it('silently succeeds when the honeypot is filled (bot defence)', async () => {
    const result = await subscribeToNewsletter(
      makeForm({ company_website: 'http://bot.example.com' }),
    )
    expect(result.success).toBe(true)
    // No DB access, no email dispatch — silent short-circuit.
    expect(mockAdminFrom).not.toHaveBeenCalled()
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('surfaces a validation error on a malformed email', async () => {
    const result = await subscribeToNewsletter(makeForm({ email: 'not-an-email' }))
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.toLowerCase()).toContain('email')
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('short-circuits with a friendly message when the email is already confirmed', async () => {
    // First query (exists-check) returns status='confirmed'.
    mockAdminFrom.mockImplementation(() =>
      chain({
        data: { id: 'sub-1', status: 'confirmed' },
        error: null,
      }),
    )
    const result = await subscribeToNewsletter(makeForm())
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.message.toLowerCase()).toContain('already subscribed')
    }
    // No upsert, no confirmation email — we don't resubscribe the user.
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('upserts pending + dispatches confirmation email for a new signup', async () => {
    let callIdx = 0
    mockAdminFrom.mockImplementation(() => {
      callIdx++
      // 1st call: exists-check → returns null.
      if (callIdx === 1) return chain({ data: null, error: null })
      // 2nd call: upsert → success.
      return chain({ data: null, error: null })
    })

    const result = await subscribeToNewsletter(makeForm())

    expect(result.success).toBe(true)
    expect(mockAdminFrom).toHaveBeenCalledTimes(2)
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
    const [sendArgs] = mockSendEmail.mock.calls
    expect(sendArgs[0]).toMatchObject({
      to: 'user@example.com',
      templateName: 'newsletter_confirm',
    })
  })

  it('upserts pending + re-sends confirmation when a pending row already exists (repeat subscribe)', async () => {
    // Exists-check returns existing pending → upsert proceeds,
    // confirmation email re-sent. This is the regression test for
    // the onConflict fix.
    let callIdx = 0
    mockAdminFrom.mockImplementation(() => {
      callIdx++
      if (callIdx === 1) {
        return chain({
          data: { id: 'sub-existing', status: 'pending' },
          error: null,
        })
      }
      return chain({ data: null, error: null })
    })

    const result = await subscribeToNewsletter(makeForm())

    expect(result.success).toBe(true)
    // Upsert fired, confirmation email re-sent.
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
  })
})

describe('confirmNewsletter', () => {
  it('rejects an invalid token before touching the DB', async () => {
    const result = await confirmNewsletter('not-a-real-token')
    expect(result.success).toBe(false)
    expect(mockAdminFrom).not.toHaveBeenCalled()
  })

  it('flips status to confirmed and syncs to Brevo on valid token', async () => {
    const token = issueNewsletterToken('user@example.com', 'confirm')
    mockAdminFrom.mockImplementation(() =>
      chain({ data: null, error: null }),
    )

    const result = await confirmNewsletter(token)

    expect(result.success).toBe(true)
    if (result.success) expect(result.email).toBe('user@example.com')
    expect(mockUpsertContact).toHaveBeenCalledTimes(1)
    expect(mockUpsertContact.mock.calls[0][0]).toMatchObject({
      email: 'user@example.com',
    })
  })

  it('rejects an unsubscribe-action token on the confirm endpoint', async () => {
    const token = issueNewsletterToken('user@example.com', 'unsubscribe')
    const result = await confirmNewsletter(token)
    expect(result.success).toBe(false)
    expect(mockAdminFrom).not.toHaveBeenCalled()
  })
})
