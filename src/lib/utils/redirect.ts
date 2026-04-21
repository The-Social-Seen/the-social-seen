/**
 * Sanitise a `?redirect=` / `?from=` query parameter so the app never
 * bounces a user to an off-site URL.
 *
 * A path is considered safe when:
 *   - it starts with `/` (relative)
 *   - it does NOT start with `//` (protocol-relative)
 *   - it does NOT start with `\/` (some browsers normalise `\` to `/`,
 *     which would let `\/evil.com` through as `//evil.com`)
 *   - it does NOT contain `://` (absolute URL with scheme)
 *
 * Anything that fails these checks falls back to the supplied `fallback`
 * (default `/events`).
 *
 * Used by the login, password-reset, and email-verification forms — keep
 * this list in sync with any new redirect-handling forms added in future.
 */
export function sanitizeRedirectPath(
  raw: string | null | undefined,
  fallback: string = '/events',
): string {
  if (!raw) return fallback
  if (
    raw.startsWith('/') &&
    !raw.startsWith('//') &&
    !raw.startsWith('\\/') &&
    !raw.includes('://')
  ) {
    return raw
  }
  return fallback
}
