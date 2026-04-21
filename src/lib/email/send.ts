/**
 * Typed wrapper around Resend's send API.
 *
 * Owns three responsibilities the raw client doesn't:
 *   1. Sandbox redirect — reroutes recipients while the Resend sending
 *      domain isn't verified (Resend rejects sends to non-account
 *      emails in sandbox mode).
 *   2. Retry on transient failure — one retry with backoff for HTTP 5xx
 *      / network errors. Permanent 4xx errors don't retry.
 *   3. Audit logging — every send (success or failure) is recorded in
 *      the `notifications` table for the future admin retry view.
 *
 * Never throws. Returns a discriminated union so callers handle errors
 * explicitly. Email failures must never break the triggering action
 * (welcome email failing must not break signup, etc.).
 */
import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  FROM_ADDRESS,
  REPLY_TO_ADDRESS,
  SANDBOX_FALLBACK_RECIPIENT,
} from './config'
import { getResendClient } from './resend'

export type EmailTag = { name: string; value: string }

export interface SendEmailInput {
  /** Real intended recipient. Will be redirected if sandbox is active. */
  to: string
  /** Plain subject — we may prefix it with the sandbox-redirect indicator. */
  subject: string
  /** Rendered HTML body. */
  html: string
  /** Plain-text fallback body. Recommended for spam filters and accessibility. */
  text?: string
  /** Resend tags for filtering in the dashboard. */
  tags?: EmailTag[]
  /**
   * Identifier for the template used. Logged to notifications.template_name
   * so the admin can filter "all welcome emails" or "all booking confirmations".
   */
  templateName: string
  /**
   * Optional profile id that this email relates to. Used as `sent_by` on
   * the notifications row when set. For system emails (e.g. cron-driven
   * reminders) leave undefined and the log row uses NULL.
   */
  relatedProfileId?: string
  /**
   * Optional FK to the recipient's profile. Set this for admin-initiated
   * sends (e.g. "Email All Attendees") so the GDPR scrub RPC can find
   * and redact the row by `recipient_user_id` when the user is deleted.
   */
  recipientUserId?: string
  /**
   * Optional FK to the event this email is about. Populated for
   * event-scoped sends (reminders, venue reveals, attendee
   * announcements). Helps admin filter/audit by event.
   */
  recipientEventId?: string
  /**
   * Notification recipient classification. Defaults to 'custom' (1:1
   * transactional). Set to 'event_attendees' for admin announcements
   * to a whole confirmed-attendee list.
   */
  recipientType?: 'all' | 'event_attendees' | 'waitlisted' | 'custom'
  /**
   * Notification type classification. Defaults to 'announcement' to
   * preserve previous behaviour. Use 'reminder' / 'event_update' /
   * 'waitlist' where appropriate for richer audit filtering.
   */
  notificationType?: 'reminder' | 'announcement' | 'waitlist' | 'event_update'
}

export type SendEmailResult =
  | { success: true; messageId: string }
  | { success: false; error: string }

const MAX_RETRIES = 1
const RETRY_BACKOFF_MS = 500

/**
 * Send a transactional email. Always returns a result — never throws.
 * The audit row is written regardless of success/failure.
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  // ── Apply sandbox redirect ───────────────────────────────────────────────
  const redirected = SANDBOX_FALLBACK_RECIPIENT !== undefined
  const actualRecipient = redirected
    ? SANDBOX_FALLBACK_RECIPIENT!
    : input.to
  const subjectWithPrefix = redirected
    ? `[\u2192 ${input.to}] ${input.subject}`
    : input.subject

  // ── Send with one retry for transient failures ───────────────────────────
  let attemptResult: SendEmailResult | null = null

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const result = await attemptSend({
      to: actualRecipient,
      subject: subjectWithPrefix,
      html: input.html,
      text: input.text,
      tags: input.tags,
    })

    attemptResult = result

    if (result.success) break

    // Don't retry on permanent failures (4xx errors). Resend's error
    // shape sometimes includes `statusCode`; we treat 4xx as permanent.
    if (isPermanentError(result.error)) break

    if (attempt < MAX_RETRIES) {
      await sleep(RETRY_BACKOFF_MS)
    }
  }

  const finalResult = attemptResult ?? {
    success: false,
    error: 'sendEmail completed without a result (unreachable)',
  }

  // ── Audit log — always written, success or failure ───────────────────────
  await logSendAttempt(input, actualRecipient, finalResult)

  return finalResult
}

// ── Internal helpers ───────────────────────────────────────────────────────

async function attemptSend(args: {
  to: string
  subject: string
  html: string
  text?: string
  tags?: EmailTag[]
}): Promise<SendEmailResult> {
  try {
    const resend = getResendClient()
    const { data, error } = await resend.emails.send({
      from: FROM_ADDRESS,
      to: [args.to],
      replyTo: REPLY_TO_ADDRESS,
      subject: args.subject,
      html: args.html,
      text: args.text,
      tags: args.tags,
    })

    if (error) {
      return { success: false, error: error.message }
    }
    if (!data?.id) {
      return { success: false, error: 'Resend returned no message id' }
    }
    return { success: true, messageId: data.id }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { success: false, error: message }
  }
}

/**
 * Heuristic for "should we retry this?". Resend's error messages for
 * permanent issues typically mention "validation", "invalid", "rate limit",
 * or contain a 4xx status code.
 */
function isPermanentError(message: string): boolean {
  const lower = message.toLowerCase()
  if (
    lower.includes('validation') ||
    lower.includes('invalid') ||
    lower.includes('rate limit') ||
    lower.includes('forbidden') ||
    lower.includes('not found') ||
    lower.includes('unauthorized') ||
    lower.includes('unauthorised')
  ) {
    return true
  }
  // Status code hints (e.g. "HTTP 422", "status: 403")
  if (/\b4\d\d\b/.test(message)) return true
  return false
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Write the send attempt to the `notifications` table for audit trail
 * and the future admin retry view. Uses the admin client so it bypasses
 * RLS (the `notifications` policies are admin-only by design).
 *
 * Logging failures are swallowed — we never want a logging error to
 * break the triggering action. They're written to console.error for
 * Sentry to pick up, but the email send result is what we return.
 */
async function logSendAttempt(
  input: SendEmailInput,
  actualRecipient: string,
  result: SendEmailResult,
): Promise<void> {
  try {
    const admin = createAdminClient()
    await admin.from('notifications').insert({
      sent_by: input.relatedProfileId ?? null,
      recipient_type: input.recipientType ?? 'custom',
      recipient_event_id: input.recipientEventId ?? null,
      recipient_user_id: input.recipientUserId ?? null,
      type: input.notificationType ?? 'announcement',
      subject: input.subject,
      body: input.html,
      channel: 'email',
      recipient_email: actualRecipient,
      provider_message_id: result.success ? result.messageId : null,
      status: result.success ? 'sent' : 'failed',
      error_message: result.success ? null : result.error,
      template_name: input.templateName,
    })
  } catch (err) {
    // Logging is best-effort. Don't propagate.
    console.error(
      '[email/send] Failed to write notifications audit row:',
      err instanceof Error ? err.message : err,
    )
  }
}
