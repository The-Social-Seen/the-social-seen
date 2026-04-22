/**
 * Cloudflare Turnstile verification helper (server-side).
 *
 * Turnstile protects the public /contact and /collaborate forms from
 * automated abuse — the honeypot + 2-second timing gate in actions.ts
 * catches script kiddies, but a determined actor could script a 3-second
 * wait and drain our Resend monthly budget via repeat submissions.
 *
 * Flow:
 *   1. Browser loads challenges.cloudflare.com/turnstile/v0/api.js
 *   2. Widget in the form solves the challenge (invisible for ~99% of
 *      users; a puzzle for suspicious sessions)
 *   3. Widget writes the token into hidden input `cf-turnstile-response`
 *   4. The token lands in FormData and this module verifies it with
 *      Cloudflare via the shared secret
 *
 * Fail-open policy:
 *   - If `TURNSTILE_SECRET_KEY` is missing, we log a warning and return
 *     `{ ok: true }`. This is deliberate so local dev and preview
 *     deploys don't break before the operator adds the env var.
 *     Production MUST set the secret; a Sentry-visible warning will
 *     catch a missing secret on a real deploy.
 *   - If Cloudflare's API is unreachable we fail-open too — letting a
 *     transient provider outage block legitimate submissions is worse
 *     than temporarily accepting unverified traffic (bots also have to
 *     beat the honeypot + timing gate).
 *
 * The site key is `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (safe for the browser);
 * the secret is `TURNSTILE_SECRET_KEY` (server-only).
 */

const TURNSTILE_VERIFY_URL =
  'https://challenges.cloudflare.com/turnstile/v0/siteverify'

export interface TurnstileVerifyResult {
  ok: boolean
  reason?: string
}

/**
 * Verify a Turnstile token with Cloudflare's siteverify endpoint.
 *
 * @param token      The client-emitted `cf-turnstile-response` value
 * @param remoteip   Optional — the visitor's IP, if known (improves scoring)
 */
export async function verifyTurnstileToken(
  token: string | null,
  remoteip?: string,
): Promise<TurnstileVerifyResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY

  // Fail-open when unconfigured — see module doc.
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      console.warn(
        '[turnstile] TURNSTILE_SECRET_KEY is not set in production. ' +
          'Public forms are unprotected beyond the honeypot + timing gate.',
      )
    }
    return { ok: true, reason: 'secret_not_configured' }
  }

  if (!token || token.trim() === '') {
    return { ok: false, reason: 'missing_token' }
  }

  const body = new URLSearchParams()
  body.append('secret', secret)
  body.append('response', token)
  if (remoteip) body.append('remoteip', remoteip)

  try {
    const response = await fetch(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      body,
      // Cloudflare recommends ~10s — we keep it tight so a slow verify
      // doesn't block the admin response path.
      signal: AbortSignal.timeout(8000),
    })

    if (!response.ok) {
      // Network-level failure — fail open (see module doc) but log.
      console.warn(
        '[turnstile] siteverify returned non-2xx:',
        response.status,
      )
      return { ok: true, reason: 'provider_unreachable' }
    }

    const payload = (await response.json()) as {
      success?: boolean
      ['error-codes']?: string[]
    }

    if (payload.success === true) {
      return { ok: true }
    }

    const codes = payload['error-codes'] ?? []
    return {
      ok: false,
      reason: codes.length > 0 ? codes.join(',') : 'verification_failed',
    }
  } catch (err) {
    console.warn('[turnstile] verify call threw:', err)
    // Network hiccup — fail open.
    return { ok: true, reason: 'provider_error' }
  }
}

/**
 * Extract the Turnstile token from FormData. The widget writes to
 * a fixed field name per Cloudflare's convention.
 */
export function extractTurnstileToken(formData: FormData): string | null {
  const raw = formData.get('cf-turnstile-response')
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  return trimmed === '' ? null : trimmed
}
