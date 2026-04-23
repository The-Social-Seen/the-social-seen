import { headers } from 'next/headers'

/**
 * Best-effort caller IP, read from common proxy headers (Vercel sets
 * `x-forwarded-for`; many fronts also set `x-real-ip`). Returns
 * undefined outside a request scope or when no header is present.
 *
 * Used for:
 *   - Cloudflare Turnstile siteverify hint (better fraud scoring).
 *   - Application-layer rate-limit keying (login brute-force brake).
 *
 * Not authoritative — clients can set these headers, but only the
 * outermost proxy's value is trusted in practice (Vercel strips and
 * re-sets `x-forwarded-for` on ingress).
 */
export async function getCallerIp(): Promise<string | undefined> {
  try {
    const h = await headers()
    const forwarded = h.get('x-forwarded-for')
    if (forwarded) {
      const first = forwarded.split(',')[0]?.trim()
      if (first) return first
    }
    const real = h.get('x-real-ip')
    if (real) return real.trim()
  } catch {
    // headers() throws outside a request — return undefined.
  }
  return undefined
}
