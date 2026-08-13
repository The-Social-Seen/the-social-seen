# System Design: Paid-checkout "Already booked" confusion fix

**Date:** 2026-08-12
**Author:** architect
**Input:** `docs/AUDIT-booking-confusion-already-booked.md` (bug triage, trusted, re-verified below)
**Scope:** technical contracts only — no code, no copy. UX copy/flow is `ux-designer`'s job; implementation is `frontend-developer` (BookingModal state machine) + `backend-developer` (Server Action changes).
**Status:** design complete, ready to hand off. **See "CRITICAL — separate finding" below before starting implementation — it changes the shape of Decision 3.**

---

## 0. Verification of the audit's file/line citations (re-checked against current code)

All five root-cause findings hold at current HEAD, with these precise locations (line numbers drifted slightly from the audit's citations because the audit was written against an in-progress view; content is identical):

| # | File | Confirmed |
|---|------|-----------|
| F1 | `supabase/migrations/20260517000002_book_event_paid_with_fee.sql:114-125` | Confirmed — `status != 'cancelled'` guard, correct behavior, not a bug. |
| F2 | `src/components/events/BookingModal.tsx:95-122` (`handleBook`) | Confirmed — success branch does `window.location.href = result.checkoutUrl; return;` with no state update; `disabled={isPending}` on the CTA at line 335. |
| F3 | `src/components/events/BookingModal.tsx:242-351` (`ConfirmStep`), `601-613` (`ErrorAlert`) | Confirmed — `error` is `string \| null`, rendered identically regardless of content; button text/disabled state doesn't branch on `error`. |
| F4 | `src/app/events/[slug]/actions.ts:642-658` (`abandonPendingCheckout`'s `.update(...)`) | Confirmed — no `cancelled_at` in the payload. Plain TypeScript `.update()` call, **not** SQL/RPC. |
| F5/F7 | `src/components/events/BookingCancelledHandler.tsx`, `src/components/events/BookingModal.tsx:70-75` (`handleClose`) | Confirmed — `handleClose` has zero Server Action calls; `abandonPendingCheckout` fires only from the Stripe-redirect `?cancelled=1` path. |

I also read the adjacent self-service "resume checkout" system (`src/lib/bookings/resume-checkout.ts`, `src/app/(member)/bookings/actions.ts`'s `resumePendingCheckout`, `src/app/(member)/bookings/resume/[bookingId]/route.ts`) because it changes the right answer to Decisions 2 and 3 below — **a fully-built, tested "mint a fresh Stripe session for my own pending_payment booking" flow already exists and is reachable today from `/bookings`.** The fix should route users into that flow, not build a parallel one.

---

## CRITICAL — separate finding, not in original scope, flag before implementation starts

While verifying whether it's safe to let a member self-trigger `abandonPendingCheckout` (Decision 3), I found that the function's existing trust model is already broken for its **current, shipped** caller, independent of anything in this task.

**`abandonPendingCheckout(eventId, { from })` picks the booking's rollback destination purely from the client-supplied `from` string, with no corroborating check against the row's actual history.** `from` reaches this function via `BookingCancelledHandler.tsx:42-48`, which reads it straight from `useSearchParams().get('from')` — a plain, user-editable browser query param.

Concretely: `from: 'admin_remediation'` rolls the booking to **`status: 'confirmed'`** (`actions.ts:633-635`), not `'cancelled'`. Any authenticated member with an ordinary self-service `pending_payment` booking (created via the normal `createPaidCheckout` flow — no admin hold involved) can navigate to:

```
/events/<any-paid-event-slug>?cancelled=1&from=admin_remediation
```

and get their own unpaid `pending_payment` row flipped straight to `confirmed` — a free ticket to a paid event, with zero Stripe interaction. The WHERE clause on the UPDATE (`actions.ts:655-658`) checks `user_id`, `event_id`, `status = 'pending_payment'`, `deleted_at IS NULL` — **it never checks `is_admin_hold`**, so there is nothing distinguishing a legitimate admin-created hold row from a bog-standard self-checkout row.

`from: 'admin_hold'` / `from: 'claim'` are lower severity (they roll back to `'waitlisted'`, not `'confirmed'`) but have the same shape of bug: a member can force their own plain booking onto the waitlist queue via a code path that was never meant to produce a waitlist entry, polluting `waitlist_position` ordering.

**I verified the discriminator that's missing:** `admin_promote_waitlist_to_hold` (`supabase/migrations/20260713000002_admin_promote_waitlist_to_hold_rpc.sql:213`) sets `is_admin_hold = true` when it creates a hold — that flag genuinely distinguishes "this row went through an admin flow" from "this row is a plain self-checkout." Legitimate `claim`-flow rows don't set `is_admin_hold`, but they do retain a non-null `waitlist_position` through the `pending_payment` transition (per the webhook's own comment, `route.ts:185-189`) — that's the discriminator for the `claim` branch specifically.

**Recommended fix (spec-level, for whoever picks this up — likely `backend-developer`, as its own small hotfix PR, not bundled into this task's diff):** before honoring a `from` value that produces anything other than the safe default (`'cancelled'`), re-fetch the row's current `is_admin_hold` and `waitlist_position` and require:
- `admin_remediation` → only honored if `is_admin_hold = true` on the row right now; else coerce to `'book'`/`'cancelled'`.
- `admin_hold` / `claim` → only honored if `is_admin_hold = true` OR `waitlist_position IS NOT NULL`; else coerce to `'book'`/`'cancelled'`.
- `admin_reinstate` / `book` (default) → unaffected either way, both already resolve to `'cancelled'`, the safe outcome.

This is a **pure TypeScript change** inside `abandonPendingCheckout` (one extra `SELECT` before the branch, or fold the check into the existing UPDATE's WHERE via a `CASE`-free two-step). No migration required — `is_admin_hold` and `waitlist_position` already exist on `bookings`.

**I'm flagging this to the planner as a P0 hotfix candidate, separate from this task.** It's demo-visible, financially real (bypasses Stripe entirely on paid events), and exploitable by any logged-in member today with nothing more than editing a URL — no dev tools needed. It should probably land *before or alongside* this fix, not after, and it directly constrains Decision 3 below (I am **not** recommending the new self-service "cancel my stuck checkout" action take a client-supplied `from` at all — see Decision 3).

---

## 1. CTA lock state contract

**Problem:** `isPending` (from `useTransition`) resolves back to `false` the instant the `startTransition` callback returns — regardless of whether `window.location.href = checkoutUrl` has actually completed the cross-origin navigation. There is no state that represents "we're leaving for Stripe, do not re-arm this button."

**Is there a legitimate reason the current code lets `isPending` reset here?** No. Once `checkoutUrl` is returned, the component's only remaining job is to navigate away — nothing in the current code depends on the CTA re-enabling in that branch. This is an artifact of using `isPending` as the sole gating signal, not an intentional behavior. A fix that adds an independent "redirecting" flag that's set and never reset (for the lifetime of this mount) breaks nothing else in the component: `TicketCard`/`step` machinery is untouched, the free-event and waitlist branches don't pass through this state at all, and the error branch already returns early before reaching it.

**Contract:**
- Introduce a separate boolean local state, e.g. `isRedirecting`, distinct from `isPending`. Set it `true` in the same tick `checkoutUrl` is received, immediately before calling `window.location.href = checkoutUrl`. **Never** set it back to `false` from this render tree — the page is leaving. (If the modal is later reopened fresh — new `isOpen=true` mount — state resets naturally via component remount/key, that's fine and not the same instance.)
- The CTA's `disabled` prop becomes `isPending || isRedirecting`, and its label swaps to a locked "Redirecting to secure payment…" copy (ux-designer's exact wording) whenever `isRedirecting` is true, taking priority over the existing `isPending` spinner label.
- **Safety-valve recommendation (closes the H1 WebKit-delay risk without any new Server Action call):** retain the `checkoutUrl` itself in state (currently discarded). A few seconds after entering the redirecting state, reveal a plain, secondary-styled fallback link/button pointing at that same stored `checkoutUrl` — "Not redirected? Tap here." Clicking it just re-issues `window.location.href` to the identical URL already returned by the first successful call; it is not a new submission, hits no Server Action, and can't retrigger `book_event_paid`'s guard. This is the cleanest fix for the "nothing visibly happens for 1-2s on mobile Safari" symptom (H1/H3 in the audit) — no new round-trip, no new race, just makes the existing wait visible and actionable. Exact delay/copy is ux-designer's call; I'd suggest starting the fallback link visible no later than ~4s so it's there well before a user gets impatient enough to consider tapping again.
- Defensive note for whoever implements this: wrap the `window.location.href = checkoutUrl` assignment in a `try { } catch { }`. `checkoutUrl` always comes from Stripe's own `session.url` today so this should never throw in practice, but if it ever does, catch it, reset `isRedirecting` to `false`, and surface a generic error — don't leave the user stuck on a locked button with no escape and no fallback link rendered yet.

---

## 2. "Already booked" error contract

**Question:** does this need an RPC/migration change, or can the Server Action layer determine "pending vs confirmed" itself?

**Recommendation: Server Action layer only. No RPC signature change, no migration.**

Reasoning:
- I checked every `jsonb_build_object('error', ...)` return across every migration in this repo (`book_event`, `book_event_paid`, `claim_waitlist_spot`, `admin_promote_waitlist_to_hold`, the admin reinstate RPCs) — **none of them carry a machine-readable `code` field today.** They're all plain `{error: <human string>}`. Adding a `code` field to exactly one RPC's error shape, for exactly one error case, would be a novel, un-followed convention introduced under time pressure for what is fundamentally a UI-information problem, not a booking-logic problem.
- The information the UI needs (does the caller's OWN existing row have status `pending_payment`, `confirmed`, or `waitlisted`?) is already visible to the caller under the existing `bookings_select` RLS policy (`user_id = auth.uid()`) — no new grant, no new RLS, no admin client needed.
- `createPaidCheckout` already holds a user-scoped `supabase` client and the caller's `user.id` in scope at the exact point it receives `result.error === 'Already booked for this event'`.

**Contract — add to `createPaidCheckout` only** (not `claimWaitlistSpot`; see note at the end of this section):

When (and only when) the RPC's jsonb response is `{ error: 'Already booked for this event' }`, run one extra `SELECT` before returning:

```
select id, status
from bookings
where user_id = <user.id> and event_id = <eventId>
  and status != 'cancelled' and deleted_at is null
order by created_at desc
limit 1
```

Map the result onto two new, additive, optional fields on `ActionResult`:

```
errorCode?: 'already_booked_pending' | 'already_booked_confirmed'
          | 'already_booked_waitlisted' | 'already_booked_other'
existingBookingId?: string   // populated only for 'already_booked_pending'
```

- `status === 'pending_payment'` → `errorCode: 'already_booked_pending'`, `existingBookingId: id`. This is the case the UI needs to distinguish — "resume or cancel your in-flight checkout," feeding `existingBookingId` straight into the already-built `resumePendingCheckout(bookingId)` Server Action (`src/app/(member)/bookings/actions.ts`) for the "Resume checkout" affordance, and into the new self-service abandon action (Decision 3) for "Cancel and try again."
- `status === 'confirmed'` → `errorCode: 'already_booked_confirmed'`. Per CLAUDE.md/RLS, this branch genuinely "shouldn't have been reachable at all" the way the task framed it — but it's cheap to distinguish and lets the UI say "You're already booked — view your ticket" instead of a generic error, in case it's ever hit (e.g. a stale client that didn't refresh `userBooking` before opening the modal).
- `status === 'waitlisted'` → `errorCode: 'already_booked_waitlisted'`.
- Anything else (`no_show`, or the lookup itself returning no row — a genuine TOCTOU possibility if the reaper cancels the row in the gap between the RPC call and this SELECT) → fall back to the current plain generic error string, no `errorCode`. This is a safe regressive fallback, not a crash: the UI's existing generic `ErrorAlert` path is unchanged for this case.

**Cost:** one extra indexed `SELECT` (the existing "one active booking per user+event" constraint implies an index on `(user_id, event_id)` already exists), on the **error path only** — never on the happy path. Negligible.

**Note — `claimWaitlistSpot` is out of scope for this fix.** It doesn't have the identical duplicate-guard shape (it transitions the caller's own existing waitlisted row rather than checking for a second one), so I don't believe it's exposed to the same "second tap during redirect" confusion in the same way. Worth a quick look by whoever implements this in case the same CTA-lock gap (Decision 1) applies there independently — flagging, not designing here (out of the given scope).

---

## 3. Self-service "abandon my stuck pending checkout" contract

**Given the CRITICAL finding above, my answer here is narrower than the task assumed.** `abandonPendingCheckout` is the right underlying mutation to reuse — its rollback-status branching logic (`from: 'claim'` → `'waitlisted'`, `from: 'admin_remediation'` → `'confirmed'`, etc.) is exactly right *when the `from` value is trustworthy*. It is **not** safe to expose that function directly to a new client-invocable UI path with an open `from` parameter, because nothing today stops a client from claiming `from: 'admin_remediation'` regardless of the row's real history (see CRITICAL finding).

**Contract — a new, narrowly-scoped Server Action, not a new cancellation code path:**

```
abandonMyStuckCheckout(eventId: string): Promise<ActionResult>
```

(name is a suggestion for `backend-developer`/`frontend-developer` to bikeshed — the shape matters more than the name)

- Lives alongside `abandonPendingCheckout` in `src/app/events/[slug]/actions.ts` (same file, same auth pattern, same `'use server'` boundary — no new file needed).
- Takes **`eventId` only**, mirroring `abandonPendingCheckout`'s own signature — the client never needs to know the booking's id for this to work (it can derive its own pending row exactly the way `abandonPendingCheckout` already does, via `user_id + event_id + status = 'pending_payment'`). This also means Decision 2's `existingBookingId` isn't strictly required for THIS action to work, though it's still useful for the "Resume checkout" affordance which does need a booking id (`resumePendingCheckout(bookingId)`).
- Steps:
  1. Auth check (existing pattern).
  2. Fetch the caller's own `pending_payment` booking for this event: `id, stripe_checkout_session_id, stripe_payment_id`, scoped by `user_id = auth.uid()` (RLS + explicit `.eq` — defence in depth, matches `resumePendingBookingCheckout`'s own pattern). If no row matches, return `{ success: true }` — idempotent no-op (nothing to abandon means the desired end state is already true; don't error).
  3. **Stripe pre-check (the part that's genuinely new, and specific to this path only):** if `stripe_checkout_session_id` is set, call `stripe.checkout.sessions.retrieve(sessionId)` and inspect `payment_status`/`status`, mirroring the webhook's own fulfillment-eligibility gate (`route.ts:136-140`). If it indicates the session is already paid or comped (`payment_status === 'paid'`, or `payment_status === 'no_payment_required' && status === 'complete'`), **do not cancel** — return a distinct error (e.g. `{ success: false, error: 'Your payment just went through — refreshing your booking…' }`) and let the client revalidate/refetch instead. If the Stripe API call itself throws (network blip, not a positive "paid" answer), log to Sentry and **proceed with the cancellation anyway** — fail-open on the check itself, fail-closed only on a confirmed "yes this is paid" answer. Reasoning: the true race window (payment completing in the exact seconds between the confusing error screen and a deliberate "cancel and retry" click) is narrow and low-probability; blocking the user's only fast escape hatch on a transient network error to `stripe.com` would reintroduce the 35-minute-stuck problem this whole feature exists to remove, for a much more common failure mode than the race it's guarding against.
  4. If the pre-check passes (or there's no session id to check), delegate the actual mutation to the existing function with a **hard-coded** `from`: `return abandonPendingCheckout(eventId, { from: 'book' })`. Never pass a client-supplied `from` through to it. This closes the CRITICAL-finding class of bug for this new path specifically, by construction — it can only ever produce `'cancelled'`, never `'confirmed'`/`'waitlisted'` via this route.
- **Idempotent by construction**, inherited from `abandonPendingCheckout`: a second call either finds no `pending_payment` row (step 2 short-circuits) or hits the same no-op UPDATE guard.
- **Why not add the Stripe pre-check to `abandonPendingCheckout` itself, for all callers?** The existing `?cancelled=1` caller (`BookingCancelledHandler`) only fires because *Stripe itself* redirected the browser to our `cancel_url` — Stripe does not send users to `cancel_url` after a successful payment (that's what `success_url` is for), so that path is not exposed to the same race. Adding a synchronous Stripe API round-trip to every abandon, including that already-safe, already-fast, already-common path, would add latency for zero safety benefit. Scope the pre-check to the new self-service entry point only.

---

## 4. `cancelled_at` fix

Confirmed: this is a **pure TypeScript Server Action fix**, not SQL/RPC. `abandonPendingCheckout`'s `.update(...)` at `actions.ts:642-654` is a plain Supabase `.from('bookings').update()` call; `cancelled_at` is an existing `timestamptz` column on `bookings` already set by every other cancellation path (`cancelBooking`, the reaper, the refund webhook, admin event-cancel). No migration needed.

**Exact fix:** add a `now = new Date()` (not currently declared in this function) and extend the update payload:

```
cancelled_at: rollbackStatus === 'cancelled' ? now.toISOString() : null,
```

Applies uniformly across all four branches by virtue of keying off `rollbackStatus` (the already-computed variable), not `options.from` directly:
- `'book'` (default) and `'admin_reinstate'` → `rollbackStatus = 'cancelled'` → `cancelled_at` gets stamped. Correct — both genuinely land the row in `cancelled` state as of now.
- `'admin_remediation'` → `rollbackStatus = 'confirmed'` → `cancelled_at: null`. Correct — explicitly clears any stale value rather than leaving a `confirmed` row with a non-null `cancelled_at`, which would be an inconsistent combination no other code path produces.
- `'claim'` / `'admin_hold'` → `rollbackStatus = 'waitlisted'` → `cancelled_at: null`. Same reasoning.

This one-line-plus-one-declaration change should ship regardless of what happens with the CRITICAL finding above or Decisions 1-3 — it's an independent, low-risk data-integrity fix.

---

## 5. Should `handleClose` proactively abandon a known pending booking?

**Recommendation: No — do not make the generic close (X / backdrop / Escape) silently cancel anything. Route this through the explicit "Cancel and try again" affordance from Decision 3 instead.**

Weighing it out:

**For auto-abandon-on-close:** removes the 35-minute stuck window for users who give up by closing rather than backing out through Stripe.

**Against, and why it outweighs the "for" here:**
1. **Silent destructive action.** Closing a modal is universally understood as "dismiss the UI," not "cancel my transaction." An invisible side effect on a plain close button — no confirmation, nothing the user actively chose — is a surprising-data-loss pattern the rest of this codebase avoids (every other destructive booking action — `cancelBooking`, `leaveWaitlist` — is its own explicit button the user deliberately clicks).
2. **It can race the same Stripe-payment-just-completed window flagged in Decision 3**, but with *less* signal to guard against it: a plain "X" tap doesn't carry the same "I've deliberately decided to give up" intent a dedicated "Cancel and try again" button does, and a naive auto-abandon-on-close wouldn't naturally get the Decision 3 Stripe pre-check unless it's explicitly wired to call `abandonMyStuckCheckout` too (at which point it's not really "just closing" anymore, it's the same action with a different trigger — same risk profile, more places to get the trust boundary right).
3. **Near-capacity risk the task itself flagged:** a user who closes intending to resume in a minute (e.g. checking their card, switching to WiFi) shouldn't lose a contested seat instantly just because they tapped X, especially since Decision 3 already gives them a fast, explicit, ~seconds-not-35-minutes way to release it if they *do* want to.

**What I'd hand to `ux-designer` instead of a silent auto-cancel:** `handleClose` should be able to distinguish "nothing to lose" (no pending booking was created this session) from "there's a live pending checkout for this event" (the client already knows this — it received `bookingId`/`checkoutUrl` back from a successful `createPaidCheckout` call earlier in this same mount, currently discarded on the `checkoutUrl` branch per Decision 1's note about retaining that URL). When the latter is true, closing could show a small **interstitial choice** instead of closing immediately — "You have a pending checkout for this event: [Resume checkout] [Cancel it] [Keep it, close anyway]" — turning the close into a confirmable decision rather than an automatic side effect. That's copy/flow, ux-designer's call entirely; the technical contract I'm handing over is just: **the modal needs to retain, in state, whether *it* created a pending booking this session (and that booking's id) so `handleClose` has something to branch on** — today that information is thrown away the instant `window.location.href` is called.

---

## Summary of contracts for implementers

### `src/components/events/BookingModal.tsx` (frontend-developer)
- New local state: `isRedirecting: boolean` (never reset once true), `redirectUrl: string | null` (retained, not discarded).
- CTA `disabled` = `isPending || isRedirecting`; locked copy while `isRedirecting`.
- Fallback manual link to `redirectUrl`, revealed after a short delay (ux-designer to spec exact timing/copy).
- `error` handling gains a branch on the new `errorCode` field (Decision 2) instead of rendering every error identically — `already_booked_pending` gets a distinct CTA (Resume via `resumePendingCheckout(existingBookingId)`, or Cancel via the new `abandonMyStuckCheckout(event.id)`) instead of the plain "Reserve/Continue" button.
- `handleClose` gains an optional interstitial when a pending booking is known to exist (Decision 5) — copy/flow from ux-designer, technical hook is retaining `existingBookingId`/`bookingResult` in state rather than discarding it.

### `src/app/events/[slug]/actions.ts` (backend-developer)
- `createPaidCheckout`: add the one extra `SELECT` + `errorCode`/`existingBookingId` fields on the `'Already booked for this event'` branch (Decision 2). Extend `ActionResult` with the two new optional fields.
- `abandonPendingCheckout`: add `cancelled_at` to the update payload, keyed off `rollbackStatus` (Decision 4) — ship this regardless of everything else.
- New `abandonMyStuckCheckout(eventId)`: Stripe pre-check + hard-coded `from: 'book'` delegation to `abandonPendingCheckout` (Decision 3).

### Separate, urgent (P0 candidate, own PR, not bundled into this fix)
- `abandonPendingCheckout`'s `from`-driven branch selection needs a server-side corroborating check (`is_admin_hold` / `waitlist_position`) before honoring anything other than the safe `'cancelled'` default — see CRITICAL finding.

---

## Migration plan

**None.** Every change above is TypeScript-only (Server Actions + one Client Component). `cancelled_at`, `is_admin_hold`, and `waitlist_position` all already exist as columns; RLS already permits the reads/writes needed (`bookings_select`/`bookings_update`: `user_id = auth.uid()`). No RPC signature changes, no new tables, no new policies.

## Dependency map

1. Decision 4 (`cancelled_at`) — independent, ship any time, no dependency on anything else.
2. Decision 2 (`errorCode`/`existingBookingId` on `createPaidCheckout`) — must land before/alongside the BookingModal changes that consume it.
3. Decision 3 (`abandonMyStuckCheckout`) — depends on nothing new, but its UI trigger depends on Decision 2's `existingBookingId` (or plain `eventId`, since the action doesn't strictly need the id) and Decision 1's retained state.
4. Decision 1 (CTA lock state) — independent of 2/3, but the "Already booked (pending)" special-case button (fed by Decision 2) needs Decision 1's `isRedirecting`/state-retention groundwork to be in place first for a clean single-pass BookingModal rewrite rather than two separate patches.
5. Decision 5 (close interstitial) — depends on 1 and 3 both existing (needs the retained booking-id state from 1, and the cancel action from 3).
6. CRITICAL finding fix — fully independent, own PR, can land in parallel with or ahead of 1-5.

Suggested implementation order: 4 → 2 → 1 → 3 → 5, with the CRITICAL finding as a parallel-track P0.

## Risk assessment

- **Regression risk on the happy path:** near-zero. Decisions 1/2/4 are additive (new optional fields, new state, one extra SELECT on an error branch that today already fails the user). Decision 3 is a brand-new function; it doesn't touch any existing call site.
- **Stripe API load:** Decision 3 adds one `sessions.retrieve` call per self-service abandon attempt — a rare, user-initiated, non-hot-path action. Negligible.
- **Rollback plan:** every change here is behind normal Server Action / component boundaries with no schema change — reverting is a plain code revert, no data migration to unwind.
- **Test coverage to request from `tester`:** (a) `createPaidCheckout` returns `errorCode: 'already_booked_pending'` + `existingBookingId` on a genuine double-call; (b) `abandonMyStuckCheckout` refuses to cancel when the Stripe session pre-check reports paid/comped; (c) `abandonMyStuckCheckout` proceeds and is idempotent on a second call; (d) `abandonPendingCheckout`'s `cancelled_at` is set for `'book'`/`'admin_reinstate'` and null for `'admin_remediation'`/`'claim'`/`'admin_hold'`; (e) BookingModal's CTA never re-enables after a successful `checkoutUrl` response in a component test that stubs `window.location`.

## Open questions for ux-designer (handing off now)

1. Exact copy + timing for the "Redirecting to secure payment…" locked CTA and its fallback link (Decision 1).
2. Exact copy/CTA layout for the `already_booked_pending` special-cased error state — "Resume checkout" vs "Cancel and try again," which is primary (Decision 2/3).
3. Whether/how the `handleClose` interstitial (Decision 5) should look, and its exact three-way copy ("Resume" / "Cancel it" / "Keep it, close anyway") — I've only specified that it must be an explicit, confirmable choice, never a silent auto-cancel.
4. Copy for the narrow "your payment just went through" refusal case in Decision 3 (should probably just close the modal and let the page's existing `userBooking`-driven UI reflect the real state on next render/revalidate, rather than inventing new modal copy for a case that should self-resolve in seconds).
