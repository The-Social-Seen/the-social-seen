import type { Page } from '@playwright/test'
import { E2E_EMAIL_PREFIX } from './fixtures'

/**
 * Browser-side helpers for the UI E2E suite — registration form,
 * login form, and OTP verification flow.
 *
 * Every email generated here uses the run-scoped `E2E_EMAIL_PREFIX`
 * so the existing `purgeRun` teardown sweeps the resulting auth.users
 * + profile rows. Inbucket auto-purges as the address is unique per test.
 */

export interface RegistrationFormFields {
  fullName: string
  email: string
  password: string
  phoneNumber: string
  /** Default true so happy-path tests can opt out by passing false. */
  emailConsent?: boolean
  smsConsent?: boolean
}

export function uniqueRegistrationEmail(tag: string): string {
  const suffix = Math.random().toString(36).slice(2, 8)
  return `${E2E_EMAIL_PREFIX}${tag}-${suffix}@test.local`
}

export function uniquePassword(): string {
  return `E2EPass!${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Fill /join Step 1 (Account) and click Continue. Waits for the
 * Step 1 heading to be visible first so framer-motion's slide-in
 * animation has finished before we start typing — otherwise the
 * fields exist in the DOM but Playwright's visibility check fails
 * while the wrapping motion.div is still off-screen.
 *
 * Targets fields by stable `id` attributes (form has `id="name"`,
 * `id="email"`, `id="password"`, `id="phoneNumber"`) to avoid
 * label-text collisions with the Footer's newsletter signup form
 * (which carries `aria-label="Email address for newsletter"`).
 */
export async function fillRegistrationStep1(
  page: Page,
  fields: RegistrationFormFields,
): Promise<void> {
  // Wait for the Step 1 heading so the AnimatePresence slide-in
  // resolves before we type. 10s covers cold-start dev-server hydration.
  await page
    .getByRole('heading', { name: /create your account/i })
    .waitFor({ state: 'visible', timeout: 10_000 })

  await page.locator('#name').fill(fields.fullName)
  await page.locator('#email').fill(fields.email)
  await page.locator('#password').fill(fields.password)
  await page.locator('#phoneNumber').fill(fields.phoneNumber)

  if (fields.emailConsent) {
    await page
      .getByRole('checkbox', { name: /keep me updated/i })
      .check()
  }
  if (fields.smsConsent) {
    await page
      .getByRole('checkbox', { name: /text me venue reveals/i })
      .check()
  }

  // Two "Continue" buttons can exist on /join (Steps 1 + 2 are mounted
  // in the same form, switched by AnimatePresence). Scope to the
  // first visible match.
  await page
    .getByRole('button', { name: /^continue$/i })
    .first()
    .click()
}

/**
 * Pick the first N interests on Step 2, then click Continue. Defaults
 * to 1 — minimum required by the form's validator.
 *
 * Selects via `data-testid="interest-pill"` to scope strictly to the
 * interest grid — a generic `button[type="button"]` filter would also
 * match Header chrome (theme toggle, mobile menu, OAuth button) and
 * "Continue", giving false matches by render order.
 */
export async function fillRegistrationStep2(
  page: Page,
  picks = 1,
): Promise<void> {
  const interestPills = page.getByTestId('interest-pill')
  for (let i = 0; i < picks; i++) {
    await interestPills.nth(i).click()
  }
  await page.getByRole('button', { name: /^continue$/i }).click()
}

/**
 * Submit the login form with email + password and wait for navigation
 * to settle. Does NOT assert success — caller decides what success
 * means (could be `/events`, `/verify`, `/admin`, etc.).
 *
 * Targets by id (`#login-email`, `#login-password`) to avoid the
 * Footer newsletter form's `aria-label="Email address for newsletter"`
 * which otherwise causes a strict-mode `getByLabel` collision.
 */
export async function signInViaForm(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  await page.goto('/login')
  await page
    .getByRole('heading', { name: /welcome back/i })
    .waitFor({ state: 'visible', timeout: 10_000 })
    .catch(() => {
      // Login page heading wording may drift; the field-level wait
      // below catches any actual mount issue.
    })
  await page.locator('#login-email').fill(email)
  await page.locator('#login-password').fill(password)
  await page.getByRole('button', { name: /^sign in$/i }).click()
}

/**
 * Type a 6-digit OTP into the verify-form's digit cells. The form
 * auto-submits when the last cell fills.
 */
export async function typeOtp(page: Page, code: string): Promise<void> {
  if (!/^\d{6}$/.test(code)) {
    throw new Error(`typeOtp: expected 6 digits, got "${code}"`)
  }
  // OtpDigits renders six text inputs of inputMode="numeric". Pasting
  // into the first triggers the auto-distribute path.
  const firstCell = page.locator('input[inputmode="numeric"]').first()
  await firstCell.click()
  await page.keyboard.type(code)
}
