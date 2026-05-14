/**
 * Authorise an incoming request to the daily-notifications Edge Function.
 *
 * Accepts EITHER the auto-injected SUPABASE_SERVICE_ROLE_KEY (Dashboard
 * invokes, direct curl) OR an explicit CRON_AUTH_TOKEN (used by pg_cron
 * — see config block in index.ts for why this fallback exists).
 *
 * Returns true iff the Authorization header's Bearer token matches one
 * of the two configured values AND that value is non-empty.
 */
export function isAuthorizedRequest(
  authHeader: string | null | undefined,
  serviceRoleKey: string,
  cronAuthToken: string,
): boolean {
  const token = (authHeader ?? '').replace(/^Bearer\s+/i, '')
  const matchesServiceRole = !!serviceRoleKey && token === serviceRoleKey
  const matchesCronToken = !!cronAuthToken && token === cronAuthToken
  return matchesServiceRole || matchesCronToken
}
