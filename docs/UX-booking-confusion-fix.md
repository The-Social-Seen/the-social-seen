# UX Spec — Fixing "Already booked" + live "Continue to Payment" (BookingModal)

> **Produced by:** UX Designer agent
> **Date:** 2026-08-12
> **Scope:** `src/components/events/BookingModal.tsx` — `ConfirmStep`'s CTA state machine and the
> "already have a pending booking" recovery experience.
> **Root cause doc:** `docs/AUDIT-booking-confusion-already-booked.md` (F1–F7, H1–H3). Read that
> first — this spec assumes its findings and only designs the user-facing fix.
> **Companion doc (existing, shipped precedent — treat as binding house style for this whole
> problem space):** `UX-REVIEW-pending-payment-visibility.md` covers the `/bookings` page's
> `Payment Pending` badge/card and the abandoned-checkout reminder email. This spec is the
> **third surface** for the same underlying state (`pending_payment`) and deliberately reuses
> its language, tone, and colour decisions verbatim wherever the same situation recurs —
> a member should recognise "Your spot's on hold" whether she sees it in the modal, on
> `/bookings`, or in her inbox.
> **Real incident this fixes:** Anjli Vyas tapped "Continue to Payment" for a £10 ticket, the
> redirect to Stripe was slow on mobile, she tapped again, and was shown a red "Already booked
> for this event" banner sitting directly above a fully-clickable gold "Continue to Payment"
> button — a genuinely contradictory screen for a real paying member.

---

## 0. What's actually broken (one sentence each, from the audit)

- **F2:** The CTA re-enables itself the instant the server call resolves, even though the actual
  browser navigation to Stripe hasn't visibly happened yet — so a slow mobile redirect looks
  identical to "nothing happened," inviting a second tap.
- **F3:** The `'Already booked for this event'` error is rendered as a generic red banner, and
  the CTA underneath it is never swapped or disabled — so the user sees an alarm and a live
  "try again" button for the same thing, side by side.
- **F7:** Closing the modal after seeing this leaves a real, live, money-adjacent
  `pending_payment` row + Stripe session sitting in the member's name for up to 35 minutes with
  no visible trace on this screen.

This spec fixes all three from the user's side of the glass.

---

## 1. CTA state machine (drives everything below)

```
                 tap "Continue to Payment" / "Reserve My Spot"
                              │
                              ▼
                     ┌────────────────┐
                     │   submitting   │   button: spinner + "Reserving…"
                     │ (RPC in flight)│   (UNCHANGED — already correct today)
                     └───────┬────────┘
                              │ server responds
              ┌───────────────┼────────────────────┬─────────────────────────┐
              ▼               ▼                    ▼                         ▼
     success, no          success,          error: existing            error: other
     checkoutUrl          checkoutUrl        booking already           (event full,
     (free / paid-        (paid, happy       exists for this           network fail,
     waitlisted)           path)             user + event              validation, …)
              │               │                    │                         │
              ▼               ▼                    ▼                         ▼
        advance to      ┌──────────────┐   is the existing booking   ErrorAlert (UNCHANGED
        TicketCard       │ redirecting  │   `pending_payment` or        red banner) +
        (step 2,          │ (NEW state)  │   `confirmed`?                CTA re-enabled to
        unchanged)        │ button locked│         │        │            retry the SAME
                          │ "Redirecting │   pending_payment  confirmed  action — this is a
                          │ to payment…" │         │        │            genuine "try again"
                          │ browser is   │         ▼        ▼            case, not the bug.
                          │ leaving —    │  ┌──────────┐ ┌──────────┐
                          │ never reverts│  │ RECOVERY │ │ ALREADY  │
                          └──────────────┘  │  variant │ │ CONFIRMED│
                                             │  (NEW)   │ │ variant  │
                                             └──────────┘ │  (NEW,   │
                                                           │ defensive│
                                                           │ — see §5)│
                                                           └──────────┘
```

**The load-bearing design decision:** the two new "already have a booking" branches
(`pending_payment` / `confirmed`) get their **own dedicated screen content**, not an error
banner bolted onto the unchanged default form. The CTA and the message are one unit. There is
never a moment where a red warning and an unrelated live gold button are both on screen — that
contradiction is the entire bug.

Genuine *other* errors (event sold out between taps, network failure, validation) keep the
existing red `ErrorAlert` + re-enabled CTA pattern exactly as it is today — retrying the same
action there is the correct, non-contradictory behaviour. Do not touch that path.

---

## 2. Screen: Redirecting state (between tap and Stripe actually loading)

**Purpose:** Make the ~1–3s (occasionally longer, on mobile) gap between "server confirmed the
booking + minted a Stripe session" and "the browser has actually left for checkout.stripe.com"
read as unmistakably *in progress*, not frozen or done-and-idle.

**Trigger:** `createPaidCheckout` resolves with `success: true` and a `checkoutUrl`. This is the
exact branch in `handleBook()` that currently only calls `window.location.href = checkoutUrl`
with no accompanying state change (F2).

**Visual treatment — fits the existing button, no new component:**

Same button, same position, same gold fill (`bg-gold`, `rounded-2xl`, full width) as the idle
and submitting states — deliberately *not* greyed out or muted. A locked gold button reads as
"working, on your side" (matches the existing `submitting` treatment); a greyed/disabled-looking
button reads as broken. Keep the existing `Loader2` spin icon (already used for "Reserving…") —
same icon, new label:

| Sub-state | Button label | Icon | Interactive? |
|---|---|---|---|
| `submitting` (unchanged) | `Reserving…` | `Loader2` spin | No |
| `redirecting` (**new**) | `Redirecting to payment…` | `Loader2` spin | No |

**Copy note:** `"Redirecting to payment…"` is not a new phrase — it's lifted verbatim from
`src/components/events/BookingSidebar.tsx:518` (the desktop claim-a-waitlist-spot flow, which
already solves the identical "we're about to leave for Stripe" moment). Reuse it exactly rather
than inventing a sibling string — a member who's seen either surface recognises the same moment
instantly.

**This state never reverts.** The page is leaving. Do not let `isPending`/any transition flip
back to `false` and re-enable the button once `redirecting` is entered — that flip-back is F2,
the actual bug. It only ever ends by the browser navigating away (component unmounts) or —
see the fallback below — by an explicit escape hatch.

**Escape hatch for a genuinely stuck redirect (new — closes a latent "stuck forever" risk):**
Because this state is designed to *never* revert, a redirect that silently fails (blocked
pop-up policy, dead connection, some WebKit edge case per the audit's H1) would otherwise leave
the member staring at a locked, unresponsive button indefinitely — trading one stuck state for
another. After **8 seconds** in `redirecting` with no navigation having happened, reveal a small
subordinate text link beneath the (still-locked) button:

> *"Taking longer than expected? [Continue to Stripe →]"*

Styling: `text-xs text-gold underline underline-offset-2`, centred, appears with a simple fade
(no layout shift — reserve the line's height from the start so nothing jumps). This is
deliberately a quiet text link, not a second button, so it never competes visually with the
primary CTA above it — there is still only one prominent, tappable-looking element on screen.
(Whether this resolves via a fresh `<a href>` navigation or a re-triggered
`window.location.href` is an implementation choice for `frontend-developer` — UX requirement is
only that an exit exists after 8s.)

**Close (X) / Escape key during `redirecting`:** disabled, matching the CTA's locked state — the
same "form is busy, don't let the user act again mid-flight" rule that already governs the CTA's
`disabled={isPending}`. No visual change needed to the X icon itself (just make it inert); this
window is normally sub-2s so a disabled-but-unstyled X won't read as broken. If the 8s fallback
above triggers, re-enable the X at the same time (a genuinely stuck user should always be able to
back out).

**Mobile (375px):** no layout change — same button, same width, same position in the existing
`p-6` step container. The fallback link sits centred beneath it with no width constraints to
worry about.

**Dark mode:** no special-casing. `bg-gold`, `text-white`, `Loader2` all already render correctly
in dark mode in the current `submitting` state — this is the same button, same classes, new
label only.

---

## 3. Screen: Recovery variant — "Your spot's on hold" (the core fix)

**Purpose:** Replace the contradictory red-banner-plus-live-CTA state with one coherent,
non-accusatory screen when the server reports the member already has a **`pending_payment`**
booking for this event (their own in-flight or abandoned first attempt).

**Trigger:** `createPaidCheckout` (or `createBooking`, for symmetry — see note at end of this
section) returns an error indicating an existing booking, and that existing booking's status is
`pending_payment`. **This requires the server to tell the client the existing booking's status
(and ideally its id + `created_at`) rather than the current flat string `'Already booked for
this event'` — flagged as a data-contract dependency for the architect in §8, not something I'm
deciding here.**

**Replaces:** the entire default `ConfirmStep` body below the event summary card — i.e., the
`Special requirements` accordion and the generic `ErrorAlert` + CTA are **not shown together**
with this variant. This variant IS the CTA.

**Layout (top to bottom, same `p-6` container, same event summary card reused unchanged):**

1. Event summary card — **unchanged**, same component, same content (title, date, venue, price
   breakdown if paid). Keeping it gives her the reassurance "yes, this is the event I was
   booking" without re-litigating it.
2. **New recovery panel** — reuses the exact visual pattern already established for an
   "urgent-but-positive, time-boxed opportunity" in this same codebase: the waitlist "claim your
   spot" banner (`src/components/profile/../BookingSidebar.tsx` claim banner —
   `rounded-xl border border-gold/40 bg-gold/5 p-4`). Same container, same family of
   in-progress-not-error styling used by `Payment Pending` everywhere else in the product. This
   is reuse, not a new visual language.
3. Secondary "Start Over" text link + reassurance microcopy, below the panel, quieter.

**Recovery panel content:**

```
┌───────────────────────────────────────────────────┐
│  🕐  Your Spot's on Hold                            │
│                                                     │
│  Looks like you started checking out for this      │
│  event a moment ago — it isn't confirmed yet.       │
│                                                     │
│  🕐 Complete payment by 3:45 PM to keep it.         │  ← only if deadline data available
│                                                     │
│  ┌─────────────────────────────────────────────┐  │
│  │           Resume Checkout                     │  │  ← primary CTA, inside the panel
│  └─────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────┘

              Start Over

  No charge either way — this hold releases on its
        own if you don't complete it.
```

**Exact copy:**

| Element | Copy |
|---|---|
| Panel icon | `Clock` (lucide — already imported in `BookingCard.tsx`, matches the deadline-line icon used on `/bookings`) in a small gold circle, `bg-gold/10 text-gold` |
| Panel heading | **Your Spot's on Hold** |
| Panel body | Looks like you started checking out for this event a moment ago — it isn't confirmed yet. |
| Deadline line (if `createdAt` available) | Complete payment by **{formatTime(deadline)}** to keep it. |
| Deadline line (if no deadline data) — fallback | *(omit the line entirely — do not guess a time)* |
| Primary CTA (idle) | **Resume Checkout** |
| Primary CTA (loading) | Opening secure checkout… |
| Secondary link | Start Over |
| Reassurance microcopy | No charge either way — this hold releases on its own if you don't complete it. |

**Why this exact wording:**
- *"Looks like you started..."* — orienting, not accusatory. She may genuinely not remember
  tapping the button seconds ago on a disorienting mobile redirect; this frames it as "here's
  what happened," not "you made a mistake." Matches the brief's explicit ask.
- *"isn't confirmed yet"* is lifted verbatim from the established `pending_payment` honesty
  phrase in `UX-REVIEW-pending-payment-visibility.md` §3 ("isn't confirmed yet" / "this spot" not
  "your booking") — it is the load-bearing phrase across every surface that shows this state, so
  it stays identical here.
- *"Your Spot's on Hold"* is lifted verbatim from the reminder email's headline (§7 of the
  companion doc: **"Your spot's on hold."**). Same situation, same words, wherever she meets it.
- *"Resume Checkout"* / *"Opening secure checkout…"* — the second string is lifted **verbatim**
  from the already-shipped `Complete Payment` button on `/bookings`
  (`src/components/profile/BookingCard.tsx:258`, `'Opening secure checkout…'`), because it's the
  exact same underlying mechanism (`resumePendingBookingCheckout`, per
  `src/lib/bookings/resume-checkout.ts`) reused from a new entry point. I'm using "Resume
  Checkout" rather than "Complete Payment" as the *idle* label specifically for the modal context
  — she hasn't navigated away from a list to get here, she's mid-conversation with the same
  booking flow she just triggered, so "resume" reads more naturally than "complete" in this
  spot. This is a minor, deliberate divergence — flag if a co-founder or frontend-developer wants
  them to match exactly; either is defensible.
- No exclamation marks, no "Hurry!", no red — matches the calm register locked in by the
  companion doc and by CLAUDE.md's "waitlist is positive, not red" precedent, which this is a
  direct sibling of.
- Reassurance line mirrors the reminder email's footer line ("Changed your mind? No need to do
  anything...") — gives her a guilt-free, low-anxiety "do nothing" option stated explicitly, which
  also quietly discourages panicked re-tapping (the original failure mode).

**"Start Over" behaviour:** tapping it immediately cancels the existing `pending_payment`
attempt (assuming the architect confirms a safe self-service cancel path — see §8) and resets
`ConfirmStep` back to its clean default variant (same modal, same step, fresh form) so she can
retry immediately. **No confirmation dialog** — the action is low-stakes (nothing has been
charged; "Start Over" itself states the intent plainly) and adding a second "are you sure?" step
directly contradicts the "respect their time" principle for an audience with a three-minute
attention span. After it runs, show a brief non-blocking toast (reuse the existing bottom-pill
toast pattern already used by `BookingResumeErrorHandler` —
`fixed bottom-6 ... rounded-full border border-blush/60 bg-bg-card ... shadow-lg`, auto-dismiss):

> *"Started over — you can book again whenever you're ready."*

**Error inside this variant (e.g. `resumePendingBookingCheckout` itself fails — admin hold,
booking already reaped, event cancelled):** these failure strings already exist, are already
brand-appropriate, and are already tested (`src/lib/bookings/resume-checkout.ts` lines 175–289).
**Reuse them verbatim** — render whatever string comes back using the existing `ErrorAlert`
component, positioned *below* the recovery panel (not replacing it), with `Resume Checkout`
re-enabled for another attempt and `Start Over` still available as the permanent way out. Do not
write new copy for these — they're already done and already good.

**Free-event note:** `createBooking()` (free events) has the same underlying "already booked"
guard per the audit (F1's guard is keyed off `status != 'cancelled'`, not payment method). For
symmetry, a free-event double-tap that hits this guard should show the same panel shape with
adjusted copy — but since a free booking confirms instantly (no Stripe round-trip, no
`pending_payment` gap), this branch should essentially never be reachable in practice.
Recommend: fall through to the generic `ErrorAlert` + retry CTA for free events rather than
building a whole second copy of this panel for a case that shouldn't occur — flag to
`frontend-developer` as a "build the pending_payment branch for paid only" scoping call.

---

## 4. Screen: Already-confirmed variant (defensive edge case)

**Purpose:** Per the task brief's point (b) — the server may distinguish `pending_payment`
(recoverable, §3 above) from `confirmed` (already succeeded). A `confirmed` conflict "shouldn't
reach this screen at all" in the intended flow, but a stale client, a double-submit that raced a
webhook, or a delayed page state could theoretically surface it. Design defensively rather than
leaving it to fall into the generic red error path, which would tell a member who is **already
successfully booked and paid** that something went wrong — actively harmful, not just confusing.

**Trigger:** existing conflicting booking's status is `confirmed`.

**Copy (same panel shape as §3, but positive/success framing — no clock, no "hold" language,
no urgency at all):**

| Element | Copy |
|---|---|
| Panel icon | `CheckCircle` (lucide) in `bg-gold/10 text-gold` circle — reusing the gold family, matching this codebase's established convention that `Confirmed` is rendered gold, not the green token CLAUDE.md's table lists (see `BookingCard.tsx` `StatusBadge`, `status === 'confirmed'` → `bg-gold/10 text-gold`) |
| Panel heading | **You're Already Booked** |
| Panel body | Good news — you already have a confirmed spot for this event. No further action needed. |
| Primary CTA | **View My Booking** (`Link href="/bookings"`, same gold button styling) |
| Secondary link | Close (calls existing `handleClose`) |

No deadline line, no "Resume Checkout," no reassurance-about-charges line — none of that applies
to an already-successful booking. Keep it short; this is a rare, defensive state, not a primary
flow to invest heavily in.

---

## 5. Modal-close behaviour (task item 4)

**Recommendation: let it ride — do not proactively cancel the pending booking on close, and do
not show a blocking confirmation dialog. Do show a one-time, non-blocking toast when closing
*from the recovery variant specifically*.**

**Reasoning, weighing the tradeoff explicitly:**

- **Against proactive cancel-on-close:** it optimises for the business (immediate seat release)
  at the cost of surprising a member who genuinely intends to come back in two minutes and finish
  — she taps X to think about the dress code or check her calendar, not to abandon. Silently
  cancelling her hold the moment she taps X punishes completely normal behaviour and would
  reintroduce a *different* invisible-state problem: she'd believe she still has a hold (nothing
  told her otherwise) and be wrong.
- **Against a blocking "are you sure? you'll lose your spot in X minutes" confirm dialog:** this
  is real friction on every single close, for an audience whose defining trait (per the persona
  table) is a three-minute attention span. It also duplicates information she's just been shown —
  the recovery panel she's looking at *right now* already states the deadline.
- **For "let it ride" + a brief toast:** the thing that made the *original* 35-minute-stuck
  problem bad (F7) was that it was **completely invisible** — she'd have no idea anything was
  outstanding until she happened to reopen this exact modal or stumbled onto `/bookings`. That
  invisibility gap is now independently closed by the already-shipped
  `UX-REVIEW-pending-payment-visibility.md` work: the pending booking is visible on `/bookings`
  (gold `Payment Pending` badge + card + cross-tab banner), and a reminder email fires
  automatically. Closing this modal is no longer "losing" anything — it's just closing a window
  onto a state that persists and is discoverable elsewhere. Given that, a lightweight toast is
  enough reinforcement without the cost of a blocking dialog.

**Toast copy (only shown when closing while the recovery variant, §3, is on screen — not on a
plain close from the default idle Confirm step, where no pending row exists):**

> *"We're holding your spot until {formatTime(deadline)} — resume anytime from your bookings."*

(fallback if no deadline data: *"We're holding your spot — resume anytime from your bookings."*)

Style: reuse the exact existing bottom-pill toast (`BookingResumeErrorHandler`'s pattern —
`fixed bottom-6 left-1/2 -translate-x-1/2 rounded-full border border-blush/60 bg-bg-card px-5
py-3 text-sm text-text-primary shadow-lg`), auto-dismiss ~4–5s, `role="status"`.

**Already-confirmed variant (§4) close behaviour:** plain close, no toast needed — nothing is
at risk, "Close" already exists as an explicit secondary action on that screen.

---

## 6. Mobile check — 375px / 390px (task item 5)

The reported bug happened on mobile Safari at roughly this width, and CLAUDE.md specifies a
bottom-sheet modal at mobile widths (already implemented — `isMobile` branch in
`BookingModal.tsx`). All new states above were designed inside the *existing* bottom-sheet
structure, not a new layout:

- **Redirecting state:** same full-width button already at `375px`, no new elements except the
  8s-fallback text link, which is a single centred line with no minimum-width requirement —
  confirmed no wrap/overflow risk even at 320px (iPhone SE), since it's shorter than the button
  label above it.
- **Recovery panel:** the `rounded-xl border ... p-4` container pattern it reuses is the exact
  same container already proven at this width in `BookingSidebar.tsx`'s claim banner (which
  renders inside the same class of mobile viewport on the event detail page today). Icon + heading
  sit on one row (icon is fixed 20–24px, heading text wraps naturally if needed — "Your Spot's on
  Hold" is short enough it won't wrap even at 320px). Body copy and deadline line stack full-width
  below. The CTA button inside the panel is full-width (`w-full`), same `py-4`/`py-3` vertical
  padding convention as every other primary CTA in this modal — clears the 44×44px touch target
  requirement with margin.
- **Start Over link + reassurance line:** stacked, centred, full-width text — no horizontal
  constraint issues. Give "Start Over" enough vertical padding (e.g. `py-2` around the text, not
  just line-height) to clear 44px tap height even though it visually reads as a small link —
  same "pad the invisible hit area" approach CLAUDE.md's accessibility rules already require
  elsewhere in this file.
- **Already-confirmed variant:** shortest of all the new states, no risk at this width.
- **Toast on close:** identical component already rendering correctly at this width elsewhere in
  the app (`BookingResumeErrorHandler` is already a live, shipped, mobile-tested pattern).

No new breakpoints, no new responsive classes needed beyond what the modal's `isMobile` /
`md:` conventions already provide.

---

## 7. Dark mode

No special-casing required anywhere in this spec. Every colour referenced above is an existing
Tailwind token already used elsewhere in `BookingModal.tsx` / `BookingCard.tsx` /
`BookingSidebar.tsx`, all of which already render correctly in dark mode today:

- `bg-gold`, `bg-gold/5`, `bg-gold/10`, `border-gold/40`, `text-gold`, `text-white`
- `bg-bg-card`, `bg-bg-primary`, `text-text-primary`, `text-text-primary/60`, `border-blush/40`,
  `border-blush/60`

This matches the precedent already stated (and verified) in
`UX-REVIEW-pending-payment-visibility.md` §8: *"No new tokens, no new hex... this state inherits
that for free with zero extra dark-mode-specific work."* One thing to carry forward from that
doc into this implementation: the `Clock` / `CheckCircle` icons must be styled via `className`
(`text-gold`), never a literal SVG fill colour — same rule every other icon in this file already
follows (`Calendar`, `MapPin`, `AlertTriangle`).

---

## 8. Accessibility check

- **Keyboard:** `Resume Checkout`, `Start Over`, `View My Booking`, `Close` are all real
  `<button>` / `<Link>` elements, focusable and Enter/Space-activatable, consistent with every
  other action in this file. The redirecting state's disabled button and disabled close/Escape
  must set `aria-disabled`/`disabled` properly (not just visual opacity) so a screen reader
  doesn't announce a tappable control that does nothing.
- **Touch targets:** all new interactive elements meet 44×44px — CTA buttons inherit the
  existing `py-4`/`py-3` classes; the `Start Over` text link needs explicit padding added (flag
  to `frontend-developer` — a bare `<button className="text-sm">` will not clear 44px on its
  own).
- **Colour is never the only signal:** the recovery panel's meaning is carried by its heading
  and body text ("Your Spot's on Hold" / "isn't confirmed yet"), not by the gold colour alone —
  same reasoning already documented and accepted in the companion doc §6 for the identical gold
  treatment on `/bookings`.
- **Heading hierarchy:** no new heading levels introduced; panel heading stays at the same visual
  weight as existing sub-headings in this modal (`text-sm font-semibold`, matching the
  `BookingSidebar` claim-banner heading it's modelled on), not competing with the `h3` step
  heading.
- **Live region for the redirecting state:** recommend `aria-live="polite"` on the button's text
  node (or a visually-hidden sibling) so a screen-reader user gets "Redirecting to payment" and
  isn't left wondering why the previously-announced button went silent/inert.

---

## 9. Data-contract dependencies for the architect (flagging, not deciding)

This spec assumes the following are feasible — I'm not deciding schema/RPC shape, per role
boundary, but the copy above depends on these:

1. The server response for a "you already have a booking" guard-hit needs to distinguish
   `pending_payment` vs `confirmed` (task's own stated assumption (b) — just confirming the UX
   depends on it being real).
2. Ideally, the response also includes the existing booking's `id` and `created_at` (or a
   precomputed deadline) so: (a) the deadline line in §3 can render a real time instead of being
   omitted, and (b) `Resume Checkout` can call the **already-shipped**
   `resumePendingBookingCheckout` flow (`src/lib/bookings/resume-checkout.ts`, currently wired to
   `/bookings`' `Complete Payment` button and the reminder email link) directly from inside this
   modal, rather than building a second checkout-minting code path. This is a genuine "reuse, not
   rebuild" opportunity the original audit already flagged (§5, recommended fix, bullet 2).
3. `Start Over` needs a safe, user-callable "cancel my own pending booking for this event"
   action. `abandonPendingCheckout` already exists and does the right thing server-side (per
   F4/F5 of the audit) but is currently only invoked from a query-param handler, not exposed as a
   general client-callable action — and the audit separately flags it has a small existing bug
   (missing `cancelled_at`) that should be fixed regardless of this feature. Whether it's safe to
   expose a thin wrapper of it as a Server Action callable straight from `BookingModal` is an
   architect call, not mine.

If (2) or (3) turn out not to be feasible in the first pass, the panel degrades gracefully: omit
the deadline line, and/or hide "Start Over" and keep only "Resume Checkout" + the reassurance
line — the core fix (one coherent screen instead of a contradictory banner+button) does not
depend on either.

---

## 10. Summary of copy (single reference table)

| State | Heading | Body | Primary CTA (idle → loading) | Secondary |
|---|---|---|---|---|
| Redirecting (paid, happy path) | *(no heading change — button only)* | — | `Redirecting to payment…` (locked, spinner) | *(after 8s)* "Taking longer than expected? Continue to Stripe →" |
| Recovery (`pending_payment` conflict) | Your Spot's on Hold | Looks like you started checking out for this event a moment ago — it isn't confirmed yet. / Complete payment by **{time}** to keep it. | Resume Checkout → Opening secure checkout… | Start Over · No charge either way — this hold releases on its own if you don't complete it. |
| Already confirmed (defensive) | You're Already Booked | Good news — you already have a confirmed spot for this event. No further action needed. | View My Booking (link) | Close |
| Toast on close (from Recovery only) | — | We're holding your spot until {time} — resume anytime from your bookings. | — | — |
| "Start Over" success toast | — | Started over — you can book again whenever you're ready. | — | — |

---

## HANDOVER
- **Agent:** ux-designer
- **Task:** Design the CTA state machine and copy that fixes the "Already booked for this event"
  + live "Continue to Payment" contradiction in `BookingModal.tsx` — a new locked `redirecting`
  button state, a dedicated non-error "Your Spot's on Hold" recovery screen for a conflicting
  `pending_payment` booking, a defensive "already confirmed" screen, and a close-behaviour
  recommendation (toast, not silent, not blocking).
- **Files changed:** `docs/UX-booking-confusion-fix.md` (created). No source files touched.
- **Migrations planned:** none (design phase).
- **Tests added:** none (design phase) — recommend `frontend-developer`'s regression test cover
  both the audit's suggested case (second `createPaidCheckout` call asserting the CTA is
  replaced, not re-enabled) and a snapshot/RTL check that the red `ErrorAlert` component never
  renders simultaneously with an enabled primary CTA for the `pending_payment`/`confirmed`
  branches specifically.
- **Next agent:** `architect` first, to settle §9's three data-contract questions (does the
  guard-hit response carry `pending_payment` vs `confirmed` + the existing booking's id/deadline;
  is a client-callable "cancel my own pending booking" action safe to add; should
  `resumePendingBookingCheckout` be reused as-is from this new entry point). Then
  `frontend-developer` to implement the state machine in `BookingModal.tsx` against this spec,
  and `backend-developer` (or the same PR, per the audit's own note that it's one file) for the
  `abandonPendingCheckout` missing-`cancelled_at` fix (F4) that "Start Over" will depend on.
- **Risks / open questions:**
  1. §9 — the whole Recovery variant's richest version (deadline time, one-click resume, safe
     start-over) depends on architect decisions not yet made; a degraded fallback is specified
     so this doesn't block, but the richer version is clearly better UX and worth pushing for.
  2. Free-event symmetry (end of §3) — recommending the `pending_payment` panel be built for paid
     events only, since the free-flow gap it would cover is effectively unreachable; flagging
     rather than silently scoping it out.
  3. "Resume Checkout" vs "Complete Payment" label divergence from the already-shipped
     `/bookings` button (§3) is a deliberate, minor choice — flagging in case a co-founder prefers
     identical wording across both surfaces.
