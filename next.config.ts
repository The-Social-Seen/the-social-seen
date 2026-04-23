import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const isDev = process.env.NODE_ENV !== "production";

/**
 * Content-Security-Policy.
 *
 * Rollout posture: enforce, not Report-Only. Provides browser
 * hardening (frame-ancestors, base-uri, form-action, restricted
 * connect/img/script origins, upgrade-insecure-requests in prod) plus
 * a strict allowlist of third-party origins.
 *
 * ⚠ **Limitation — does not yet prevent XSS-driven cookie
 * exfiltration.** `script-src` includes `'unsafe-inline'` because we
 * render a small inline theme-detection script in `app/layout.tsx`.
 * Until that's migrated to a nonce-based scheme (per-request nonce
 * generated in middleware, threaded through the inline script tag,
 * `'unsafe-inline'` dropped from script-src), an XSS injection in
 * the app can still execute inline `<script>` and read
 * `document.cookie` — including the Supabase auth cookie that the
 * middleware deliberately leaves with `httpOnly: false`.
 *
 * Tracked as a high-priority follow-up in `docs/FOLLOW-UPS.md` —
 * "Migrate CSP script-src to nonce-based". Until that lands the
 * `httpOnly: false` posture in `src/lib/supabase/middleware.ts` is
 * gappier than the cookie-set comment claims.
 *
 * Dev relaxations: `'unsafe-eval'` for the React Refresh runtime, and
 * `ws://localhost:*` / `http://localhost:*` in connect-src for HMR.
 *
 * Allowlisted third parties (must stay in lockstep with what the app
 * actually loads):
 *   - Stripe Checkout (js.stripe.com, hooks.stripe.com, api.stripe.com)
 *   - Cloudflare Turnstile (challenges.cloudflare.com)
 *   - PostHog (eu.i.posthog.com / us.i.posthog.com — env-selectable)
 *   - Sentry ingest (*.sentry.io) — used by the /monitoring tunnel
 *   - Supabase REST + Realtime (*.supabase.co + wss)
 *   - Unsplash (images.unsplash.com) for seed event images
 */
const cspDirectives: Record<string, string[]> = {
  "default-src": ["'self'"],
  "script-src": [
    "'self'",
    "'unsafe-inline'",
    ...(isDev ? ["'unsafe-eval'"] : []),
    "https://challenges.cloudflare.com",
    "https://js.stripe.com",
    "https://eu.i.posthog.com",
    "https://us.i.posthog.com",
    "https://*.posthog.com",
  ],
  "style-src": ["'self'", "'unsafe-inline'"],
  "img-src": [
    "'self'",
    "data:",
    "blob:",
    "https://images.unsplash.com",
    "https://*.supabase.co",
    "https://*.posthog.com",
  ],
  "font-src": ["'self'", "data:"],
  "connect-src": [
    "'self'",
    "https://*.supabase.co",
    "wss://*.supabase.co",
    "https://eu.i.posthog.com",
    "https://us.i.posthog.com",
    "https://*.posthog.com",
    "https://*.sentry.io",
    "https://*.ingest.sentry.io",
    "https://api.stripe.com",
    "https://challenges.cloudflare.com",
    ...(isDev ? ["ws://localhost:*", "http://localhost:*", "ws://127.0.0.1:*"] : []),
  ],
  "frame-src": [
    "https://js.stripe.com",
    "https://hooks.stripe.com",
    "https://challenges.cloudflare.com",
  ],
  "frame-ancestors": ["'none'"],
  "base-uri": ["'self'"],
  "form-action": ["'self'"],
  "object-src": ["'none'"],
  ...(isDev ? {} : { "upgrade-insecure-requests": [] }),
};

const csp = Object.entries(cspDirectives)
  .map(([directive, sources]) =>
    sources.length > 0 ? `${directive} ${sources.join(" ")}` : directive,
  )
  .join("; ");

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
      {
        protocol: "https",
        hostname: "*.supabase.co",
      },
    ],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          { key: "X-DNS-Prefetch-Control", value: "on" },
        ],
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  // Sentry organization and project — used for source map uploads.
  org: "social-seen-dt",
  project: "javascript-nextjs",

  // Silence CLI output unless CI so dev builds stay clean.
  silent: !process.env.CI,

  // Upload larger source maps (default is too small for Next.js bundles).
  widenClientFileUpload: true,

  // Route browser requests to Sentry through a Next.js rewrite so ad-blockers
  // don't swallow error reports.
  tunnelRoute: "/monitoring",
});
