# Feature: refund-fee deduction — frontend implementation

**Agent:** `/project:frontend-developer`. Hand off to `/project:tester` next, then `/project:code-reviewer`.
**Branch to continue:** `feat/refund-fee-deduction` (already exists from backend handover — do NOT branch off main again, and do NOT rebase; the backend's uncommitted diff is your foundation. If git state on entry shows a clean tree, the backend's commit has landed already — proceed normally.).
**Type:** Feature, frontend half. UI changes only — no server actions, no migrations, no Stripe calls. Estimated 6 modified components + 1 new admin component + tests.

**Origin:** Architect spec at [SYSTEM-DESIGN-refund-fee-deduction.md](SYSTEM-DESIGN-refund-fee-deduction.md) §8 (UI surfaces). Backend half is now landed on this branch — exposes new TS types and Server Action signatures listed in "What backend delivered" below.

---

## Single source of truth — read in this order

1. **[SYSTEM-DESIGN-refund-fee-deduction.md](SYSTEM-DESIGN-refund-fee-deduction.md) §8** — every copy string, every UI surface, every line number you need. Copy strings are FINAL — paste verbatim. The architect's §8.9 "cheat sheet" table is your one-stop reference.
2. **CLAUDE.md** — design tokens (LOCKED), accessibility, mobile-first, component patterns. NEVER improvise colours or fonts. ALL colour values come from CSS variables — no literal hex anywhere outside `_shared.ts` (which is email-only).
3. **This prompt** — dispatch sheet, file list, verification.

Where this prompt and the spec disagree, the spec wins. Where the spec says "frontend agent decides", make the call and add a one-line code comment explaining why.

---

## What backend delivered (anchor types for your work)

Don't read backend's diff in detail — these are the signatures you need:

```ts
// src/lib/utils/booking-fee.ts
export function calculateBookingFeePence(eventPricePence: number): number

// src/types/index.ts (Booking interface)
interface Booking {
  // ... existing ...
  booking_fee_pence: number   // NEW — what was charged on top of price_at_booking
  stripe_fee_pence: number    // NEW — actual Stripe processing fee (reporting only; do NOT display)
}

// src/app/(admin)/admin/actions.ts
export async function cancelEventAndRefundBookings(
  eventId: string,
  reason?: string,
): Promise<CancelEventResult>

// Shape of CancelEventResult — verify exact shape via the file before consuming
interface CancelEventResult {
  success: boolean
  error?: string
  summary?: {
    refundedCount: number
    refundedTotalPence: number       // sum of price + fee for paid bookings successfully refunded
    cancelledFreeCount: number
    cancelledWaitlistCount: number
    cancelledPendingCount: number
    failedRefunds: Array<{           // surface in the partial-failure toast / detail page
      bookingId: string
      email: string
      error: string
    }>
    emailedCount: number
  }
}
```

**Pre-migration bookings** (created before the schema bump) have `booking_fee_pence = 0`. All UI fee-disclosure code must branch on `booking.booking_fee_pence > 0` — when 0, render the legacy copy with no fee mention (per locked decision 2 and spec §8.5 line 1050).

---

## File map — what you'll touch

### Modify (existing)

1. **[src/components/events/BookingModal.tsx](src/components/events/BookingModal.tsx)** — lines ~284–293. Replace the current "1 spot × Free / Total" block with the three-row breakdown for paid events. Spec §8.2.
2. **[src/components/events/BookingSidebar.tsx](src/components/events/BookingSidebar.tsx)** — lines 399–410. Cancel dialog copy. Spec §8.5. Use the exact branching shown there.
3. **[src/app/events/[slug]/cancellation-confirmed/page.tsx](src/app/events/[slug]/cancellation-confirmed/page.tsx)** — lines 69–90. `wasRefunded` branch copy tweak (2-3 days → 5-10 days, paragraph reword). Spec §8.6.
4. **`src/components/admin/EventsTable.tsx`** (exact path TBC — grep for the events table component in `src/components/admin/`). Add a "Cancel & Refund" action button on each row that opens the new modal (point 5). If the admin events table doesn't have a per-row action menu today, add the minimal scaffolding; if it does, slot the button in.

### Create (new)

5. **`src/components/admin/CancelEventModal.tsx`** — confirmation modal. Spec §8.8. Four copy variants based on the event's booking mix (confirmed paid / confirmed free / waitlist only / zero). The modal accepts:
   - `event: { id, title, slug }` 
   - `bookingCounts: { confirmedPaid, confirmedFree, waitlisted, totalRefundPence }`
   - `onConfirm: (reason?: string) => Promise<CancelEventResult>`
   - `onClose: () => void`
   
   Use the existing shadcn/ui dialog primitives (look at `src/components/ui/` for `Dialog`, `Button`, etc.). Destructive CTA styling (red/danger token) for "Cancel Event & Refund". Confirm requires a deliberate click — no auto-focus on the destructive button.

### Tests (Vitest + React Testing Library)

6. **`src/components/events/__tests__/BookingModal.test.tsx`** — extend existing tests. Three new cases:
   - Paid event with `event.price = 2000`: breakdown shows `Ticket £20.00 / Booking fee £0.60 / Total £20.60`.
   - Free event: breakdown block NOT rendered (existing "1 spot × Free" rendering preserved).
   - High-price event (`event.price = 5000`): breakdown shows `£50.00 / £1.00 / £51.00`.

7. **`src/components/events/__tests__/BookingSidebar.test.tsx`** — extend existing tests. Three new cases targeting the cancel dialog:
   - `refundEligible: true, booking_fee_pence: 60`: copy renders the fee-aware string with "£0.60 booking fee covers card processing".
   - `refundEligible: true, booking_fee_pence: 0`: legacy copy (no fee mention) — pre-migration booking path.
   - `refundEligible: true, booking_fee_pence: 60`: assert "5-10 working days" appears (not "2-3").

8. **`src/components/admin/__tests__/CancelEventModal.test.tsx`** — new. Test the four copy variants by stubbing `bookingCounts`. Test that the confirm CTA is disabled while the action is in flight. Test that `failedRefunds` from a partial response is surfaced somewhere on the modal post-submit (or hands off to a toast — frontend agent's call on the UX, document the choice).

9. Update **`src/app/events/[slug]/__tests__/cancellation-confirmed.test.tsx`** if it exists (grep). Add a case asserting the new "5-10 working days" copy.

---

## Hard rules

- **Copy strings are FINAL.** Paste verbatim from spec §8. If you find yourself paraphrasing, stop — re-read the spec.
- **Design tokens.** No literal hex anywhere in `src/`. Use the project's CSS variables / Tailwind tokens. The only exception is `src/lib/email/templates/_shared.ts` (email needs hex for cross-client rendering), and backend already touched that. You don't touch email templates.
- **`formatPriceExact` vs `formatPrice`.** Per spec §8.2 line 1014, use `formatPriceExact` in the BookingModal breakdown so prices always show `£20.00` not `£20`. Consistency at the decision point matters. Other surfaces (cards, lists) keep their existing formatter.
- **Pre-migration bookings.** Every fee-disclosure branch MUST guard on `booking_fee_pence > 0`. Spec §8.5 line 1050 has the pattern.
- **Mobile-first.** The cancel dialog is sometimes opened on mobile (booking flow runs on phones in cafes / coffee shops). The new breakdown row must not push the modal off-screen on a 320px viewport. Add a responsive test if the existing modal tests don't cover viewport width.
- **Accessibility.** New "Cancel & Refund" button — ensure focus order, ARIA labels, keyboard navigation work. The destructive CTA must NOT autofocus on dialog open.
- **Dark mode.** Both new UI surfaces (BookingModal breakdown, CancelEventModal) must look right in dark mode. Use the dark-mode CSS variables; don't hard-code light-mode greys.
- **`react-hooks/set-state-in-effect` lint gotcha.** Per my project memory: local lint doesn't always catch this; CI does. If you write any `useEffect` with a direct `setState`, add `// eslint-disable-next-line react-hooks/set-state-in-effect` defensively.

---

## Things you don't need to think about (already handled)

- Stripe Checkout page rendering (line items are configured by backend).
- Booking confirmation email layout (backend already shipped the `priceBreakdown` block).
- Webhook fee capture (backend done).
- `cancelBooking` Server Action partial-refund logic (backend done).
- Event card price display (spec §8.1 — NO CHANGE; ticket-price only on cards).
- BookingSidebar Book Now state pre-click (spec §8.3 — NO CHANGE).

---

## The admin modal's tricky bit: how to populate `bookingCounts`

The `CancelEventModal` shows different copy depending on the booking mix at the moment of confirmation. You need to fetch counts before opening the modal — options:

- **Option A (preferred):** The admin events page (or the EventsTable) already loads each event's bookings for the existing admin view. Reuse the existing data (look at how `getEventBookings` or the events-list Server Action surfaces counts). If it doesn't surface counts directly, add a lightweight derived count on the client.
- **Option B:** New "preview" Server Action `getEventCancelPreview(eventId)` that returns counts + total refund without doing any work. Cleaner separation but adds a round-trip.

Frontend agent's call. My slight lean: **Option A** — keeps the diff smaller and re-uses an existing data flow. Document whichever you pick in a code comment.

---

## Verification before reporting done

1. `pnpm tsc --noEmit` — zero errors.
2. `pnpm lint` — clean. With defensive disables for `react-hooks/set-state-in-effect` if you touched any `useEffect` + `setState`.
3. `pnpm test src/components/events src/components/admin src/app/events` — at minimum these three suites pass. The full suite should also pass — run `pnpm test` once at the end to confirm nothing in the broader test corpus broke.
4. `pnpm build` — succeeds.
5. **Manual screenshot pass** (text description is fine, no need to attach images):
   - BookingModal with a £20 paid event — confirm `Ticket £20.00 / Booking fee £0.60 / Total £20.60` renders.
   - BookingModal with a free event — confirm legacy rendering preserved.
   - Cancel dialog with `booking_fee_pence = 60` — confirm new copy with "£0.60 booking fee".
   - Cancel dialog with `booking_fee_pence = 0` — confirm legacy copy (no fee mention).
   - CancelEventModal — all four variants render (manually toggle the `bookingCounts` stub).
   - Dark mode — both new surfaces look right.
   - 320px viewport — BookingModal doesn't overflow.
6. Confirm `--color-charcoal`, `--color-cream`, etc. design-token CSS variables are used. No literal hex slipped in.

---

## What this PR does NOT do (intentional)

- Does NOT modify EventCard.tsx (per spec §8.1).
- Does NOT modify BookingSidebar pre-click "Book Now" summary (per spec §8.3).
- Does NOT add new analytics events (out of scope; existing `track()` calls preserved).
- Does NOT change the existing waitlist flow UI (only the data model gained a field; UI is unchanged because waitlist views don't show price).
- Does NOT add a refund-retry UI for the partial-failure case — surfacing failed refunds in the toast / modal is enough for v1; admin Stripe-dashboard retry is the manual path.

---

## Done checklist (paste filled-in to your handover)

- [ ] On branch `feat/refund-fee-deduction` (confirmed via `git branch --show-current`).
- [ ] BookingModal.tsx three-row breakdown rendered for paid events; free events unchanged.
- [ ] BookingSidebar.tsx cancel dialog copy updated; both `booking_fee_pence > 0` and `= 0` branches handled.
- [ ] cancellation-confirmed/page.tsx copy tweak applied; 2-3 days → 5-10 days.
- [ ] Admin EventsTable has a "Cancel & Refund" action wired to the new modal.
- [ ] CancelEventModal.tsx written; all four copy variants render; destructive CTA NOT autofocused; loading state disables CTA.
- [ ] `bookingCounts` populated via Option A (re-use) or Option B (new Server Action) — your choice documented in code comment.
- [ ] BookingModal.test.tsx — 3 new cases pass.
- [ ] BookingSidebar.test.tsx — 3 new cases pass.
- [ ] CancelEventModal.test.tsx — full new file covering 4 variants + loading + partial-failure surfacing.
- [ ] cancellation-confirmed test (if exists) — 5-10 days assertion added.
- [ ] No literal hex in any new code outside `_shared.ts` (which you don't touch).
- [ ] `pnpm tsc --noEmit` clean.
- [ ] `pnpm lint` clean.
- [ ] `pnpm test` passes.
- [ ] `pnpm build` succeeds.
- [ ] Dark mode and 320px viewport spot-checked.
- [ ] Conventional commit prefix used (if you commit yourself): `feat(payments): UI for non-refundable booking fee and admin event cancellation`. Otherwise, the planner will fold your work into the backend commit.

---

## After your handover

I'll review your diff and write the tester prompt next (full coverage including E2E if appropriate), then the code-reviewer prompt anchored on the combined backend + frontend diff. Surface anything in the spec that didn't fit when you actually tried to render it — I'd rather hear it now than discover it in review.
