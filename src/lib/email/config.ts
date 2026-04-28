/**
 * Single source of truth for transactional email config.
 *
 * Two production-discipline items:
 *   1. `FROM_ADDRESS` — must remain on a Resend-verified domain.
 *      Reverting to a Resend testing sender silently breaks delivery
 *      to all non-account-owner recipients (see 2026-04-28 incident
 *      and the comment block below).
 *   2. `SANDBOX_FALLBACK_RECIPIENT` — leave undefined in production so
 *      mail flows to real recipients. In dev / staging, this redirects
 *      every send to the developer's inbox so `pnpm dev` doesn't
 *      accidentally email real members during local testing. The
 *      send wrapper rewrites the `to:` field and prefixes the subject
 *      with `[→ original@example.com]` so we can see what would have
 *      gone where in production.
 */

// FROM address for all transactional email. MUST remain on a Resend-
// verified domain — reverting to a Resend testing sender (e.g.
// `onboarding@resend.dev`) silently breaks delivery to non-account-
// owner recipients: Resend rejects with HTTP 403 / `validation_error`
// and the send wrapper logs `status='failed'` to `notifications`
// without throwing. This was the 2026-04-28 transactional-email
// outage — every booking confirmation, waitlist confirmation, venue
// reveal and welcome email silently bounced for non-owner recipients
// between live-Stripe go-date and the fix.
export const FROM_ADDRESS = 'The Social Seen <hello@the-social-seen.com>'

/**
 * Where to redirect ALL transactional email recipients in non-prod
 * environments. Prevents `pnpm dev` from spamming real members during
 * local testing or staging exercises.
 *
 * - In **production**: undefined → no redirect, real recipients receive
 *   their mail.
 * - In **dev / staging**: defaults to the developer's inbox. The send
 *   wrapper rewrites the `to:` field and prefixes the subject with
 *   `[→ original@example.com]` so we can see what address the email
 *   would have gone to in prod.
 */
export const SANDBOX_FALLBACK_RECIPIENT: string | undefined =
  process.env.NODE_ENV === 'production'
    ? undefined
    : 'mitesh@skillmeup.co'

/**
 * Reply-To used for all transactional emails. Routes user replies to a
 * monitored inbox. Always set, even in sandbox mode — replies from the
 * account owner during testing land here.
 */
export const REPLY_TO_ADDRESS = 'info@the-social-seen.com'
