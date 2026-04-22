import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Stateless, HMAC-signed unsubscribe tokens.
 *
 * Embedded in transactional + marketing email footers. The link looks like:
 *     https://the-social-seen.com/unsubscribe?t=<token>
 *
 * Token format: `<b64url-payload>.<b64url-sig>`
 *   payload = JSON { u: user_id, c: category, i: issued_at_unix_seconds }
 *   sig     = HMAC-SHA256(secret, payload)
 *
 * Stateless beats a DB-backed token table for v1 because:
 *   - The scheduled daily edge function (Deno) would need to insert a
 *     row per email — a write burst during the nightly venue-reveal /
 *     reminder pass. HMAC tokens are free at send time.
 *   - Revocation isn't a concern: the token is scoped to a single
 *     unsubscribe action. After the user clicks, we flip their
 *     preference and the token becomes pointless (clicking again is a
 *     no-op, not a security event).
 *
 * Max age: 90 days. Longer than this, emails are stale; force the
 * user to click the link in a fresher email or go to the profile
 * preferences page.
 *
 * Secret: `UNSUBSCRIBE_TOKEN_SECRET` env var. Falls back to the
 * `SUPABASE_JWT_SECRET`-style SUPABASE_SERVICE_ROLE_KEY for dev so we
 * don't introduce a "set this or emails break" trip wire; production
 * MUST set a dedicated secret.
 */

export type NotificationCategory =
  | 'review_requests'
  | 'profile_nudges'
  | 'admin_announcements'

export const UNSUBSCRIBE_CATEGORIES: ReadonlyArray<NotificationCategory> = [
  'review_requests',
  'profile_nudges',
  'admin_announcements',
] as const

const MAX_AGE_SECONDS = 90 * 24 * 60 * 60 // 90 days

function getSecret(): string {
  const explicit = process.env.UNSUBSCRIBE_TOKEN_SECRET
  if (explicit && explicit.length >= 16) return explicit

  // Fallback to the service-role key so local dev + early preview don't
  // need a separate env var. Production MUST set the explicit secret.
  const fallback = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!fallback) {
    throw new Error(
      'UNSUBSCRIBE_TOKEN_SECRET is not set and SUPABASE_SERVICE_ROLE_KEY is unavailable as fallback.',
    )
  }
  return fallback
}

function b64urlEncode(input: string | Buffer): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf-8') : input
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function b64urlDecodeString(input: string): string {
  const padded = input
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(input.length / 4) * 4, '=')
  return Buffer.from(padded, 'base64').toString('utf-8')
}

function sign(payload: string, secret: string): string {
  return b64urlEncode(createHmac('sha256', secret).update(payload).digest())
}

/**
 * Mint an unsubscribe token for a user + category.
 * Returns a URL-safe string suitable for a ?t=<token> query param.
 */
export function issueUnsubscribeToken(
  userId: string,
  category: NotificationCategory,
): string {
  const payload = JSON.stringify({
    u: userId,
    c: category,
    i: Math.floor(Date.now() / 1000),
  })
  const encodedPayload = b64urlEncode(payload)
  const sig = sign(encodedPayload, getSecret())
  return `${encodedPayload}.${sig}`
}

export interface VerifiedToken {
  userId: string
  category: NotificationCategory
  issuedAt: number // unix seconds
}

export type TokenVerifyResult =
  | { ok: true; value: VerifiedToken }
  | { ok: false; reason: string }

/**
 * Verify a token's signature + age + shape. Constant-time signature
 * comparison; returns a discriminated result so callers can log the
 * reason without leaking details to the client.
 */
export function verifyUnsubscribeToken(token: string): TokenVerifyResult {
  if (typeof token !== 'string' || token.length === 0) {
    return { ok: false, reason: 'empty_token' }
  }

  const parts = token.split('.')
  if (parts.length !== 2) {
    return { ok: false, reason: 'malformed' }
  }
  const [encodedPayload, providedSig] = parts

  let expectedSig: string
  try {
    expectedSig = sign(encodedPayload, getSecret())
  } catch (err) {
    console.warn('[unsubscribe-token] sign threw:', err)
    return { ok: false, reason: 'sign_error' }
  }

  // Constant-time compare — guards against timing side-channels.
  const a = Buffer.from(providedSig, 'utf-8')
  const b = Buffer.from(expectedSig, 'utf-8')
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: 'bad_signature' }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(b64urlDecodeString(encodedPayload))
  } catch {
    return { ok: false, reason: 'malformed_payload' }
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as { u?: unknown }).u !== 'string' ||
    typeof (parsed as { c?: unknown }).c !== 'string' ||
    typeof (parsed as { i?: unknown }).i !== 'number'
  ) {
    return { ok: false, reason: 'missing_fields' }
  }

  const { u, c, i } = parsed as { u: string; c: string; i: number }

  if (!UNSUBSCRIBE_CATEGORIES.includes(c as NotificationCategory)) {
    return { ok: false, reason: 'invalid_category' }
  }

  const ageSeconds = Math.floor(Date.now() / 1000) - i
  if (ageSeconds < 0) {
    return { ok: false, reason: 'future_issued' }
  }
  if (ageSeconds > MAX_AGE_SECONDS) {
    return { ok: false, reason: 'expired' }
  }

  return {
    ok: true,
    value: {
      userId: u,
      category: c as NotificationCategory,
      issuedAt: i,
    },
  }
}

/**
 * Build the absolute unsubscribe URL for use in an email.
 * Uses NEXT_PUBLIC_SITE_URL if available, Vercel URL otherwise, and
 * the hardcoded preview fallback as a last resort (mirrors getSiteUrl()
 * in _shared.ts — duplicated here to keep this module self-contained
 * and importable from any context).
 */
export function buildUnsubscribeUrl(
  userId: string,
  category: NotificationCategory,
): string {
  const site =
    process.env.NEXT_PUBLIC_SITE_URL ??
    (process.env.NEXT_PUBLIC_VERCEL_URL
      ? `https://${process.env.NEXT_PUBLIC_VERCEL_URL}`
      : 'https://the-social-seen.vercel.app')
  const token = issueUnsubscribeToken(userId, category)
  const base = site.replace(/\/$/, '')
  return `${base}/unsubscribe?t=${encodeURIComponent(token)}`
}

// ── Human-readable category labels (for the /unsubscribe confirmation UI) ───
export const CATEGORY_LABELS: Record<NotificationCategory, string> = {
  review_requests: 'post-event review requests',
  profile_nudges: 'profile-completion reminders',
  admin_announcements: 'admin announcements',
}
