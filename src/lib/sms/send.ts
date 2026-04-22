import 'server-only'

/**
 * Typed wrapper around Twilio's message send API.
 *
 * Mirrors the design of src/lib/email/send.ts one-for-one:
 *   - Sandbox redirect for pre-launch testing (SMS_SANDBOX_FALLBACK_RECIPIENT).
 *   - Retry once on transient failure (5xx / network). Permanent errors
 *     short-circuit — no retry on "invalid number" / "unsubscribed".
 *   - Audit logging to `notifications` with channel='sms'.
 *   - Preference check — skips sends to users who opted out of this
 *     category in `notification_preferences`. Returns sentinel
 *     SUPPRESSED_OPTED_OUT; no audit row written for suppressed sends
 *     (matches the email wrapper's PECR-safe posture).
 *   - Consent check — ALSO checks profiles.sms_consent before every
 *     send. Even if preferenceCategory isn't set, an SMS send to a
 *     user who never opted in to SMS at signup is suppressed.
 *
 * Never throws. Returns a discriminated union so callers handle errors
 * explicitly.
 */
import { createAdminClient } from '@/lib/supabase/admin'
import { TWILIO_SENDER_ID, SMS_SANDBOX_FALLBACK_RECIPIENT } from './config'
import { getTwilioClient } from './twilio'
import { isSmsConfigured } from './config'
import type { NotificationCategory } from '@/lib/email/unsubscribe-token'

export interface SendSmsInput {
  /** Real intended recipient in E.164 (+44…). Sandbox redirect applies if set. */
  to: string
  /** SMS body. Keep under 160 GSM-7 chars to avoid segmentation. */
  body: string
  /**
   * Template identifier for audit. Free-form string that matches one
   * of the existing `notifications.template_name` values.
   */
  templateName: string
  /**
   * Profile id the SMS relates to. Used as `sent_by` on the audit row
   * (same convention as sendEmail). For cron-driven sends this is the
   * recipient's own profile id.
   */
  relatedProfileId: string
  /** FK to the recipient profile. Used by the GDPR scrub RPC. */
  recipientUserId: string
  /** FK to the event this SMS is about (reminders, venue reveals). */
  recipientEventId?: string
  /**
   * Marketing-category gate. Currently SMS is venue-reveal /
   * event-reminder only — both transactional — so this is unused in
   * v1. Reserved so future marketing-SMS templates can use the same
   * opt-out plumbing as the email path.
   */
  preferenceCategory?: NotificationCategory
}

export const SUPPRESSED_OPTED_OUT = '__suppressed_opted_out__'
export const SUPPRESSED_NO_CONSENT = '__suppressed_no_consent__'
export const SUPPRESSED_NO_PHONE = '__suppressed_no_phone__'

export type SendSmsResult =
  | { success: true; messageSid: string }
  | { success: false; error: string }

const MAX_RETRIES = 1
const RETRY_BACKOFF_MS = 500

/**
 * Send a transactional SMS. Always returns a result — never throws.
 * Audit row is written for attempted sends only (skipped for
 * suppressed-opt-out / no-consent / no-phone — we didn't try).
 */
export async function sendSms(input: SendSmsInput): Promise<SendSmsResult> {
  // ── Preference check ────────────────────────────────────────────────────
  // SMS-specific: every send requires profiles.sms_consent = true AND a
  // non-null phone_number on the recipient. These are fail-closed gates,
  // not fail-open — we treat unknown state as "don't send."
  const admin = createAdminClient()
  const { data: profile, error: profileErr } = await admin
    .from('profiles')
    .select('sms_consent, phone_number')
    .eq('id', input.recipientUserId)
    .maybeSingle()

  if (profileErr) {
    // Can't verify consent → don't send. Don't audit either (no send
    // attempt; audit suggests intent to send, which could look like
    // harassment during a PECR review).
    console.warn('[sms/send] consent lookup failed:', profileErr.message)
    return { success: false, error: 'consent_lookup_failed' }
  }

  if (!profile || profile.sms_consent !== true) {
    return { success: false, error: SUPPRESSED_NO_CONSENT }
  }
  if (!profile.phone_number) {
    return { success: false, error: SUPPRESSED_NO_PHONE }
  }

  // Normalise to E.164. UK members often enter 07... format; Twilio
  // requires +44... or it rejects with a permanent 400. We handle this
  // at send-time rather than signup-time so the fix covers existing
  // profiles written before the normalisation rule existed. Non-UK
  // numbers are left as-is — the CHECK constraint ensures they're
  // already +country-code + digits.
  const normalisedPhone = profile.phone_number.startsWith('0')
    ? '+44' + profile.phone_number.slice(1)
    : profile.phone_number

  // Per-category opt-out (currently unused but reserved — mirrors the
  // email wrapper so future marketing-SMS templates plug in cleanly).
  if (input.preferenceCategory) {
    const { data: pref } = await admin
      .from('notification_preferences')
      .select('review_requests, profile_nudges, admin_announcements')
      .eq('user_id', input.recipientUserId)
      .maybeSingle()
    if (
      pref &&
      (pref as Record<string, boolean>)[input.preferenceCategory] === false
    ) {
      return { success: false, error: SUPPRESSED_OPTED_OUT }
    }
  }

  // ── Config check ────────────────────────────────────────────────────────
  if (!isSmsConfigured()) {
    const err = 'Twilio not configured — skipping SMS'
    if (process.env.NODE_ENV === 'production') {
      console.warn('[sms/send]', err)
    }
    await logSendAttempt(input, input.to, {
      success: false,
      error: err,
    })
    return { success: false, error: err }
  }

  // ── Apply sandbox redirect ──────────────────────────────────────────────
  // Use the normalised phone (from profile) rather than input.to, which
  // may carry an unnormalised value passed by callers. profile is the
  // source of truth.
  const redirected = SMS_SANDBOX_FALLBACK_RECIPIENT !== undefined
  const actualRecipient = redirected
    ? SMS_SANDBOX_FALLBACK_RECIPIENT!
    : normalisedPhone
  const bodyWithPrefix = redirected
    ? `[\u2192 ${normalisedPhone}]\n${input.body}`
    : input.body

  // ── Send with one retry for transient failures ──────────────────────────
  let attemptResult: SendSmsResult | null = null

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const result = await attemptSend({
      to: actualRecipient,
      body: bodyWithPrefix,
    })

    attemptResult = result

    if (result.success) break
    if (isPermanentError(result.error)) break
    if (attempt < MAX_RETRIES) await sleep(RETRY_BACKOFF_MS)
  }

  const finalResult = attemptResult ?? {
    success: false,
    error: 'sendSms completed without a result (unreachable)',
  }

  await logSendAttempt(input, actualRecipient, finalResult)

  return finalResult
}

async function attemptSend(args: {
  to: string
  body: string
}): Promise<SendSmsResult> {
  try {
    const client = getTwilioClient()
    const message = await client.messages.create({
      to: args.to,
      from: TWILIO_SENDER_ID,
      body: args.body,
    })
    if (!message.sid) {
      return { success: false, error: 'Twilio returned no message sid' }
    }
    return { success: true, messageSid: message.sid }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { success: false, error: message }
  }
}

/**
 * Permanent-failure heuristic. Mirrors the email wrapper. Twilio
 * returns structured errors like `[HTTP 400] The 'To' number is
 * invalid`. We match on status codes + common substrings.
 */
function isPermanentError(message: string): boolean {
  const lower = message.toLowerCase()
  if (
    lower.includes('invalid') ||
    lower.includes('not a valid') ||
    lower.includes('opted out') ||
    lower.includes('unsubscribed') ||
    lower.includes('blacklist') ||
    lower.includes('permission') ||
    lower.includes('unauthorized') ||
    lower.includes('unauthorised')
  ) {
    return true
  }
  if (/\b4\d\d\b/.test(message)) return true
  return false
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Audit-log to `notifications`. Schema shared with the email wrapper:
 * channel='sms', subject is NULL, body holds the text. `provider_message_id`
 * holds the Twilio SID on success.
 */
async function logSendAttempt(
  input: SendSmsInput,
  actualRecipient: string,
  result: SendSmsResult,
): Promise<void> {
  try {
    const admin = createAdminClient()
    await admin.from('notifications').insert({
      sent_by: input.relatedProfileId,
      recipient_type: 'custom',
      recipient_event_id: input.recipientEventId ?? null,
      recipient_user_id: input.recipientUserId,
      type: 'reminder',
      subject: null,
      body: input.body,
      channel: 'sms',
      recipient_email: actualRecipient,
      provider_message_id: result.success ? result.messageSid : null,
      status: result.success ? 'sent' : 'failed',
      error_message: result.success ? null : result.error,
      template_name: input.templateName,
    })
  } catch (err) {
    console.error(
      '[sms/send] Failed to write notifications audit row:',
      err instanceof Error ? err.message : err,
    )
  }
}
