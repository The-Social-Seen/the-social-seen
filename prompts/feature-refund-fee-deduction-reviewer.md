# Feature: refund-fee deduction — code review

**Agent:** `/project:code-reviewer`. Read-only. Produce a verdict, NOT fixes. If you reject, the planner routes back to the implementing agent.
**Branch under review:** `feat/refund-fee-deduction`. Three commits ahead of `main`:
- `788e9e2 feat(payments): non-refundable booking fee absorbs Stripe processing cost on cancellation` (backend — 28 files, schema + RPCs + Server Actions + webhook + emails + docs)
- `9548688 feat(payments): UI for non-refundable booking fee and admin event cancellation` (frontend — 9 files, BookingModal / BookingSidebar / cancellation-confirmed / EventsTable / new CancelEventModal)
- `5b9c1fa test(payments): refund-fee deduction E2E + security edge cases` (tester — 8 files, 26 new tests: 11 Playwright + 15 Vitest)

42 files total, +7069 / -72.

**Origin:** [SYSTEM-DESIGN-refund-fee-deduction.md](SYSTEM-DESIGN-refund-fee-deduction.md). Agent prompts archived under `prompts/feature-refund-fee-deduction-*.md`.

---

## Read order

1. **The full diff:** `git log -p 788e9e2~1..HEAD` or `git diff 788e9e2~1..HEAD`. Read all three commits, in order. The backend commit is the load-bearing one; frontend layers UI on top; tester adds coverage.
2. **[SYSTEM-DESIGN-refund-fee-deduction.md](SYSTEM-DESIGN-refund-fee-deduction.md)** — the spec the implementation is held against. If anything in the diff diverges from the spec, flag it.
3. **CLAUDE.md** — the rules that bind. Specifically: Database Rules (NON-NEGOTIABLE), Design Tokens (LOCKED), RLS policy table, Testing Requirements.
4. **The four agent prompts in `prompts/feature-refund-fee-deduction-*.md`** — these describe what was asked of each implementer. Useful if you suspect an implementer overstepped or missed something.

---

## What you're looking for

### 1. Security

- **Anon visibility:** new columns `booking_fee_pence` and `stripe_fee_pence` MUST be omitted from anon GRANT. CLAUDE.md secure-by-default rule. Migration `20260517000001` header must document the decision. Verify.
- **RLS:** no policies relaxed. Bookings update / select rules unchanged. Confirm.
- **Admin guards:** `cancelEventAndRefundBookings` and the new `getEventCancelPreview` Server Actions MUST gate on the existing `requireAdmin()` (or equivalent) helper. Confirm both.
- **Service-role usage:** the webhook handler and `cancelEventAndRefundBookings` use `createAdminClient` (service role). Confirm no client-side import path imports `admin.ts` directly.
- **SECURITY DEFINER `search_path`:** the new/recreated RPCs (`book_event_paid`, `claim_waitlist_spot`) should keep `search_path = public` (consistent with existing precedents). Per my project memory, tightening to `public, pg_catalog` is a separate hardening PR — confirm this batch didn't quietly tighten it.
- **`SECURITY DEFINER` invariants:** the recreated `book_event_paid(uuid, uuid, integer)` and `claim_waitlist_spot(...)` RPCs must preserve `FOR UPDATE` row locking on the events table. Confirm the algorithm didn't drift.
- **CHECK constraints:** confirm `chk_bookings_booking_fee_non_negative`, `chk_bookings_stripe_fee_non_negative`, and `chk_bookings_free_no_booking_fee` all exist on the new migration AND that the RPCs respect them (early returns / guards). Tester pinned these — confirm the tests assert what they claim to.
- **Stripe webhook signature verification:** the existing `stripe.webhooks.constructEvent` flow MUST be untouched. New code (`captureStripeFeeForBooking`) runs AFTER signature verification. Confirm.
- **No secret material in any file.** Stripe keys, Supabase service-role keys, anything `.env`-adjacent. Sweep.

### 2. Architecture compliance (CLAUDE.md)

- **15-file batch limit:** CLAUDE.md says no batch may modify more than 15 files. Backend hit 28, frontend 9, tester 8 — 45 total. Backend explicitly flagged this in their handover (the test-fixture cascade from the 2 new required `Booking` fields was unavoidable). **Acceptable per the spec's structural foundation nature, but flag it explicitly in your review so future batches don't drift further.**
- **Migration filename convention:** `YYYYMMDDHHMMSS_<snake_case>.sql`. Confirm both new migrations match.
- **Migration idempotency:** `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, etc. Confirm both new migrations are idempotent.
- **Conventional commits:** all three commits use the right prefix (`feat(payments):` × 2, `test(payments):` × 1). Confirm.
- **`prompts/` files committed:** consistent with prior pattern. Confirm.

### 3. Design tokens (LOCKED)

- **No literal hex** anywhere in `src/` except `src/lib/email/templates/_shared.ts` (CLAUDE.md's documented exception). Sweep the diff for `#[0-9a-fA-F]{3,8}`. Frontend agent claimed compliance; trust but verify.
- **Tailwind tokens / CSS variables only** in new components (`CancelEventModal.tsx`, the BookingModal `PriceBreakdown` sub-component). Confirm.

### 4. Accessibility

- **`CancelEventModal`:**
  - Destructive CTA NOT autofocused on open (tester pinned this).
  - Keyboard navigation through the modal — Tab / Shift+Tab / Esc.
  - Failed-refunds expandable list is screen-reader-accessible (not just a hidden div).
- **`EventsTable` mobile button** must be ≥ 44×44px (WCAG SC 2.5.5, CLAUDE.md mobile rule). Tester added a `min-h-[44px]` assertion — confirm the styling actually delivers this in dark mode + at 320px.
- **BookingModal breakdown:** semantic markup (`<dl>`, `<dt>`, `<dd>`?) over divs where possible. Frontend agent's call — but flag if they used a plain table or div soup that breaks screen-reader logic.

### 5. Edge case completeness

The spec listed 10 edge cases plus 1 "Extra". For each, confirm:

1. **Double-cancel race (idempotency):** test exists at `cancel-booking-races.test.ts`. Confirm it asserts `idempotencyKey` is stable across calls.
2. **`charge.refunded` partial refund:** architect confirmed no webhook code change needed. Confirm the diff doesn't touch `handleChargeRefunded`.
3. **Admin manual full-refund via Stripe dashboard:** intentional escape hatch. Documented in JSDoc?
4. **`refund_window_hours = 0`:** no refund issued; cancellation still flips status. Existing behaviour. Test coverage?
5. **Free event, `booking_fee_pence = 0`:** CHECK constraint + RPC guard + Server Action layer. Three layers of defence. Tester pinned the CHECK and RPC guards — confirm Server Action is also covered or note as gap.
6. **`booking_fee_pence > 0` on free event:** blocked at CHECK + RPC. Tester pinned.
7. **VAT:** intentionally deferred. Follow-up in `docs/FOLLOW-UPS.md` — confirm entry exists.
8. **Refund delta vs actual Stripe fee:** platform absorbs. `stripe_fee_pence` captures the actual fee for reporting. Confirm the webhook helper writes it.
9. **Stripe rate changes:** constants in `src/lib/utils/booking-fee.ts`. No DB migration needed. Confirm constants are not in env.
10. **Existing `pending_payment` bookings at migration time:** default `booking_fee_pence = 0`. Pending sessions auto-expire. Acceptable.
11. **Extra — admin cancels event mid-checkout:** Sentry tag fires. Tester added the assertion at `admin-mid-checkout-race.test.ts`. Confirm the tag string (`surface: 'refund-reconcile'` per tester's flagged risk #3) matches whatever production Sentry filter expects.

### 6. Specific things flagged by implementing agents

Each of these is a known concern — confirm the diff handles it well or surface as a deficiency:

- **Backend's surprise: `createPaidCheckout` and `claimWaitlistSpot` restructured** to fetch event BEFORE the RPC (was AFTER). Same data, different control flow. Read both functions and confirm: (a) the early-return for missing event is correct, (b) no state mutation happens between read and write that would race, (c) error messages still surface correctly.
- **Frontend's scope expansion: new `getEventCancelPreview` Server Action.** Read-only, admin-gated, called from the admin events page when opening the cancel modal. Confirm: (a) admin gate is the same helper used elsewhere, (b) the SELECT touches no PII anon shouldn't see, (c) the COUNT/SUM aggregation matches what the modal renders.
- **Frontend's UX adaptation: spec said "success toast / partial-failure toast"; frontend used in-modal status panels** because there's no toast system in the codebase. Reasonable — but confirm the in-modal failed-refunds list is copyable (so admin can paste IDs into Stripe).
- **Tester's question: Sentry tag string.** `surface: 'refund-reconcile'` — does this match what production Sentry alerting actually filters on? If you have access to the Sentry config, verify. Otherwise flag as a manual operator-verification step.
- **Tester's deliberate gap: paid cancel end-to-end NOT E2E-tested.** The Vitest unit tests cover the call shape; the wire from Server Action → live `stripe.refunds.create` is not E2E. Acceptable for v1 (avoids hitting real Stripe in CI), but flag as a follow-up.
- **Migration apply still unverified locally.** Backend + tester both lacked Docker. The Playwright RPC security suite is the regression gate but requires a running local Supabase. **The operator MUST run `supabase db reset` locally OR rely on a Vercel preview deploy before merge.** Document this clearly in your verdict.

### 7. Code quality

- **Naming:** Server Actions, helper functions, types — descriptive, consistent with codebase patterns.
- **Comments:** CLAUDE.md says "default to no comments; only when WHY is non-obvious". Sweep for unnecessary commentary. Sweep for missing WHY comments on the non-obvious bits (e.g., the formula, the idempotency keys, the "first-write-wins" `eq('stripe_fee_pence', 0)` guard in the webhook helper).
- **Error messages:** per my project memory (PR #101), admin Server Action errors must interpolate `${error.message}`. Confirm the new `cancelEventAndRefundBookings` and `getEventCancelPreview` follow this pattern.
- **JSDoc on `cancelBooking`:** updated to reflect partial-refund semantics per spec §6.3. Confirm.

---

## Verification you can run (optional, read-only)

```bash
# Lint compliance on the whole branch
pnpm tsc --noEmit
pnpm lint

# Test suite
pnpm test

# Build
pnpm build

# Optional — only if you want to see the full diff
git diff 788e9e2~1..HEAD --stat
```

These commands are safe (no DB writes, no Stripe calls). You're not required to run them — the implementers and tester confirmed all green — but they're available for sanity.

---

## Verdict format

Produce a single response with:

### 1. Verdict
One of: **APPROVE**, **APPROVE WITH NITS**, **REQUEST CHANGES**, **REJECT**.

- **APPROVE:** no issues found, ship as-is.
- **APPROVE WITH NITS:** ship-able, but tiny stylistic / non-blocking items are listed for the next round.
- **REQUEST CHANGES:** material issues that should be fixed before merge. List them with file:line and rationale. Planner will route back to the relevant agent.
- **REJECT:** fundamental design or security issue that requires rethinking. Rare.

### 2. Blocking findings
Numbered list. For each:
- File path and line number (or "diff-wide" if cross-cutting).
- What's wrong.
- Why it's blocking.
- Suggested resolution (high-level — you're not implementing).

### 3. Non-blocking nits
Bullet list. Same format, but explicitly marked as "ship optional".

### 4. Compliments
Up to 3 things that were done particularly well. Tester / backend / frontend will see this — useful for calibrating future work.

### 5. Operator action items (pre-merge, post-merge)
The MUST-DO list for the human pushing this to prod:
- `supabase db push --include-all --linked` (post-merge migration apply — per my project memory).
- Whatever else you spotted that the operator must verify, run, or set up before merge.

---

## What you do NOT do

- Do NOT edit any file.
- Do NOT commit anything.
- Do NOT spawn another agent.
- Do NOT propose new features.
- Do NOT relitigate the locked product decisions (inclusive total, eat-the-fee on admin cancel, no backfill).

Your output is text. The planner will act on your verdict.