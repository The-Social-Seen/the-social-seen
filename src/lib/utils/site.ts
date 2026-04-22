/**
 * Canonical site URL — the production origin used for SEO surfaces:
 * sitemap entries, robots sitemap pointer, JSON-LD `url`, canonical
 * `<link>` tags, Open Graph URLs.
 *
 * This is deliberately separate from the email/auth `getSiteUrl()`
 * helper in `src/lib/email/templates/_shared.ts`, which falls through
 * to `NEXT_PUBLIC_VERCEL_URL` for preview-deploy email links. We never
 * want preview URLs in a sitemap that Google might crawl from a stray
 * cache, so this helper has no preview fallback.
 *
 * Override only via `NEXT_PUBLIC_CANONICAL_URL` if the prod origin
 * ever changes; the default is the documented prod URL from
 * `SITE_CONFIG.url`.
 */
import { SITE_CONFIG } from '@/lib/constants'

export function getCanonicalSiteUrl(): string {
  // Trim defensively — Vercel env-var pastes occasionally smuggle in a
  // trailing newline or whitespace that would survive the regex check
  // and break `new URL(...)` downstream.
  const env = process.env.NEXT_PUBLIC_CANONICAL_URL?.trim()
  if (env && /^https:\/\//.test(env)) {
    // Strip trailing slash so callers can always do `${url}/path`
    // without doubling.
    return env.replace(/\/+$/, '')
  }
  return SITE_CONFIG.url.replace(/\/+$/, '')
}

/**
 * Build an absolute canonical URL for a given path.
 * Path should start with `/` (will be normalised either way).
 */
export function canonicalUrl(path: string): string {
  const base = getCanonicalSiteUrl()
  const cleanPath = path.startsWith('/') ? path : `/${path}`
  return `${base}${cleanPath}`
}
