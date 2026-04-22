/**
 * Shared redaction constants for the `notifications` audit log.
 *
 * The GDPR scrub RPC (`sanitise_user_notifications` — see
 * supabase/migrations/20260425000001 + 20260428000002) rewrites
 * `body` and `subject` on rows belonging to a deleted user:
 *
 *   body    = '[redacted — account deleted]'
 *   subject = '[redacted]'
 *
 * Anything in the app that reads a notifications row and needs to
 * short-circuit on scrubbed data (the admin "retry failed send" flow,
 * future in-app mailbox rendering, etc.) MUST key off these constants
 * rather than hardcoded substrings — otherwise the migration's
 * phrasing could drift and the guard would silently stop matching.
 *
 * Mirror:  when these constants change, update the UPDATE statements
 *          in the migration + bump a new migration if the prose is
 *          reworded in prod.
 */

export const REDACTED_BODY = '[redacted — account deleted]'
export const REDACTED_SUBJECT = '[redacted]'

/**
 * startsWith guard — matches both REDACTED_BODY and REDACTED_SUBJECT.
 * Use when you have a row and don't know which field you're checking.
 */
export const REDACTED_PREFIX = '[redacted'

/** True if the given body/subject string has been scrubbed. */
export function isRedacted(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(REDACTED_PREFIX)
}
