/**
 * Single source of truth for transactional email config.
 *
 * Two production-discipline items:
 *   1. `FROM_ADDRESS` — must remain on a Resend-verified domain.
 *      Reverting to a Resend testing sender silently breaks delivery
 *      to all non-account-owner recipients (see 2026-04-28 incident
 *      and the comment block below).
 *   2. `SANDBOX_FALLBACK_RECIPIENT` — leave undefined in production so
 *      mail flows to real recipients. Resend's free-tier sandbox mode
 *      (no verified domain) rejects sends to anyone OTHER than the
 *      account owner's email; until the cofounder has finished adding
 *      DNS records for the-social-seen.com, all dev/staging sends are
 *      rerouted to the account-owner address so we can manually inspect
 *      what gets sent.
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
 * Where to redirect ALL transactional email recipients while the Resend
 * sending domain isn't verified.
 *
 * - In **production**: undefined → no redirect, real recipients receive
 *   their mail. Set this to undefined as soon as DNS verifies.
 * - In **dev / staging**: defaults to the Resend account owner so we can
 *   manually verify what gets sent. Resend sandbox restriction means
 *   anything else returns HTTP 403 `validation_error`.
 *
 * The send wrapper prefixes the subject with `[→ original@example.com]`
 * so we can see what address the email would have gone to in prod.
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
