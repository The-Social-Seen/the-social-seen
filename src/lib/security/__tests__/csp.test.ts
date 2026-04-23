/**
 * @vitest-environment node
 *
 * Unit tests for the per-request CSP helpers. The nonce generator
 * is security-adjacent (feeds the XSS-exfiltration compensating
 * control) so the contract is worth pinning explicitly.
 */
import { describe, it, expect } from 'vitest'
import { buildCsp, CSP_NONCE_HEADER, generateNonce } from '../csp'

describe('generateNonce', () => {
  it('returns a base64 string of at least 22 chars (16 bytes → 24 with padding, 22 without)', () => {
    const nonce = generateNonce()
    expect(nonce).toMatch(/^[A-Za-z0-9+/=]+$/)
    // 16 bytes of random → 22 chars un-padded / 24 chars padded.
    // Either is fine; CSP just needs enough entropy.
    expect(nonce.length).toBeGreaterThanOrEqual(22)
  })

  it('produces a different nonce on every call (high entropy)', () => {
    const nonces = new Set<string>()
    for (let i = 0; i < 100; i++) nonces.add(generateNonce())
    expect(nonces.size).toBe(100)
  })
})

describe('buildCsp', () => {
  const NONCE = 'TESTNONCEABC123'

  it('embeds the nonce in script-src', () => {
    const csp = buildCsp(NONCE, false)
    expect(csp).toContain(`'nonce-${NONCE}'`)
  })

  it('includes strict-dynamic in script-src for modern-browser CSP3 semantics', () => {
    const csp = buildCsp(NONCE, false)
    expect(csp).toContain("'strict-dynamic'")
  })

  it('omits unsafe-inline and unsafe-eval from script-src in production', () => {
    const csp = buildCsp(NONCE, false)
    const scriptSrc = extractDirective(csp, 'script-src')
    expect(scriptSrc).not.toContain("'unsafe-inline'")
    expect(scriptSrc).not.toContain("'unsafe-eval'")
  })

  it('allows unsafe-inline + unsafe-eval in dev for HMR + error overlay', () => {
    const csp = buildCsp(NONCE, true)
    const scriptSrc = extractDirective(csp, 'script-src')
    expect(scriptSrc).toContain("'unsafe-inline'")
    expect(scriptSrc).toContain("'unsafe-eval'")
  })

  it('emits upgrade-insecure-requests only in production', () => {
    expect(buildCsp(NONCE, false)).toContain('upgrade-insecure-requests')
    expect(buildCsp(NONCE, true)).not.toContain('upgrade-insecure-requests')
  })

  it('allowlists the third-party origins the app actually loads', () => {
    const csp = buildCsp(NONCE, false)
    // Stripe Checkout
    expect(csp).toContain('https://js.stripe.com')
    expect(csp).toContain('https://api.stripe.com')
    // Cloudflare Turnstile
    expect(csp).toContain('https://challenges.cloudflare.com')
    // PostHog (both regions)
    expect(csp).toContain('https://eu.i.posthog.com')
    expect(csp).toContain('https://us.i.posthog.com')
    // Supabase REST + Realtime
    expect(csp).toContain('https://*.supabase.co')
    expect(csp).toContain('wss://*.supabase.co')
    // Sentry ingest (used by the /monitoring tunnel)
    expect(csp).toContain('https://*.sentry.io')
    // Unsplash seed images
    expect(csp).toContain('https://images.unsplash.com')
  })

  it('sets frame-ancestors to none and object-src to none', () => {
    const csp = buildCsp(NONCE, false)
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("object-src 'none'")
  })

  it('adds dev-only websocket origins to connect-src for HMR', () => {
    expect(buildCsp(NONCE, true)).toContain('ws://localhost:*')
    expect(buildCsp(NONCE, false)).not.toContain('ws://localhost:*')
  })
})

describe('CSP_NONCE_HEADER', () => {
  it('uses the lowercase header name middleware and Server Components agree on', () => {
    expect(CSP_NONCE_HEADER).toBe('x-csp-nonce')
  })
})

// ── helpers ───────────────────────────────────────────────────────────────

function extractDirective(csp: string, name: string): string {
  const match = csp.split(';').find((d) => d.trim().startsWith(`${name} `))
  return match?.trim() ?? ''
}
