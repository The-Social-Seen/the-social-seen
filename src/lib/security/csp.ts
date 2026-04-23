/**
 * Per-request Content-Security-Policy construction.
 *
 * Used by `src/lib/supabase/middleware.ts` — the policy is rebuilt
 * on every request because `script-src` includes a fresh nonce.
 *
 * Why nonce instead of `'unsafe-inline'`: the codebase deliberately
 * leaves the Supabase auth cookie with `httpOnly: false` so the
 * browser SDK can read it. The CSP is the compensating control
 * against XSS-driven cookie exfiltration; it only works if it
 * actually blocks attacker-injected `<script>` tags. `'unsafe-inline'`
 * would defeat that — any injected script would execute. The nonce
 * scheme allows our own inline script (the theme-detect one in
 * app/layout.tsx, rendered with `nonce={nonce}` from
 * `headers().get('x-csp-nonce')`) while blocking everything else.
 *
 * Dev relaxations: Next.js's dev runtime injects inline scripts
 * without nonces (HMR, error overlay, dev-only debugging). To keep
 * `pnpm dev` working we add `'unsafe-inline'` + `'unsafe-eval'` in
 * dev only. Production uses the nonce-only path.
 */

import 'server-only'

const ALLOWED_SCRIPT_ORIGINS = [
  'https://challenges.cloudflare.com',
  'https://js.stripe.com',
  'https://eu.i.posthog.com',
  'https://us.i.posthog.com',
  'https://*.posthog.com',
] as const

const ALLOWED_IMG_ORIGINS = [
  'https://images.unsplash.com',
  'https://*.supabase.co',
  'https://*.posthog.com',
] as const

const ALLOWED_CONNECT_ORIGINS = [
  'https://*.supabase.co',
  'wss://*.supabase.co',
  'https://eu.i.posthog.com',
  'https://us.i.posthog.com',
  'https://*.posthog.com',
  'https://*.sentry.io',
  'https://*.ingest.sentry.io',
  'https://api.stripe.com',
  'https://challenges.cloudflare.com',
] as const

const ALLOWED_FRAME_ORIGINS = [
  'https://js.stripe.com',
  'https://hooks.stripe.com',
  'https://challenges.cloudflare.com',
] as const

/**
 * Generate a 16-byte cryptographic random nonce, base64-encoded.
 * Edge runtime exposes `crypto.getRandomValues` on the global.
 */
export function generateNonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  // base64 encoding compatible with the Edge runtime — no Buffer.
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/**
 * Build the Content-Security-Policy header value for one request.
 *
 * @param nonce - per-request nonce string from `generateNonce()`.
 * @param isDev - true in dev / preview; relaxes script-src so HMR
 *   and the dev error overlay survive. Pass `process.env.NODE_ENV !==
 *   'production'` from the caller.
 */
export function buildCsp(nonce: string, isDev: boolean): string {
  const scriptSrc = [
    "'self'",
    `'nonce-${nonce}'`,
    // `'strict-dynamic'` lets nonce-loaded scripts load further scripts
    // without each one needing its own nonce. Modern browsers honour
    // it; older ones fall back to the explicit allowlist below, which
    // is why the origins remain.
    "'strict-dynamic'",
    ...ALLOWED_SCRIPT_ORIGINS,
    ...(isDev
      ? // Dev only — Next.js dev runtime + Fast Refresh + error
        // overlay inject inline scripts and use eval for HMR.
        ["'unsafe-inline'", "'unsafe-eval'"]
      : []),
  ]

  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': scriptSrc,
    // Style-src keeps `'unsafe-inline'` because Tailwind + Radix +
    // framer-motion all inject style attributes that aren't reachable
    // by nonce. Style-injection isn't an XSS-to-cookie vector the
    // way script-injection is, so the residual risk is acceptable.
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:', ...ALLOWED_IMG_ORIGINS],
    'font-src': ["'self'", 'data:'],
    'connect-src': [
      "'self'",
      ...ALLOWED_CONNECT_ORIGINS,
      ...(isDev
        ? ['ws://localhost:*', 'http://localhost:*', 'ws://127.0.0.1:*']
        : []),
    ],
    'frame-src': [...ALLOWED_FRAME_ORIGINS],
    'frame-ancestors': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'object-src': ["'none'"],
    ...(isDev ? {} : { 'upgrade-insecure-requests': [] }),
  }

  return Object.entries(directives)
    .map(([directive, sources]) =>
      sources.length > 0 ? `${directive} ${sources.join(' ')}` : directive,
    )
    .join('; ')
}

/**
 * The header name we use to ship the nonce from middleware to Server
 * Components. Read it via `headers().get(CSP_NONCE_HEADER)` from any
 * Server Component — typically the root layout to render the inline
 * theme-detect script with the matching nonce attribute.
 */
export const CSP_NONCE_HEADER = 'x-csp-nonce'
