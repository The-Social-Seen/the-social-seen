import { test, expect, type Page } from '@playwright/test'
import {
  createTestEvent,
  createTestUser,
  purgeRun,
  type TestEvent,
  type TestUser,
} from '../helpers/fixtures'
import { getAdminClient } from '../helpers/supabase'
import { signInViaForm } from '../helpers/browser'

/**
 * UI E2E coverage for the refund-fee-deduction admin "Cancel & Refund"
 * flow on `/admin/events`. Tagged `@payments` so it can be run as a
 * focused subset.
 *
 * Scope decisions:
 *
 *   1. Free events ONLY for end-to-end "happy path" coverage. Paid
 *      events route the cancel through `stripe.refunds.create`; we
 *      don't want the E2E suite to hit the Stripe test API on every
 *      run (slow, flaky, and the unit tests already pin the Stripe
 *      call shape — see actions-write.test.ts).
 *
 *   2. Paid + mixed-state events: we still test the PREVIEW step (modal
 *      open + correct copy variant), but we don't submit. Frontend
 *      already covers the in-modal copy variants via Vitest +
 *      jsdom — this E2E confirms the end-to-end wiring of
 *      getEventCancelPreview + EventsTable + CancelEventModal under a
 *      real Next.js + Supabase RLS context.
 *
 *   3. We assume a working /login → /admin route. The auth.spec.ts
 *      suite already pins the auth pipeline; if it's broken, both
 *      suites fail together.
 *
 * Flake mitigation: matches the precedent set by PR #95
 * (`test.describe.configure({ retries: 2 })`). Memory:
 * project_flaky_e2e_daily_notifications.md — CI is bursty under load.
 */

/**
 * Sign in as the seeded admin user, drive the form (not cookie
 * injection) so middleware + Auth cookies are exercised end-to-end.
 * Waits for the redirect to land — admin users go to `/admin` by
 * default but `/events` is the public fallback if a redirect query
 * pulls them there first.
 */
async function loginAsAdmin(page: Page, user: TestUser): Promise<void> {
  await signInViaForm(page, user.email, user.password)
  // Login redirects on success — wait for either /admin or /events
  // (the post-login default lands on /events for non-admins but the
  // app may push admins straight to /admin depending on route).
  await page.waitForURL(/\/(admin|events)/, { timeout: 15_000 })
}

/**
 * Helper to seed a confirmed booking for a user against an event.
 * Bypasses the booking RPC entirely — we're testing the cancel flow,
 * not the create flow.
 */
async function seedConfirmedBooking(
  event: TestEvent,
  user: TestUser,
): Promise<void> {
  const admin = getAdminClient()
  const { error } = await admin.from('bookings').insert({
    user_id: user.id,
    event_id: event.id,
    status: 'confirmed',
    price_at_booking: 0, // free event for the happy-path E2E
  })
  if (error) {
    throw new Error(`seedConfirmedBooking failed: ${error.message}`)
  }
}

/**
 * Open the Cancel & Refund modal for an event on the admin events
 * page. Clicks the desktop icon button — the page renders both desktop
 * and mobile DOM (Tailwind responsive); the desktop button is in the
 * primary action area at the default 1280px viewport.
 */
async function openCancelModal(page: Page, event: TestEvent): Promise<void> {
  await page.goto('/admin/events')
  // Wait until the events table mounts. The page's heading is a
  // stable hook.
  await expect(
    page.getByRole('heading', { name: /events/i }).first(),
  ).toBeVisible({ timeout: 15_000 })

  // Find the row's "Cancel and refund" icon button. EventsTable
  // labels it with the event title for accessibility.
  const cancelTrigger = page.getByRole('button', {
    name: new RegExp(`Cancel and refund ${escapeRegex(event.title)}`, 'i'),
  })
  await cancelTrigger.first().click({ timeout: 15_000 })

  // The modal renders the destructive CTA — pin to it as the
  // "modal is open" signal.
  await expect(
    page.getByRole('button', { name: /Cancel Event & Refund/i }),
  ).toBeVisible({ timeout: 10_000 })
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

test.describe('Admin Cancel & Refund flow @payments', () => {
  // Retries per PR #95 precedent. 30s default + real Supabase + real
  // Next.js dev server = bursty under CI load; 2 retries absorb the
  // slowness without masking a real regression.
  test.describe.configure({ retries: 2 })

  test.afterAll(async () => {
    await purgeRun(getAdminClient())
  })

  // ── Scenario 1: paid + mixed-state event renders the "paid" copy variant ──
  //
  // INVARIANT: opening the modal on an event with confirmed PAID
  // bookings + waitlist + pending shows the paid copy variant with
  // the EXACT total = SUM(price + fee) across confirmed paid.
  // Frontend's Vitest pins the variant rendering with a synthetic
  // prop; this E2E pins the wire from getEventCancelPreview through
  // the Server Action.
  test('1: paid event with mixed bookings shows "paid" copy + correct total', async ({
    page,
  }) => {
    const admin = getAdminClient()
    const adminUser = await createTestUser(admin, {
      tag: 'cancel-paid-admin',
      role: 'admin',
    })
    const event = await createTestEvent(admin, {
      tag: 'cancel-paid-event',
      // 2 confirmed paid + 1 waitlist + 1 pending. Capacity 2 → the
      // pending counts toward seat-count.
      price: 2000,
      capacity: 2,
    })

    // Seed 2 confirmed paid bookings, 1 waitlist, 1 pending_payment.
    // The cancel preview helper sums price + fee on confirmed paid.
    const u1 = await createTestUser(admin, { tag: 'cp-1' })
    const u2 = await createTestUser(admin, { tag: 'cp-2' })
    const u3 = await createTestUser(admin, { tag: 'cp-3' })
    const u4 = await createTestUser(admin, { tag: 'cp-4' })
    await admin.from('bookings').insert([
      {
        user_id: u1.id,
        event_id: event.id,
        status: 'confirmed',
        price_at_booking: 2000,
        booking_fee_pence: 60,
        stripe_payment_id: 'pi_test_1',
      },
      {
        user_id: u2.id,
        event_id: event.id,
        status: 'confirmed',
        price_at_booking: 2000,
        booking_fee_pence: 60,
        stripe_payment_id: 'pi_test_2',
      },
      {
        user_id: u3.id,
        event_id: event.id,
        status: 'waitlisted',
        waitlist_position: 1,
        price_at_booking: 2000,
        booking_fee_pence: 60,
      },
      {
        user_id: u4.id,
        event_id: event.id,
        status: 'pending_payment',
        price_at_booking: 2000,
        booking_fee_pence: 60,
      },
    ])

    await loginAsAdmin(page, adminUser)
    await openCancelModal(page, event)

    // 2 × (2000 + 60) = 4120p = £41.20
    await expect(page.getByText('£41.20')).toBeVisible({ timeout: 10_000 })
    // The "paid" variant copy must mention the refund total and the
    // booking-fee absorption disclosure.
    await expect(page.getByText(/refund a total of/i)).toBeVisible()
    await expect(page.getByText(/absorbed by the platform/i)).toBeVisible()
    await expect(page.getByText(/cannot be undone/i)).toBeVisible()

    // Do NOT submit — we don't want to hit Stripe from E2E.
    await page.getByRole('button', { name: /Keep Event|Close/i }).first().click()
  })

  // ── Scenario 2: free event end-to-end cancel ──
  //
  // INVARIANT: cancelling a free event flips the row to cancelled,
  // sends per-recipient emails (we can't easily assert the email
  // bodies in this run; the unit tests cover those), and the modal
  // transitions to a success state.
  test('2: free event cancel-and-refund completes end-to-end (no Stripe)', async ({
    page,
  }) => {
    const admin = getAdminClient()
    const adminUser = await createTestUser(admin, {
      tag: 'cancel-free-admin',
      role: 'admin',
    })
    const event = await createTestEvent(admin, {
      tag: 'cancel-free-event',
      price: 0, // free — no Stripe calls in the loop
      capacity: 10,
    })

    const member = await createTestUser(admin, { tag: 'cf-member' })
    await seedConfirmedBooking(event, member)

    await loginAsAdmin(page, adminUser)
    await openCancelModal(page, event)

    // Free-variant copy.
    await expect(
      page.getByText(/will cancel the event and notify 1 confirmed member/i),
    ).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText(/No refunds needed/i)).toBeVisible()

    // Submit. Stripe is NOT called for free events (no
    // stripe_payment_id on the row → free branch in the action).
    await page.getByRole('button', { name: /Cancel Event & Refund/i }).click()

    // Success status panel. Scope to role="status" so a leftover
    // "Cancelled" badge on another event row in the same table can't
    // make this assertion pass vacuously. Modal renders
    // `Cancelled "X". No refunds were needed.` for the free path
    // (refundedCount=0).
    await expect(
      page.getByRole('status').filter({ hasText: /Cancelled/i }),
    ).toBeVisible({ timeout: 15_000 })
    await expect(
      page.getByRole('status').filter({ hasText: /No refunds were needed/i }),
    ).toBeVisible({ timeout: 5_000 })

    // Reality-check: the event row in the DB is now is_cancelled = true
    // AND the member's booking has flipped to cancelled. The page in
    // the browser will refresh after modal close, but we assert
    // directly against the DB so the test isn't bound to revalidate
    // timing.
    const { data: refreshedEvent } = await admin
      .from('events')
      .select('is_cancelled')
      .eq('id', event.id)
      .single()
    expect(refreshedEvent?.is_cancelled).toBe(true)

    const { data: refreshedBooking } = await admin
      .from('bookings')
      .select('status')
      .eq('user_id', member.id)
      .eq('event_id', event.id)
      .single()
    expect(refreshedBooking?.status).toBe('cancelled')
  })

  // ── Scenario 3: zero-bookings event ──
  //
  // INVARIANT: cancelling an event with no bookings shows the "empty"
  // copy variant and still flips is_cancelled. No emails sent, no
  // Stripe calls — but the action MUST succeed cleanly.
  test('3: zero-bookings cancel shows empty copy and flips is_cancelled', async ({
    page,
  }) => {
    const admin = getAdminClient()
    const adminUser = await createTestUser(admin, {
      tag: 'cancel-empty-admin',
      role: 'admin',
    })
    const event = await createTestEvent(admin, {
      tag: 'cancel-empty-event',
      price: 0,
      capacity: 5,
    })

    await loginAsAdmin(page, adminUser)
    await openCancelModal(page, event)

    await expect(
      page.getByText(/will cancel the event\. No members will be affected/i),
    ).toBeVisible({ timeout: 10_000 })

    await page.getByRole('button', { name: /Cancel Event & Refund/i }).click()

    // Success status panel — scope to role="status" because the events
    // table behind the modal contains "Cancelled" badges on rows from
    // earlier tests in the same describe block (purgeRun runs in
    // afterAll, not afterEach). Without the role scope, a stale badge
    // makes this pass vacuously and the DB check below races the action.
    await expect(
      page.getByRole('status').filter({ hasText: /Cancelled/i }),
    ).toBeVisible({ timeout: 15_000 })

    const { data: refreshedEvent } = await admin
      .from('events')
      .select('is_cancelled')
      .eq('id', event.id)
      .single()
    expect(refreshedEvent?.is_cancelled).toBe(true)
  })

  // ── Scenario 4: cancelled event no longer shows the Cancel button ──
  //
  // INVARIANT: re-cancelling a cancelled event is meaningless (no money
  // to refund, status already cancelled). EventsTable hides the button
  // on rows where is_cancelled = true. We assert by seeding a
  // pre-cancelled event then confirming the icon button is gone from
  // its row.
  test('4: cancelled event does NOT render the Cancel & Refund control', async ({
    page,
  }) => {
    const admin = getAdminClient()
    const adminUser = await createTestUser(admin, {
      tag: 'cancel-already-admin',
      role: 'admin',
    })
    const event = await createTestEvent(admin, {
      tag: 'cancel-already-event',
      price: 0,
      capacity: 5,
      isCancelled: true,
    })

    await loginAsAdmin(page, adminUser)
    await page.goto('/admin/events')
    await expect(
      page.getByRole('heading', { name: /events/i }).first(),
    ).toBeVisible({ timeout: 15_000 })

    // The button is rendered with aria-label `Cancel and refund <title>`.
    // For an already-cancelled event the button should NOT exist.
    const cancelTrigger = page.getByRole('button', {
      name: new RegExp(`Cancel and refund ${escapeRegex(event.title)}`, 'i'),
    })
    await expect(cancelTrigger).toHaveCount(0)
  })
})
