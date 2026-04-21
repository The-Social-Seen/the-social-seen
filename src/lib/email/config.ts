/**
 * Single source of truth for transactional email config.
 *
 * Two things to flip when production goes live:
 *   1. `FROM_ADDRESS` — switch from the Resend sandbox sender to your
 *      verified domain address. One-line change.
 *   2. `SANDBOX_FALLBACK_RECIPIENT` — leave undefined in production so
 *      mail flows to real recipients. Resend's free-tier sandbox mode
 *      (no verified domain) rejects sends to anyone OTHER than the
 *      account owner's email; until the cofounder has finished adding
 *      DNS records for the-social-seen.com, all dev/staging sends are
 *      rerouted to the account-owner address so we can manually inspect
 *      what gets sent.
 */

// FROM address for all transactional email. While the Resend sending
// domain isn't verified yet, sends MUST originate from `onboarding@resend.dev`
// — Resend rejects sends from any other unverified domain. Once
// the-social-seen.com is verified, change this to e.g.
// `'The Social Seen <hello@the-social-seen.com>'`.
export const FROM_ADDRESS = 'The Social Seen <onboarding@resend.dev>'

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
