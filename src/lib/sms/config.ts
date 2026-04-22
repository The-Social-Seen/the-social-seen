import 'server-only'

/**
 * Twilio / SMS configuration.
 *
 * Values are read from env. All three MUST be set in production. Dev
 * can leave them unset — the Twilio client loader throws and the send
 * wrapper treats that as "SMS disabled" (no-op + audit row marked
 * failed with a clear error), so the rest of the stack keeps working.
 *
 *   TWILIO_ACCOUNT_SID         — starts with `AC...`
 *   TWILIO_AUTH_TOKEN          — 32-char hex
 *   TWILIO_SENDER_ID           — 11-char max alphanumeric (e.g. "SocialSeen")
 *                                OR a full E.164 number (+44...) if you
 *                                later buy a long code.
 *
 * Optional:
 *   SMS_SANDBOX_FALLBACK_RECIPIENT — E.164 number. When set, EVERY SMS
 *     is rewritten to send to this number instead of the real recipient,
 *     with the intended recipient prefixed in the body. Mirrors the
 *     Resend sandbox pattern so pre-launch testing doesn't spam real
 *     members. Set to undefined (or don't set at all) in production.
 */

export const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID ?? ''
export const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN ?? ''
export const TWILIO_SENDER_ID =
  process.env.TWILIO_SENDER_ID ?? 'SocialSeen'

/**
 * Sandbox-recipient override. Only active in non-production environments
 * by default — explicitly unsetting in production is still required if
 * the env var somehow leaks through Vercel config.
 */
export const SMS_SANDBOX_FALLBACK_RECIPIENT: string | undefined =
  process.env.NODE_ENV === 'production'
    ? undefined
    : process.env.SMS_SANDBOX_FALLBACK_RECIPIENT || undefined

/** True when the three required creds are all present. */
export function isSmsConfigured(): boolean {
  return (
    TWILIO_ACCOUNT_SID.startsWith('AC') &&
    TWILIO_AUTH_TOKEN.length >= 16 &&
    TWILIO_SENDER_ID.length > 0
  )
}
