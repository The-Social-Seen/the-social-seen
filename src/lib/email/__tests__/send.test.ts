import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Mocks ──────────────────────────────────────────────────────────────────

// Mock the Resend client BEFORE importing send.ts.
const mockResendSend = vi.fn()

vi.mock('@/lib/email/resend', () => ({
  getResendClient: () => ({
    emails: { send: mockResendSend },
  }),
}))

// Mock the admin Supabase client used for audit logging.
const mockNotificationsInsert = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      insert: mockNotificationsInsert,
    }),
  }),
}))

// We override SANDBOX_FALLBACK_RECIPIENT per-test by re-stubbing the
// config module. Default export here matches the production-undefined case
// so individual tests can opt in to sandbox mode explicitly.
let sandboxFallback: string | undefined = undefined
vi.mock('@/lib/email/config', () => ({
  get FROM_ADDRESS() {
    return 'The Social Seen <test@example.com>'
  },
  get REPLY_TO_ADDRESS() {
    return 'replies@example.com'
  },
  get SANDBOX_FALLBACK_RECIPIENT() {
    return sandboxFallback
  },
}))

import { sendEmail } from '../send'

// ── Tests ──────────────────────────────────────────────────────────────────

describe('sendEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sandboxFallback = undefined
    mockNotificationsInsert.mockResolvedValue({ data: null, error: null })
  })

  afterEach(() => {
    sandboxFallback = undefined
  })

  // ── Happy path ──────────────────────────────────────────────────────────
  it('returns success with messageId when Resend accepts the send', async () => {
    mockResendSend.mockResolvedValue({
      data: { id: 'msg_abc123' },
      error: null,
    })

    const result = await sendEmail({
      to: 'recipient@example.com',
      subject: 'Hello',
      html: '<p>Hi</p>',
      templateName: 'welcome',
    })

    expect(result).toEqual({ success: true, messageId: 'msg_abc123' })
    expect(mockResendSend).toHaveBeenCalledTimes(1)
  })

  it('passes the FROM, replyTo, and tags through to Resend', async () => {
    mockResendSend.mockResolvedValue({ data: { id: 'msg_1' }, error: null })

    await sendEmail({
      to: 'recipient@example.com',
      subject: 'Test',
      html: '<p>Body</p>',
      text: 'Body',
      templateName: 'welcome',
      tags: [{ name: 'k', value: 'v' }],
    })

    expect(mockResendSend).toHaveBeenCalledWith({
      from: 'The Social Seen <test@example.com>',
      to: ['recipient@example.com'],
      replyTo: 'replies@example.com',
      subject: 'Test',
      html: '<p>Body</p>',
      text: 'Body',
      tags: [{ name: 'k', value: 'v' }],
    })
  })

  // ── Sandbox redirect ────────────────────────────────────────────────────
  it('redirects to SANDBOX_FALLBACK_RECIPIENT when set', async () => {
    sandboxFallback = 'sandbox@example.com'
    mockResendSend.mockResolvedValue({ data: { id: 'msg_x' }, error: null })

    await sendEmail({
      to: 'real-user@example.com',
      subject: 'Hello',
      html: '<p>Hi</p>',
      templateName: 'welcome',
    })

    const call = mockResendSend.mock.calls[0][0]
    expect(call.to).toEqual(['sandbox@example.com'])
    // Subject is prefixed so we can see who it would have gone to
    expect(call.subject).toBe('[\u2192 real-user@example.com] Hello')
  })

  it('does NOT redirect when SANDBOX_FALLBACK_RECIPIENT is undefined', async () => {
    sandboxFallback = undefined
    mockResendSend.mockResolvedValue({ data: { id: 'msg_y' }, error: null })

    await sendEmail({
      to: 'real-user@example.com',
      subject: 'Hello',
      html: '<p>Hi</p>',
      templateName: 'welcome',
    })

    const call = mockResendSend.mock.calls[0][0]
    expect(call.to).toEqual(['real-user@example.com'])
    expect(call.subject).toBe('Hello')
  })

  // ── Error handling ──────────────────────────────────────────────────────
  it('returns error when Resend returns an error object', async () => {
    mockResendSend.mockResolvedValue({
      data: null,
      error: { message: 'validation_error: invalid recipient' },
    })

    const result = await sendEmail({
      to: 'bad@example.com',
      subject: 'X',
      html: '<p>X</p>',
      templateName: 'welcome',
    })

    expect(result).toEqual({
      success: false,
      error: 'validation_error: invalid recipient',
    })
  })

  it('returns error when Resend throws a network error', async () => {
    mockResendSend.mockRejectedValue(new Error('ECONNRESET'))

    const result = await sendEmail({
      to: 'recipient@example.com',
      subject: 'X',
      html: '<p>X</p>',
      templateName: 'welcome',
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toContain('ECONNRESET')
    }
  })

  it('returns error when Resend returns no message id', async () => {
    mockResendSend.mockResolvedValue({ data: {}, error: null })

    const result = await sendEmail({
      to: 'recipient@example.com',
      subject: 'X',
      html: '<p>X</p>',
      templateName: 'welcome',
    })

    expect(result.success).toBe(false)
  })

  // ── Retry behaviour ─────────────────────────────────────────────────────
  it('retries once on transient (non-permanent) failure', async () => {
    // First call: transient network error. Second call: success.
    mockResendSend
      .mockResolvedValueOnce({
        data: null,
        error: { message: 'connection reset' },
      })
      .mockResolvedValueOnce({ data: { id: 'msg_retry' }, error: null })

    const result = await sendEmail({
      to: 'recipient@example.com',
      subject: 'X',
      html: '<p>X</p>',
      templateName: 'welcome',
    })

    expect(result).toEqual({ success: true, messageId: 'msg_retry' })
    expect(mockResendSend).toHaveBeenCalledTimes(2)
  })

  it('does NOT retry on permanent (4xx-style) failure', async () => {
    mockResendSend.mockResolvedValue({
      data: null,
      error: { message: 'validation_error: bad recipient' },
    })

    await sendEmail({
      to: 'recipient@example.com',
      subject: 'X',
      html: '<p>X</p>',
      templateName: 'welcome',
    })

    expect(mockResendSend).toHaveBeenCalledTimes(1)
  })

  it('does NOT retry on rate-limit', async () => {
    mockResendSend.mockResolvedValue({
      data: null,
      error: { message: 'rate limit exceeded' },
    })

    await sendEmail({
      to: 'recipient@example.com',
      subject: 'X',
      html: '<p>X</p>',
      templateName: 'welcome',
    })

    expect(mockResendSend).toHaveBeenCalledTimes(1)
  })

  // ── Audit logging ────────────���──────────────────────────────────────────
  it('writes a notifications audit row with status=sent on success', async () => {
    mockResendSend.mockResolvedValue({ data: { id: 'msg_log' }, error: null })

    await sendEmail({
      to: 'recipient@example.com',
      subject: 'Hello',
      html: '<p>Hi</p>',
      templateName: 'welcome',
      relatedProfileId: 'user-1',
    })

    expect(mockNotificationsInsert).toHaveBeenCalledTimes(1)
    const row = mockNotificationsInsert.mock.calls[0][0]
    expect(row).toMatchObject({
      sent_by: 'user-1',
      channel: 'email',
      status: 'sent',
      provider_message_id: 'msg_log',
      template_name: 'welcome',
      recipient_email: 'recipient@example.com',
      error_message: null,
    })
  })

  it('writes a notifications audit row with status=failed on failure', async () => {
    mockResendSend.mockResolvedValue({
      data: null,
      error: { message: 'validation_error' },
    })

    await sendEmail({
      to: 'bad@example.com',
      subject: 'X',
      html: '<p>X</p>',
      templateName: 'booking_confirmation',
    })

    const row = mockNotificationsInsert.mock.calls[0][0]
    expect(row).toMatchObject({
      channel: 'email',
      status: 'failed',
      error_message: 'validation_error',
      template_name: 'booking_confirmation',
      provider_message_id: null,
    })
    // sent_by is null when relatedProfileId is omitted (system email)
    expect(row.sent_by).toBeNull()
  })

  it('logs the post-redirect recipient_email when sandbox is active', async () => {
    sandboxFallback = 'sandbox@example.com'
    mockResendSend.mockResolvedValue({ data: { id: 'msg_z' }, error: null })

    await sendEmail({
      to: 'real-user@example.com',
      subject: 'Hello',
      html: '<p>Hi</p>',
      templateName: 'welcome',
    })

    const row = mockNotificationsInsert.mock.calls[0][0]
    expect(row.recipient_email).toBe('sandbox@example.com')
  })

  it('does NOT throw when the audit-log insert fails', async () => {
    mockResendSend.mockResolvedValue({ data: { id: 'msg_q' }, error: null })
    mockNotificationsInsert.mockRejectedValue(new Error('DB down'))

    // The send result should still be returned cleanly.
    const result = await sendEmail({
      to: 'recipient@example.com',
      subject: 'X',
      html: '<p>X</p>',
      templateName: 'welcome',
    })

    expect(result).toEqual({ success: true, messageId: 'msg_q' })
  })
})
