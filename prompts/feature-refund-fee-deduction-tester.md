# Feature: refund-fee deduction — test coverage

**Agent:** `/project:tester`. Hand off to `/project:code-reviewer` next.
**Branch to continue:** `feat/refund-fee-deduction` (two commits ahead of `main` — backend at `788e9e2`, frontend at `9548688`).
**Type:** Tests only. No production-code changes (except trivial fix-ups if you find a genuine bug — flag it, don't smuggle features in). Mostly E2E coverage, security edge cases, and tightening the existing unit tests where backend/frontend left gaps.

**Origin:** [SYSTEM-DESIGN-refund-fee-deduction.md](SYSTEM-DESIGN-refund-fee-deduction.md). Backend and frontend already wrote unit tests against their own code; your job is to fill the gaps they flagged in their handovers, add Playwright E2E coverage where it matters, and probe the security boundaries.

---

## Read first

1. **The two commits on this branch.** `git log -p 788e9e2..HEAD` will show you everything that needs testing. Don't re-read the spec end-to-end — read the commits.
2. **Backend handover risks** (already implemented but flagged for your attention):
   - Local migration sanity check **was not run** (no Docker in the agent's worktree). Migrations were `psql`-parse-checked only.
   - `claim_waitlist_spot` overwrites `booking_fee_pence` on waitlisted→pending transition — the original snapshot at waitlist join is lost. This is intentional but worth a test asserting the current behaviour so a future refactor doesn't quietly change it.
   - `cancelBooking` test mocks now assert the `amount` arg on `refunds.create` — backend already added this. **Verify it's there, and add a regression test that fails if someone removes the `amount` arg.**
   - Admin-mid-checkout race: admin cancels event while user is mid-Stripe-checkout → user pays, webhook can't reconcile, charge is orphaned. No real fix; Sentry tag logged. **Add an integration test asserting the Sentry tag fires** so we don't accidentally lose the breadcrumb in a refactor.
3. **Frontend handover risks** (already implemented but flagged for your attention):
   - No E2E coverage on the new admin cancel flow.
   - `EventsTable` mobile cards add a fourth tap target — existing test asserts exactly 3 buttons in the primary action row. **Verify that test still passes**; add a 320px viewport test that covers the new mobile button.
   - Toast spec language was interpreted as in-modal status panels because no toast system exists. Tests already cover the in-modal behaviour. No action needed beyond a sanity read.
   - `FailedRefund.userEmail` (vs spec's documented `email`) — tests already use the actual export. Confirm.

---

## What the existing tests cover (don't duplicate)

Backend already shipped (132 files / 1708 tests at backend handover, now 133 / 1724 with frontend):

- `src/lib/utils/__tests__/booking-fee.test.ts` — formula returns + algebraic properties.
- `src/app/events/[slug]/__tests__/actions.test.ts` — `cancelBooking` with `refunds.create({ amount })` assertions; new 2000p partial-refund test.
- `src/app/api/stripe/webhook/__tests__/route.test.ts` — `paymentIntents.retrieve` mocks; BalanceTransaction success / throw / no-charge paths.
- `src/app/(admin)/admin/__tests__/actions-write.test.ts` — `cancelEventAndRefundBookings` happy path, partial-failure, non-admin rejection, missing event, non-paid statuses, zero bookings, idempotent re-run.
- `src/lib/email/templates/__tests__/event-cancelled.test.ts` — 4 variants.
- `src/lib/stripe/__tests__/checkout.test.ts` — new `unit_amount = price + fee`, metadata fields.

Frontend already shipped:

- `src/components/events/__tests__/BookingModal.test.tsx` — 3 new cases (paid breakdown, free fallback, high-price).
- `src/components/events/__tests__/BookingSidebar.test.tsx` — 4 new cases (fee-aware copy, legacy copy, 5-10 days assertion, regression for the days-string change).
- `src/components/admin/__tests__/CancelEventModal.test.tsx` — 10 cases (4 variants + singular grammar + 4 lifecycle + 1 a11y).

**Do NOT duplicate these.** Audit them first (read each test file) and only add cases that fill genuine gaps.

---

## What to build

### A. Playwright E2E — the highest-value gap

Frontend flagged no E2E for admin cancel flow. The most valuable E2E flows for this feature:

1. **End-to-end paid booking with fee disclosure** (~15 mins to write):
   - Auth as a member.
   - Visit a paid event page.
   - Open BookingModal — assert the three-row breakdown renders with `£20.00 / £0.60 / £20.60` (or whatever the seed data uses).
   - Continue button takes user to a Stripe Checkout URL (mock or stub — DO NOT test the Stripe page itself; assert the URL is built correctly).
2. **End-to-end cancellation with partial refund**:
   - Auth as a member with a confirmed paid booking >48h out.
   - Click cancel.
   - Assert the dialog copy shows `"refund £20.00"` and `"£0.60 booking fee covers card processing"`.
   - Confirm the cancellation.
   - Assert the cancellation-confirmed page shows "5-10 working days".
   - This requires either (a) mocking `stripe.refunds.create` for the E2E run, or (b) seeding the DB with a fixture booking that has `stripe_payment_id = 'pi_test_xxx'` and expecting the real Stripe test API to be hit. Check what pattern other E2E tests in the repo use — match it.
3. **Admin event cancellation with mixed booking states** (~30 mins):
   - Auth as admin (`mitesh50@hotmail.com` per CLAUDE.md).
   - Visit `/admin/events`.
   - Click "Cancel & Refund" on an event with 3 confirmed paid + 1 waitlist + 1 pending.
   - Assert the modal shows the "confirmed paid" copy variant with the correct total.
   - Confirm.
   - Assert the in-modal success panel shows the refund count.
   - Assert the event row updates / is hidden.

Look at existing Playwright tests under `e2e/` or `playwright/` directory (grep for `.spec.ts` and `playwright`). Match conventions — fixtures, page objects, auth helpers.

**If there is NO existing Playwright setup**, that's a real gap — but a separate stretch goal. Write the Vitest integration tests in B below first; flag the missing E2E as a follow-up in `docs/FOLLOW-UPS.md`.

### B. Security edge cases (Vitest integration)

Every one of these should be a new test or a tightening of an existing test. None of these are covered today:

1. **Anon cannot read `booking_fee_pence` or `stripe_fee_pence` on bookings.** Per backend's anon-visibility decision in migration `20260517000001`. Write a test using an anon-key Supabase client that asserts `SELECT booking_fee_pence FROM bookings` returns null / undefined / fails. Look at `src/lib/__tests__/user-interests-text-column-migration-guard.test.ts` for the pattern of anon-visibility guard tests.
2. **Authenticated user cannot read another user's `booking_fee_pence`.** Should already be blocked by existing `bookings_select` RLS (own-bookings only); confirm.
3. **Non-admin calling `cancelEventAndRefundBookings` is rejected.** Backend already has this test — confirm it asserts the correct error message and 401/403 status.
4. **`book_event_paid(uuid, uuid, -100)` (negative fee) is rejected.** The CHECK constraint should fire. Test via a direct RPC call with an invalid arg.
5. **`book_event_paid(uuid, uuid, 60)` on a FREE event (price = 0) is rejected.** The `chk_bookings_free_no_booking_fee` CHECK should fire. Plus the RPC has an early-return guard per spec §3.2. Test both.
6. **Double-cancel race idempotency** (spec §9 edge case 1). Simulate two simultaneous `cancelBooking` calls for the same booking. Stripe's `idempotencyKey: refund-booking-${id}` should make the second call return the same refund. The DB UPDATE's `.eq('status', 'confirmed')` optimistic lock should make the second UPDATE no-op. Net result: one refund, no double-credit, no DB inconsistency. Test via two parallel awaits with a shared mock Stripe.
7. **Admin-mid-checkout race** (spec §9 "Extra"). Hard to test E2E. Approximate it: simulate a `checkout.session.completed` webhook arriving for a booking that's already `cancelled`. Assert the webhook handler logs `"no pending_payment booking matched"` AND emits a Sentry breadcrumb with the surface tag. The backend's webhook test file has a similar pattern.

### C. Mobile / 320px viewport (RTL or Playwright)

Frontend flagged a gap. The new `EventsTable` mobile-card "Cancel & Refund" button needs:

- Visibility test at 320px width — confirm button renders, doesn't overflow.
- Click target ≥ 44×44px per WCAG / CLAUDE.md mobile rules (the existing button styling should handle this; just confirm).
- Existing 3-buttons-in-primary-row test still passes (frontend flagged this — go verify).

If E2E setup exists, this fits naturally there with viewport configuration. Otherwise a Vitest + RTL test with a forced viewport works.

### D. The migration apply test — backend's biggest gap

Backend couldn't run `supabase db reset` (no Docker). You MAY have Docker. Try:

```bash
which docker && docker info && supabase start && supabase db reset
```

If it works: run the test suite against the fresh schema. If `pnpm test` still passes, the migrations are confirmed sound and you should report this prominently in your handover.

If Docker is not available, document it the same way backend did and flag it as a manual step the user must run before merge. **Do not block on this** — it's a verification gap, not a blocking issue.

### E. Things you might find — minor fixes only

You're not allowed to add features. But if you find:

- A flaky test (per my project memory, Playwright E2E flake is a recurring theme — `test.describe.configure({ retries: 2 })` if you write Playwright tests for this feature, per the precedent in `auth.spec.ts` and `venue-reveal.spec.ts`).
- An obviously wrong assertion (e.g., a test that's passing for the wrong reason).
- An import path or type that's broken in a way tsc didn't catch.

Fix it inline and call out the fix in your handover.

---

## Hard rules

- **No new features.** If you think production code needs a behaviour change, stop and surface it.
- **No new dependencies.** Use what's in `package.json`.
- **Migration sanity check is verification, not production.** Never run anything against the real `linked` Supabase — `supabase db reset` is local only. If you find yourself reaching for `supabase db push`, stop.
- **Playwright flake mitigation.** If you write E2E, add `test.describe.configure({ retries: 2 })` per my project memory's flake pattern (PR #95 set the precedent).
- **No literal hex in test files.** Same rule as everywhere else.
- **Tag your Playwright tests** with `@payments` or similar so they can be run as a focused subset during CI.

---

## Verification before reporting done

1. `pnpm tsc --noEmit` — zero errors.
2. `pnpm lint` — clean.
3. `pnpm test` — full suite passes. Report the new test count.
4. If you wrote Playwright: `pnpm playwright test` (or whatever the project's E2E command is — grep `package.json` scripts).
5. `pnpm build` — succeeds.
6. If you ran `supabase db reset` locally — note this prominently. If you didn't, document why.

---

## What this PR does NOT do

- Does NOT add a refund-retry queue (out of scope; admin uses Stripe dashboard).
- Does NOT add a VAT test (out of scope; deferred).
- Does NOT add E2E tests for the booking-confirmation EMAIL HTML (test the template's TS output, not the rendered email — that's the existing template-test pattern).
- Does NOT change the `cancelEventAndRefundBookings` Server Action behaviour. If the spec needs an amendment, raise it; don't patch around it.

---

## Done checklist (paste filled-in to your handover)

- [ ] On branch `feat/refund-fee-deduction` (no new commits — just additions).
- [ ] Audited existing tests; no duplication of backend / frontend coverage.
- [ ] **A. Playwright E2E** (or, if no Playwright setup: documented as follow-up):
  - [ ] Paid booking with fee disclosure E2E.
  - [ ] Cancellation partial-refund E2E.
  - [ ] Admin event cancellation E2E (mixed booking states).
- [ ] **B. Security edge cases** (Vitest):
  - [ ] Anon cannot read `booking_fee_pence` / `stripe_fee_pence`.
  - [ ] Authenticated user cannot read another user's fee fields.
  - [ ] Non-admin `cancelEventAndRefundBookings` rejected (confirm existing test asserts error code).
  - [ ] `book_event_paid(_, _, -100)` rejected.
  - [ ] `book_event_paid(free_event, _, 60)` rejected (CHECK + RPC guard).
  - [ ] Double-cancel race idempotency.
  - [ ] Admin-mid-checkout race — webhook no-op + Sentry breadcrumb asserted.
- [ ] **C. Mobile / 320px**: new mobile button visibility + 44×44px touch target; existing 3-buttons-in-primary-row test still passes.
- [ ] **D. Migration apply**: `supabase db reset` run locally (or documented as gap).
- [ ] **E. Minor fixes** documented if any.
- [ ] `pnpm tsc --noEmit` clean.
- [ ] `pnpm lint` clean.
- [ ] `pnpm test` passes. Report new total test count.
- [ ] `pnpm build` succeeds.
- [ ] Conventional commit (you commit yourself this time, since planner won't add value beyond what you've shipped): `test(payments): refund-fee deduction E2E + security edge cases`.

---

## After your handover

Code-reviewer is next. They'll get a prompt anchored on the full three-commit diff (backend + frontend + your tests). Surface anything you found that's worth a reviewer's deliberate look — a fragile mock, a feature surface that's hard to test, an edge case that surprised you.
