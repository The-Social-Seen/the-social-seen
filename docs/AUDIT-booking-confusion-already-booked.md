# Bug Triage: "Already booked" + enabled "Continue to Payment" shown simultaneously

**Date:** 2026-08-12
**Mode:** Bug Triage (not a full audit)
**Reporter:** Mobile Safari screenshot, live site, paid-event booking modal
**Affected member:** Anjli Vyas (anjlivyas@gmail.com), event `social-seen-summer-rooftop-party`

---

## Ground truth (provided, trusted, not re-verified by me)

Booking row for Anjli Vyas / rooftop party:
- `status: 'cancelled'`
- `stripe_payment_id: null` (never paid)
- `stripe_checkout_session_id: 'cs_live_b18b...'` (a live Checkout Session WAS created)
- `created_at: 2026-08-12T11:53:24.99Z`
- `updated_at: 2026-08-12T11:53:32.72Z` (+8.72s)
- `cancelled_at: null` — **status is `cancelled` but `cancelled_at` was never set**

That last fact is the single most useful clue in this whole investigation — see Q2/Q4 below.

---

## VERIFIED FINDINGS

### F1 — `book_event_paid`'s "already booked" guard fires on any non-cancelled row, including the caller's own in-flight `pending_payment`
**File:** `supabase/migrations/20260517000002_book_event_paid_with_fee.sql:114-125`
```sql
-- Prevent duplicate active bookings — including pending_payment rows,
-- so a user can't start checkout twice for the same event.
SELECT id INTO v_existing_booking
FROM   public.bookings
WHERE  user_id  = p_user_id
  AND  event_id = p_event_id
  AND  status  != 'cancelled'
  AND  deleted_at IS NULL;

IF FOUND THEN
  RETURN jsonb_build_object('error', 'Already booked for this event');
END IF;
```
Observed: this is a correctness feature (stops a user from starting two Stripe sessions for one event), but it means a *second* click of "Continue to Payment" after a *successful first* click will always return this exact error — because the first click's own `pending_payment` row now blocks the second call. Severity: Important (root mechanism of the reported confusion, not itself broken — see F3 for the actual bug).

### F2 — The client never disables/replaces the CTA while a Stripe redirect is in flight
**File:** `src/components/events/BookingModal.tsx:95-122`
```js
function handleBook() {
    setError(null);
    startTransition(async () => {
      const result = isFree
        ? await createBooking(event.id)
        : await createPaidCheckout(event.id);
      if (!result.success) {
        setError(result.error ?? "Something went wrong. Please try again.");
        return;
      }
      if (result.checkoutUrl) {
        window.location.href = result.checkoutUrl;
        return;
      }
      ...
```
Observed: on the success/checkoutUrl branch, the only side effect is `window.location.href = ...`. No `setState` call follows it. Once this async callback returns, React's `useTransition` resolves `isPending` back to `false` — re-enabling the "Continue to Payment" button (`disabled={isPending}` at line 335) — even though the actual browser navigation to `checkout.stripe.com` (DNS + TLS + page render, external origin, mobile network) has not visibly happened yet. There is no separate "Redirecting to secure payment…" locked state, and no client-side check for "a checkout session already exists for this booking, don't let me submit again." Severity: **Critical** — this is the direct, code-verifiable cause of the button being clickable a second time in the exact window where a first, successful attempt is still resolving.

### F3 — `ErrorAlert` for "Already booked for this event" is rendered identically to every other error, with no special-cased CTA
**File:** `src/components/events/BookingModal.tsx:242-351` (`ConfirmStep`), `599-613` (`ErrorAlert`)
Observed: `error` is a plain `string | null`. The component has no branch that inspects `error === 'Already booked for this event'` to swap the CTA for something like "You're already booked — view your ticket," disable it, or link to `/bookings`. The button at line 333-348 renders unconditionally as `isFree ? "Reserve My Spot" : "Continue to Payment"` regardless of what `error` says. This is exactly the screenshot: red banner + fully enabled, unmodified CTA. Severity: Critical (this is literally the reported bug).

### F4 — `abandonPendingCheckout` sets `status: 'cancelled'` but never sets `cancelled_at`
**File:** `src/app/events/[slug]/actions.ts:642-658`
```js
const { error } = await supabase
    .from('bookings')
    .update({
      status: rollbackStatus,
      is_admin_hold: false,
      admin_hold_expires_at: null,
    })
    .eq('user_id', user.id)
    .eq('event_id', eventId)
    .eq('status', 'pending_payment')
    .is('deleted_at', null)
```
Observed: no `cancelled_at` field in this UPDATE. Compare every other cancellation path in the codebase, all of which DO set `cancelled_at`:
- `cancelBooking` — `src/app/events/[slug]/actions.ts:843` (`cancelled_at: now.toISOString()`)
- `leaveWaitlist` — same file, cancels via a different column shape but doesn't reach this row-shape at all
- `reap-stale-bookings` cron — `src/app/api/admin/cron/reap-stale-bookings/route.ts:117-118` (`cancelled_at: new Date().toISOString()`)
- Stripe `charge.refunded` webhook — `src/app/api/stripe/webhook/route.ts:545-546` (`cancelled_at: nowIso`)
- Admin event-cancel refund flow — `src/app/(admin)/admin/actions.ts:1241` area (`cancelled_at: nowIso`)

`abandonPendingCheckout` is the **only** cancellation code path in the codebase that produces `status = 'cancelled'` with `cancelled_at = null`. This is an exact fingerprint match for Anjli's row. Severity: Important (this is a genuine, separate small bug in `abandonPendingCheckout` — worth a one-line fix — but it's also the forensic evidence that pins down which code path touched her booking).

### F5 — `abandonPendingCheckout` is called from exactly one place: `BookingCancelledHandler`, gated on the `?cancelled=1` query param
**File:** `src/components/events/BookingCancelledHandler.tsx:23-83`, confirmed via `grep -rn "abandonPendingCheckout" src/` — only call site outside the action file itself and its own JSDoc references.
Observed: this component is mounted unconditionally on the event detail page (`src/components/events/EventDetailClient.tsx:174`) and only *does* anything if `searchParams.get('cancelled') === '1'`. That query param is set exclusively by the `cancel_url` Stripe is given in `createPaidCheckout` (`src/app/events/[slug]/actions.ts:325`: `` `${origin}/events/${eventForFee.slug}?cancelled=1` ``) — i.e. it fires when Stripe redirects the browser back after the user backs out of Checkout (Stripe's own "‹ Back" link, or Stripe auto-redirecting on a failed/abandoned attempt), landing on a **fresh page load** of the event page. Severity: n/a (this is the correct/intended cleanup mechanism — flagged here only because it's the mechanism that explains F4/the timing).

### F6 — On that fresh page load, the booking modal defaults to closed
**File:** `src/components/events/EventDetailClient.tsx:91, 133-163`
Observed: `bookingOpen` initialises to `false`. It only auto-reopens via the `?book=1` resume effect, which explicitly requires `userBooking == null` (line 136) and is a *different* query param than `?cancelled=1`. `cancel_url` never sets `?book=1`. So: **the sequence that explains the DB row (F4/F5) cannot, on its own, explain the screenshot** — a return-from-Stripe page load would show the modal closed, not open with a stale error banner. This tells us the screenshot must have been taken from a moment *before* the Stripe redirect / cancel_url round-trip completed, i.e. during the SPA session, not after a fresh page load. See Q4 below for how this reconciles.

### F7 — Closing the modal (X button / backdrop / Escape) never cancels a pending booking
**File:** `src/components/events/BookingModal.tsx:70-85`
```js
const handleClose = useCallback(() => {
    setStep(1);
    setError(null);
    setBookingResult(null);
    onClose();
}, [onClose]);
```
Observed: no Server Action call. If a user reaches the "Already booked" error state and gives up by tapping the X (rather than completing or backing out of Stripe), the `pending_payment` row + live Stripe Checkout Session are left completely untouched — no cleanup, no user-visible trace that a booking exists in their name — until the 35-minute reaper (`src/app/api/admin/cron/reap-stale-bookings/route.ts:110`, `supabase/migrations/20260713000002...` cutoff) eventually cancels it. Severity: Important — this is the "deeper issue" the task asked about in Q5: a user can be left thinking they haven't booked (still on Confirm Details) while a real `pending_payment` row + live Stripe session sits in their name for up to 35 minutes, silently blocking every retry with "Already booked for this event" and offering no way out except waiting or contacting support.

---

## HYPOTHESES (plausible, not independently verifiable from static code)

### H1 — Why the first `window.location.href` redirect wasn't visibly instantaneous
Not verifiable without RUM/Sentry breadcrumb data or a live repro on mobile Safari, but two known WebKit behaviours are consistent with the timeline:
- Programmatic cross-origin navigation issued from inside an already-resolved `async` continuation (i.e. after an `await`, outside the original synchronous click-handler stack) can lose "user activation" in WebKit and be delayed or throttled compared to a same-tick navigation.
- Simple network latency: DNS + TLS + first paint for `checkout.stripe.com` on a mobile connection is commonly 500ms-2s, and during that window the modal (F2) shows no loading state distinct from a normal completed request.
Either way, F2 (no persistent "redirecting" lock state) is the actual bug regardless of which WebKit mechanism caused the visible delay.

### H2 — Reconstructed sequence for Anjli (best-evidenced, reconciles F1-F7 + the timestamps)
1. **T+0.0s** (`created_at` 11:53:24.99): First tap of "Continue to Payment." `createPaidCheckout` runs: `book_event_paid` RPC inserts the `pending_payment` row, Stripe Checkout Session is created and `stripe_checkout_session_id` persisted (`src/app/events/[slug]/actions.ts:298-355`). Response returns `checkoutUrl`; client sets `window.location.href = checkoutUrl` (F2).
2. **T+~1-2s:** Per H1, the navigation hasn't visibly happened yet. Per F2, `isPending` has already flipped back to `false` and the button is re-enabled, with no "redirecting" indicator. Anjli, seeing nothing happen, taps "Continue to Payment" again — a genuine, understandable second tap, not an exotic double-click race.
3. Second `createPaidCheckout` call hits `book_event_paid`'s guard (F1) because her own row from step 1 is still `pending_payment` (not `cancelled`) — returns `{error: 'Already booked for this event'}`. `setError()` renders the red banner (F3); the button re-enables again once this second transition settles. **This is the screenshot.**
4. Sometime in the following few seconds, the delayed first navigation from step 1 finally lands her on Stripe's hosted Checkout page. Confused (she may believe the second, failed attempt was "the" attempt, or simply doesn't recognise the page), she uses Stripe's own back/cancel affordance, which Stripe sends to our `cancel_url` (`?cancelled=1`) per `src/app/events/[slug]/actions.ts:325`.
5. **T+8.72s** (`updated_at` 11:53:32.72): Fresh page load of `/events/social-seen-summer-rooftop-party?cancelled=1`. `BookingCancelledHandler` (F5) fires, calls `abandonPendingCheckout(eventId, {from: 'book'})`, which sets `status: 'cancelled'` **without** `cancelled_at` (F4) — matching the row exactly — and shows the "Payment cancelled — no charge made" toast, then strips the query param.

This reconstruction is consistent with every piece of ground truth given (both timestamps, the null `cancelled_at`, the live session id, the never-set `stripe_payment_id`) and with the screenshot, without requiring any code path that isn't actually in the repo. I can't independently confirm step 4's exact user action (Stripe UI back-link vs. some other route back to `cancel_url`) from static code — that's the one genuinely unverifiable link in the chain — but every *other* step is grounded in a specific file:line.

### H3 — Alternative: true double-tap / ghost-click race
A near-simultaneous double-tap (iOS Safari synthetic/ghost click, or two touch events firing before React commits the `disabled` attribute) could produce the same "Already booked" + enabled-button screenshot even without any WebKit navigation delay. This doesn't change the diagnosis or the recommended fix — F2/F3 are the bug either way — but it's a real alternative to H1 for *why* two attempts happened, worth ruling in/out only if this recurs and Sentry/RUM breadcrumbs are available.

---

## ALREADY TRACKED
Nothing found in `BACKLOG`, open GitHub issues, or `docs/KNOWN-FLAKY.md` referencing this specific confirm-step/CTA-state bug. The related `abandonPendingCheckout` mechanism itself, and the 35-minute reaper, are both intentional, documented, previously-shipped features (not tracked as bugs) — only the missing `cancelled_at` (F4) and the missing UI states (F2, F3, F7) are new findings from this triage.

---

## Answers to the five questions

1. **Where does the checkout-session ID get created?** `createPaidCheckout` in `src/app/events/[slug]/actions.ts:215-379`. Order confirmed: (a) fetch event for price/fee, (b) call `book_event_paid` RPC — inserts `pending_payment` (or `waitlisted` if full) under a row lock, (c) only then create the Stripe Checkout Session and `UPDATE bookings SET stripe_checkout_session_id = ...` (lines 298-353). RPC-then-Stripe, exactly as the user's own trace assumed.

2. **What cancelled the row 8 seconds later with no payment?** `abandonPendingCheckout` (F4/F5), triggered by `BookingCancelledHandler` picking up `?cancelled=1` on a fresh page load — which is Stripe's own `cancel_url` redirect target, not a client-side "cleanup on unmount/close" call (F7 confirms the modal's close button does *not* call it) and not the 35-minute reaper (far too slow) or the refund webhook (requires a payment that never happened). This is the single code path in the entire codebase that produces `status='cancelled'` + `cancelled_at=null`, matching the ground truth exactly.

3. **Why does the UI show both simultaneously?** Because (F2) the CTA button's disabled state is tied only to `isPending`, which resolves back to `false` as soon as the async Server Action call settles — regardless of whether the subsequent `window.location.href` navigation has actually completed — and (F3) the component has no special handling for the `'Already booked for this event'` error specifically. A second click during that gap re-attempts `createPaidCheckout`, hits the RPC's own-row guard, and produces exactly the red banner + fully clickable button shown in the screenshot. Nothing renders it "proactively" — it is always the RPC's error response from a real second attempt.

4. **Most likely sequence for Anjli:** See H2 above. High confidence on the mechanism (double-attempt into the RPC's existing-booking guard, followed by a genuine Stripe-side cancel-url round trip); moderate confidence on the exact reason the first redirect was slow/invisible (H1, unverifiable from static code alone).

5. **Recommended fix (describe only, not implemented):**
   - **CTA state machine, not a boolean.** Replace `isPending`-only gating with an explicit state (e.g. `idle | submitting | redirecting | error`). Enter `redirecting` the instant `checkoutUrl` is returned, keep the button disabled/replaced with "Redirecting to secure payment…" through it, and never return to `idle` for that render (the page is leaving anyway). This closes F2.
   - **Special-case the "Already booked for this event" error.** When `error === 'Already booked for this event'`, don't render the generic CTA — render something like "You already have a pending booking for this event" with a link to `/bookings` (or a "Resume checkout" action, since `src/app/(member)/bookings/resume/[bookingId]/route.ts` / `src/lib/bookings/resume-checkout.ts` already appear to implement a resume-checkout flow — worth reusing rather than building new). This closes F3.
   - **Fix the missing `cancelled_at`** in `abandonPendingCheckout` (`src/app/events/[slug]/actions.ts:642-654`) — one-line addition (`cancelled_at: rollbackStatus === 'cancelled' ? now.toISOString() : null` or similar, mind the `admin_remediation`/`admin_reinstate`/`waitlisted` branches which shouldn't get a cancelled_at at all). Small but real data-integrity gap independent of the main bug.
   - **Consider whether `handleClose` (F7) should also call `abandonPendingCheckout`** when a `pending_payment` booking is known to exist for this event at close time — otherwise a user who gives up after seeing "Already booked" is stuck for up to 35 minutes unable to retry, with no visible indication why. This is the "deeper issue" flagged in the task: the flow can leave a real `pending_payment` row + live Stripe session in a member's name while the UI shows nothing changed.

**HANDOFF NEEDED:** All of the above are implementation changes to `src/components/events/BookingModal.tsx` (CTA state machine + error-specific rendering) and `src/app/events/[slug]/actions.ts` (`abandonPendingCheckout` cancelled_at fix, and possibly wiring a cleanup call into `handleClose`). This belongs with `frontend-developer` for the modal/state-machine work and `backend-developer` (or the same agent, since it's one file) for the `cancelled_at` fix in the Server Action. Recommend the planner write a `prompts/` file scoping exactly these three changes plus a regression test that simulates: (a) first `createPaidCheckout` success leaving `checkoutUrl` unconsumed, (b) a second call landing on the "Already booked" branch, asserting the CTA is replaced/disabled rather than re-enabled.

---

## Build / verification state
This was a read-only diagnostic session. No source files were modified. `pnpm build` / `pnpm tsc --noEmit` were not run (no code changes to verify) — the implementer should run the full checklist from `CLAUDE.md` after applying the fix.
