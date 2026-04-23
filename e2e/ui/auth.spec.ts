import { test, expect } from '@playwright/test'
import {
  fillRegistrationStep1,
  fillRegistrationStep2,
  signInViaForm,
  typeOtp,
  uniquePassword,
  uniqueRegistrationEmail,
} from '../helpers/browser'
import { isInbucketReachable, purgeInbox, waitForOtp } from '../helpers/inbucket'
import { createTestUser, purgeRun } from '../helpers/fixtures'
import { getAdminClient } from '../helpers/supabase'

/**
 * UI E2E coverage for the auth flows. Three scenarios:
 *
 *   1. Register happy path — 3-step form lands a verified-state-but
 *      app-flag-false profile row.
 *   2. Register duplicate email — second attempt at the same email
 *      surfaces the friendly "already a member" message + sign-in link.
 *   3. Login + OTP verify — seeded user signs in, OTP arrives in
 *      Inbucket, gets typed back, profiles.email_verified flips true.
 *
 * These complement the booking-RPC suite by exercising the full HTTP
 * + cookie + middleware + Server Action chain, not just the DB layer.
 */

test.describe('Auth UI flows', () => {
  test.afterAll(async () => {
    await purgeRun(getAdminClient())
  })

  // ── Scenario 1 ───────────────────────────────────────────────────────────
  test('register happy path — fills 3-step form and lands a profile row', async ({
    page,
  }) => {
    const email = uniqueRegistrationEmail('reg-happy')
    const password = uniquePassword()

    await page.goto('/join')
    await fillRegistrationStep1(page, {
      fullName: 'Charlotte E2E',
      email,
      password,
      phoneNumber: '07123 456789',
      emailConsent: true,
    })

    // Step 2 — Interests. Form requires at least one selection.
    await page.waitForURL(/\/join\?step=2/)
    await fillRegistrationStep2(page, 1)

    // Step 3 — Welcome screen.
    await page.waitForURL(/\/join\?step=3/)
    await expect(
      page.getByRole('heading', { name: /you.?re in/i }),
    ).toBeVisible()

    // Verify the profile row was created with the consent flags we set.
    const admin = getAdminClient()
    const { data: profile } = await admin
      .from('profiles')
      .select('email, full_name, email_consent, sms_consent, email_verified')
      .eq('email', email)
      .single()

    expect(profile).not.toBeNull()
    expect(profile?.full_name).toBe('Charlotte E2E')
    expect(profile?.email_consent).toBe(true)
    expect(profile?.sms_consent).toBe(false)
    // Default autoconfirm flips email_confirmed_at on auth.users at
    // signup, but our app-level flag stays false until /verify completes.
    expect(profile?.email_verified).toBe(false)
  })

  // ── Scenario 2 ───────────────────────────────────────────────────────────
  test('register duplicate email — friendly error surfaces on Step 1', async ({
    page,
  }) => {
    const email = uniqueRegistrationEmail('reg-dup')
    const password = uniquePassword()

    // First registration — happy path; we just need the email to exist.
    await page.goto('/join')
    await fillRegistrationStep1(page, {
      fullName: 'First Take',
      email,
      password,
      phoneNumber: '07123 456789',
    })
    await page.waitForURL(/\/join\?step=2/)

    // Second attempt with the same email.
    await page.goto('/join?step=1')
    await fillRegistrationStep1(page, {
      fullName: 'Second Take',
      email,
      password,
      phoneNumber: '07123 456789',
    })

    await expect(page.getByText(/already a member/i)).toBeVisible()
    // Friendly error includes a Sign-in link inline.
    await expect(
      page.getByRole('link', { name: /^sign in$/i }),
    ).toBeVisible()
  })

  // ── Scenario 3 ───────────────────────────────────────────────────────────
  test('login + OTP verify — seeded user verifies their email end-to-end', async ({
    page,
  }) => {
    if (!(await isInbucketReachable())) {
      test.skip(
        true,
        'Inbucket is not reachable. Start it with `supabase start` ' +
          '(without --exclude inbucket) and re-run.',
      )
    }

    const admin = getAdminClient()
    const user = await createTestUser(admin, {
      tag: 'verify',
      emailVerified: false,
    })
    // Clear any priors so we read this run's OTP, not a stale one
    // from the seeded user's sign-up confirmation (autoconfirm fires
    // a magic-link mail at admin.createUser time even with email_confirm).
    await purgeInbox(user.email)

    // Drive the real login form so middleware + Supabase Auth cookie
    // setup runs end-to-end. Login lands on /events (or /admin); the
    // verify-page is opt-in via banner — we navigate directly to bypass
    // the banner-click step that's not the focus of this scenario.
    await signInViaForm(page, user.email, user.password)
    await page.waitForURL(/\/(events|admin)/, { timeout: 10_000 })

    // /verify auto-fires sendVerificationOtp on mount.
    await page.goto('/verify')
    const code = await waitForOtp(user.email)
    await typeOtp(page, code)

    // After verify the form redirects to ?from= (default /events).
    await page.waitForURL(/\/events/, { timeout: 10_000 })

    const { data: profile } = await admin
      .from('profiles')
      .select('email_verified')
      .eq('id', user.id)
      .single()
    expect(profile?.email_verified).toBe(true)
  })
})
