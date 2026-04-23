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
 * Fill /join Step 1 (Account) and click Continue. Waits for the form
 * to advance to Step 2 (Interests) before returning.
 */
export async function fillRegistrationStep1(
  page: Page,
  fields: RegistrationFormFields,
): Promise<void> {
  await page.getByLabel(/full name/i).fill(fields.fullName)
  await page.getByLabel(/email address/i).fill(fields.email)
  await page.getByLabel(/^password$/i).fill(fields.password)
  await page.getByLabel(/phone number/i).fill(fields.phoneNumber)

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

  await page.getByRole('button', { name: /^continue$/i }).click()
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
 */
export async function signInViaForm(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  await page.goto('/login')
  await page.getByLabel(/email address/i).fill(email)
  await page.getByLabel(/password/i).fill(password)
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
