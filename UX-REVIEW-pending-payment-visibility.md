# UX-REVIEW addendum — Pending-payment visibility

> **Produced by:** UX Designer agent
> **Date:** 2026-08-08
> **Status:** DRAFT — copy is first-pass, ready for implementation but flagged items (Section 8) need a human/co-founder call before this ships to real members
> **Scope:** `/bookings` pending-payment card + badge, and the abandoned-checkout reminder email
> **Companion doc:** architect's parallel spec covers reaper timing, RPC/session-resume mechanics, and the exact cutoff window. This doc assumes a deadline timestamp is available to plug into copy — it does not decide *when* that deadline is.
> **Real incident this fixes:** Amaya Kaur has a `pending_payment` booking for Summer Rooftop Party. It's visible to admins, invisible to her. She believes she's booked. She isn't, yet.

---

## 0. The problem, stated as a user story

> "I paid — or I thought I did. I'm not seeing anything wrong, so I'm not checking my bookings page again. If I don't finish, I lose the spot with zero warning, and the first I'll hear about it is... never, unless I notice the event isn't in my calendar."

Two failure points to close:
1. **She can't see the state today.** `splitBookings()` (`src/lib/utils/bookings.ts`) only buckets `confirmed` and `waitlisted` — `pending_payment` rows fall through every filter and render nowhere on `/bookings`.
2. **She gets no nudge.** The only pending_payment email that exists today (`bookingConfirmationTemplate`'s `pending_payment` branch) fires once, immediately, at checkout start — before she's even left the Stripe tab. If she abandons checkout, nothing follows up.

---

## 1. Flow diagram

```
Stripe Checkout abandoned (tab closed / back button / distracted)
         │
         ▼
booking row stays status='pending_payment'
         │
         ├──▶ [T+~15-20 min, architect's call] Reminder email sent
         │         │
         │         ├─ Clicks "Complete Payment" ──▶ Stripe Checkout (resumed) ──▶ paid ──▶ webhook confirms ──▶ /events/[slug]/booking-success ("You're booked.")
         │         │
         │         └─ Ignores email
         │
         ├──▶ She opens app anytime, taps "Bookings" ──▶ Upcoming tab
         │         │
         │         ├─ Sees "Payment Pending" card + banner ──▶ taps "Complete Payment" ──▶ same Stripe flow as above
         │         │
         │         └─ Ignores it
         │
         ▼
[T+35-50 min, architect's call] Reaper cancels the row (status='cancelled')
         │
         ▼
Next time she opens /bookings: card is gone from Upcoming (no longer pending),
booking shows in no tab at all (cancelled + not user-initiated) — see
Section 8, open question 6, for the gap this leaves.
```

---

## 2. Decision 1 — Badge: label, colour, placement

**Label:** `Payment Pending`

**Colour:** Gold family — same token as `Confirmed` and `Waitlisted` (`bg-gold/10 text-gold`), **not** `danger`/red.

**Why gold, not red — justification against the existing semantics table:**

Looking at how `StatusBadge` (`BookingCard.tsx` lines 159–188) already uses colour: `danger` (red) is reserved for exactly one thing — `Cancelled` — a *terminal, negative* outcome that already happened. `gold` covers every *active, non-terminal* state where the member still has some claim on a spot: `Confirmed` and `Waitlisted #N` are both gold, distinguished from each other purely by label text, not colour. `pending_payment` fits that second bucket precisely: it's not a failure, it's in-progress, and (per the capacity logic in `spots_left`, PR #114) the system is genuinely holding inventory for her right now. Colouring it red would:
- Misrepresent severity — nothing has failed yet — and,
- Break the "waitlist is positive, not red" precedent CLAUDE.md already locks in, which this scenario is a direct sibling of (an in-progress, recoverable state, not a rejection).

**Why it still needs to read as distinct from `Confirmed` despite sharing a colour:** the codebase's own precedent is "same colour, different label" (Confirmed vs. Waitlisted already do this) — so a gold `Payment Pending` pill is legible as its own state without inventing a fourth colour. To further de-risk a quick-scanning Charlotte/Amaya glancing at the card, back the badge up with the card-body copy and CTA (Section 3–4) so no one confirms "I'm booked" from the badge colour alone. See Section 6 (accessibility) — the label text carries the meaning; colour is reinforcement, not the sole signal, satisfying the "don't rely on colour alone" rule regardless.

**Placement:** Same slot as the existing badge, next to the category tag chip, above the event title. No change to layout.

```
<CategoryTag /> <StatusBadge: "Payment Pending" — bg-gold/10 text-gold>
```

---

## 3. Decision 2 — Card body copy for the pending-payment state

Renders in the same slot as the existing `variant === 'waitlisted'` positive-copy block (`BookingCard.tsx` lines 90–94) — i.e. directly under the date/venue meta rows, above the actions row. Triggered on `booking.status === 'pending_payment'` (not on `variant`, since these cards live inside the `upcoming` tab — see Section 5).

**Explainer line** (text-tertiary, text-xs, same weight as the existing waitlist copy):

> "You started checking out but didn't finish — this spot isn't confirmed yet."

**Deadline line** (bold-ish, gold, with a small Clock icon — see Section 4 for the exact pattern):

> "Complete payment by **{deadline}** to keep it."

Full block, stacked:

```
You started checking out but didn't finish — this spot isn't confirmed yet.
🕐 Complete payment by 3:45 PM to keep it.
```

Notes on wording:
- "isn't confirmed yet" is the load-bearing honesty phrase — it stops her reading the card as proof she's booked, which is the exact bug we're fixing. Never say "your booking" unqualified in this state; always "this spot" / "your held spot," never "your confirmed spot."
- "didn't finish" is neutral, not blaming ("you abandoned checkout" would read as an accusation; premium brands don't scold their members).
- Deliberately no exclamation marks, no red, no "Hurry!" — matches the calm register the brand already uses for waitlist copy.

---

## 4. Decision 3 — Resume-payment CTA

**Label:** `Complete Payment`

**Style:** **Primary**, not secondary. This is the single action that prevents a real loss (unlike "Add to calendar" or "Share," which are conveniences). It should look exactly like the primary CTA the member already trusts from `booking-success` page — same gold-fill, rounded-full, white-text button (`rounded-full bg-gold px-6 py-2.5 text-sm font-semibold text-white`), not a text link and not the outlined secondary button style used for "Add to calendar."

**Placement:** First item in the actions row, replacing "Add to calendar" / "Share" for this state (those already only render when `booking.status === 'confirmed'` per the existing conditional, so no extra guard needed there — just add a new conditional for `pending_payment`). `View Event` stays as the secondary text link, after the button.

```
[ Complete Payment ]   View Event
```

**Loading state on click:** No spinner icon (site-wide rule). Button becomes disabled and its label swaps to `Opening secure checkout…` while the resume/redirect request is in flight. Reverts or navigates away — no dead-end state.

**Weighing urgency vs. calm tone:** the button earns primary/gold treatment (loud enough to notice) but the *label* stays plain and functional ("Complete Payment," not "Complete Payment Now!" or "Don't Lose Your Spot!"). Urgency lives in the deadline microcopy next to it, not in the button text — keeps the premium register while still being the most visually dominant element on the card.

---

## 5. Decision 4 — Deadline pattern + where pending_payment renders

### Deadline copy pattern (generic — backend plugs in the real timestamp)

Use an **absolute, static time**, not a live ticking countdown:

> `Complete payment by {formatTime(deadline)} to keep it.` → e.g. *"Complete payment by 3:45 PM to keep it."*

Reasoning: a ticking `29:58 … 29:57 …` countdown is the visual language of flash-sale/scarcity marketing sites (Booking.com red banners) — it's effective but reads as aggressive and cheap, the opposite of "Soho House meets Time Out." A static, formatted time is just as truthful and informative without manufacturing anxiety on every render. `formatTime()` already exists in `src/lib/utils/dates.ts` and produces the "3:45 PM" style used elsewhere — reuse it, don't build a new formatter.

Since the reaper window is well under an hour, date-crossing ("tomorrow") is a non-issue in the normal case — flagging as a minor edge case only if a checkout is somehow abandoned right before midnight.

### Fallback when the deadline has passed but the card is still being viewed

Possible if she opens `/bookings` in the gap between "deadline passed" and "reaper's next tick actually ran" (up to ~15 min per the architect's poll interval), or if the row was already reaped and a stale client cache is showing it. Card copy for this edge case:

> "This hold may have expired — refresh to check your booking."

with a plain-text `Refresh` action rather than the gold CTA (don't invite her to pay into a session that Stripe/the backend may have already invalidated). This is a UX fallback spec, not a mechanism — flagging in Section 8 that the exact trigger condition (client-side time comparison vs. a fresh server read) needs backend input.

### Where it renders: Upcoming tab, not a new tab

**Decision: inside the existing `Upcoming` tab, mixed with confirmed bookings — not a fourth tab.**

Rationale: the task brief is exactly right that Amaya checking "am I booked?" looks in Upcoming first. A dedicated "Pending" tab would solve discoverability only for someone who already knows to look for it — which is precisely the group of people this fix is for (they don't know). Burying it behind a tab she has no reason to click reproduces the original bug in a smaller box.

Two reinforcements on top of "lives in Upcoming":

1. **Sort pending_payment bookings first within Upcoming**, ahead of date-ordered confirmed bookings — regardless of the event's actual date. It's the one card requiring action; it should be the first thing her eye hits, not wherever it'd naturally fall in a date sort.
2. **Cross-tab banner** (new — mirrors the existing review-discovery banner pattern in `BookingsList.tsx` lines 61–80, which already solves an identical "make sure they see this no matter which tab is active" problem): a banner above the tab bar, visible regardless of active tab, so she doesn't need to have landed on Upcoming at all.

Banner copy (single pending booking):

> Icon: Clock, in a gold-tinted circle (same treatment as the existing Star icon circle for reviews)
> **"Finish booking {Event Title}"**
> "Payment pending — complete by {deadline} to keep your spot →"

Tapping the banner scrolls to / opens the Upcoming tab (or, simpler to implement: acts as the CTA itself and goes straight to the resume-payment action — developer's call, either is fine UX-wise, but going straight to Stripe is fewer taps and matches "book a free event in 2 taps" ethos, so lean toward that if feasible).

Banner copy (multiple pending bookings — rare, but two abandoned checkouts is possible):

> **"You have 2 bookings awaiting payment"**
> "Complete payment to keep your spots →"
> (Generic — don't try to name both events in one line; let the two cards in Upcoming carry the specifics.)

**Ordering when both banners could apply** (review-discovery banner already exists): pending-payment banner ranks **above** the review banner. A review nudge has no time pressure; a payment hold does. Show at most one urgent action banner at a time if that's simpler to build — pending-payment wins.

**Tab count badge:** the small count pill next to "Upcoming" in the tab bar should include pending_payment bookings in its number (`counts.upcoming = upcoming.length + pendingPayment.length`) — an Upcoming tab reading "0" while a real hold exists would be its own version of the same invisibility bug.

---

## 6. Accessibility check

- **Not colour-only:** the `Payment Pending` badge is gold like `Confirmed`/`Waitlisted`, deliberately — meaning must never rely on that colour alone. It doesn't: the label text itself ("Payment Pending" vs "Confirmed") is the primary signal, reinforced by the explainer line, the deadline line, and the CTA label. A screen-reader user hears "Payment Pending" as unambiguous badge text regardless of colour.
- **Touch targets:** `Complete Payment` button must be ≥44×44px. On mobile, full-width (`w-full`) with `py-3` (not the `py-2.5`/`py-1` used by secondary actions elsewhere) comfortably clears this.
- **Heading hierarchy:** no change — card still uses `h3` for the event title; badge and copy are not headings, consistent with the rest of `BookingCard`.
- **Keyboard:** `Complete Payment` is a real `<button>`/`<Link>`, not a div-as-button — must be focusable and trigger on Enter/Space, same as every other action already in this component.
- **Banner:** must be a real interactive element (button or link, not a clickable `div`) for the same reason.

---

## 7. Decision 5 — Full reminder email spec

**File convention:** new template, `src/lib/email/templates/pending-payment-reminder.ts` (naming only — backend-developer's call on exact filename), using the shared `_shared.ts` primitives (`renderShell`, `renderButton`, `renderDetailRow`, `COLORS`, `escapeHtml`, `htmlToText`) exactly as the three reference templates do. Structurally similar to `confirmedUnpaidPaymentLinkTemplate` (price table → button → urgency line → footer link) but **copy is original**, not reused, because the scenario is genuinely different: she does not have a confirmed spot. Framing must never imply otherwise.

### Subject line

> `Reminder: complete payment for {Event Title}`

Short, scannable, matches the house convention of `label: {Event Title}` already used by `bookingConfirmationTemplate` ("Finish booking: X") and `confirmedUnpaidPaymentLinkTemplate` ("Action needed: complete payment for X") — "Reminder:" signals this is a nudge about something she already started, not a new ask.

### Preview text

> `Your spot is on hold — finish up when you're ready.`

### Headline (H1, Playfair/Georgia serif per `_shared.ts` styling, matches "A spot's been saved for you." / "Let's finish confirming your spot." house pattern)

> **"Your spot's on hold."**

### Body copy

> "Hi {first name} — looks like you started booking **{Event Title}** but didn't get to finish. Your spot isn't confirmed yet, but we're holding it for you a little longer."

Then the standard event detail rows (`renderDetailRow`): Event / Date / Time — same as every other transactional template.

### Price breakdown (reuse the existing table structure verbatim — pattern, not prose, so identical is correct here)

```
Ticket           £XX.XX
Booking fee      £X.XX
─────────────────────────
Total            £XX.XX
```
followed by the existing small-print line: *"The booking fee covers card processing and isn't refundable."*

### CTA button

> `Complete Payment (£XX.XX)` — same `Complete payment ({totalLabel})` convention as the other two payment-link templates, gold pill via `renderButton`.

### Urgency / deadline block (below the button, small text, centred — matches existing `urgencyBlock` placement)

> "Complete payment by **{deadline}** — after that, we'll release the spot so someone else can have it."

Notes:
- "we'll release the spot" is truthful and concrete (matches what the reaper actually does) without "may need to" hedging softness *or* alarmist capitals/exclamation marks. This is a deliberate middle point between the two existing precedent templates' phrasing — flagged as a judgment call in Section 8.
- Always show a deadline in this email (unlike `confirmedUnpaidPaymentLinkTemplate`, which has a `holdExpiresAt: string | null` branch for holds with no automated expiry) — this scenario always has the reaper's cutoff, so there's no "no deadline" branch to design for here. Backend still needs to pass a formatted string, same shape as `holdExpiresAt` in the reference templates.

### Footer / closing line

> "Changed your mind? No need to do anything — the hold will simply expire and we'll let it go. You can review this (or any of your bookings) any time at [your bookings page]."

Reasoning: gives her an explicit, guilt-free "no action needed" out — reduces anxiety-driven clicking and matches the brand's warm register. Also pre-empts a support email asking "how do I cancel."

Standard footer chrome (`renderShell`) — no unsubscribe link, this is transactional (same as `waitlistPromotionTemplate` / `confirmedUnpaidPaymentLinkTemplate`, which also carry no `unsubscribeUrl`).

### Full assembled copy block (for direct lift into the template file)

```
Subject: Reminder: complete payment for {Event Title}
Preview: Your spot is on hold — finish up when you're ready.

Your spot's on hold.

Hi {First Name} — looks like you started booking {Event Title} but
didn't get to finish. Your spot isn't confirmed yet, but we're holding
it for you a little longer.

Event   {Event Title}
Date    {Date}
Time    {Time}

Ticket           {£XX.XX}
Booking fee      {£X.XX}
Total            {£XX.XX}
The booking fee covers card processing and isn't refundable.

[ Complete Payment ({Total}) ]

Complete payment by {Deadline} — after that, we'll release the spot
so someone else can have it.

Changed your mind? No need to do anything — the hold will simply
expire and we'll let it go. You can review this (or any of your
bookings) any time at your bookings page.
```

---

## 8. Mobile (375px / 390px) and dark-mode notes

### Mobile — `/bookings` card

- No change to the existing card shell (`flex-col` stack below `sm:`, image full-width on top) — the pending state adds copy lines and swaps the actions row, it doesn't need new layout scaffolding.
- `Complete Payment` button: full-width (`w-full sm:w-auto`) below the deadline line, `py-3` minimum for the 44px touch target. `View Event` sits as a centred text link beneath it on mobile (stacked), inline beside it at `sm:` and up.
- **No sticky bottom bar for this card.** CLAUDE.md's sticky-CTA pattern is specified for single-focus event *detail* pages (one primary action, whole viewport dedicated to it). `/bookings` is a list of cards, potentially several of which have their own CTAs — a page-level sticky bar doesn't map cleanly to "which card does it act on," and would visually compete with the review-discovery / pending-payment banners already living above the tabs. Keep the CTA inline, in-card. Flagging as a deliberate scope decision, not an oversight.
- Banner (cross-tab, Section 5): stacks icon + text + implicit tap-anywhere target full-width on mobile (`flex-col` under 375–390px, `flex-row` at `sm:`), same responsive pattern as the existing review banner.

### Dark mode

No new tokens, no new hex. Everything specified above (`bg-gold/10 text-gold`, `text-tertiary`, `border-gold/30`) already routes through the existing Tailwind CSS-variable setup that `Confirmed`/`Waitlisted`/`Cancelled` badges and the review banner already use — since those already render correctly in dark mode today, this state inherits that for free with zero extra dark-mode-specific work. The one thing to double check in implementation: the Clock icon (`lucide-react`) should be styled `text-gold` via className, never a literal fill colour, same rule as every other icon in this file (`Calendar`, `MapPin`, `CalendarPlus` already follow this).

**Email dark mode:** no special handling beyond what `_shared.ts` already does — every table cell in `renderShell` sets an explicit background colour (`COLORS.white` / `COLORS.cream`), so this template is exactly as (non-)dark-mode-aware as `booking-confirmation.ts` / `waitlist-promotion.ts` already are. Not a new gap introduced by this feature.

---

## 9. Open questions / judgment calls flagged for a human

These are genuine product decisions, not implementation details — flagging rather than deciding silently, per role brief:

1. **Deadline tone in the email's urgency line.** I wrote *"we'll release the spot so someone else can have it"* — concrete and truthful, no hedging, no alarm. An alternative pull toward more urgency (bold/colour on the deadline time, or a second reminder email closer to the cutoff) is defensible given real revenue is at stake. I deliberately erred calm/premium per the "waitlist is positive, not red" precedent — but this is exactly the kind of call CLAUDE.md's aesthetic ("Soho House meets Time Out") vs. commercial urgency tension that's worth a co-founder sign-off, not an agent default.
2. **Single reminder vs. two-stage reminder.** Given the ~35–50 min window (per the architect's parallel doc), I designed for **one** reminder email. A "final call, ~10 minutes left" second nudge is common in checkout-abandonment flows elsewhere and would likely lift completion — but adds a second template, a second scheduling job, and risks feeling naggy for a 35-minute window. Recommend deferring to a follow-up if data post-launch shows the single reminder isn't converting.
3. **Badge colour.** I justified gold over red at length in Section 2. If the co-founder's gut read on seeing it in the demo is "this doesn't look urgent enough," the fallback option is pairing the existing gold pill with a small Clock icon *inside* the badge (not used anywhere else in this component today — would be the first icon-in-badge in the codebase). Flagging rather than introducing that pattern unilaterally.
4. **What the banner tap target does** (Section 5): scrolls to the Upcoming tab vs. jumps straight into the resume-payment action. I lean toward the latter (fewer taps) but it changes the banner from "navigation" to "commits an action," which is worth a quick gut-check from whoever builds it.
5. **Stale-deadline fallback trigger** (Section 4): whether "deadline passed" is judged client-side (comparing to a timestamp fetched on page load) or requires a fresh server round-trip to avoid showing a CTA for a row the reaper may have already cancelled. This is a backend mechanics question, not mine to decide — flagging so backend-developer confirms before wiring the "Refresh" fallback.
6. **What she sees after the reaper cancels it and she never acted.** Once reaped, the row becomes `status='cancelled'`, and `splitBookings()` doesn't currently surface *any* cancelled bookings in any tab (not even Past) — so the card simply vanishes with no trace, and Amaya-in-the-future would have zero record of "I had a spot and lost it," only the earlier reminder email (if she kept it) as evidence. Whether that's acceptable (soft, silent removal) or whether a `Cancelled` badge state should render briefly in Upcoming/Past ("Payment window closed") is a genuine product call outside the two decisions this brief asked me to design — flagging it here since it's the natural next question once you fix the two problems in scope, not something to quietly leave unresolved.

---

## HANDOVER

- **Agent:** ux-designer
- **Task:** Design member-facing UX + copy for `pending_payment` booking visibility — `/bookings` badge/card/banner and an abandoned-checkout reminder email
- **Files changed:** `UX-REVIEW-pending-payment-visibility.md` (created)
- **Migrations planned:** none (design phase)
- **Tests added:** none (design phase)
- **Next agent:** `frontend-developer` (for `BookingCard.tsx` / `BookingsList.tsx` / `splitBookings()` changes — badge, card copy, CTA, cross-tab banner, sort order) and `backend-developer` in parallel (for the resume-payment action/redirect mechanics and the new email template's send trigger — coordinate with the architect's parallel reaper-timing spec for the actual deadline timestamp/window feeding this copy)
- **Risks / open questions:** see Section 8 above (six flagged judgment calls — deadline tone, single vs. two-stage reminder, badge colour intensity, banner tap behaviour, stale-deadline race handling, and post-reaper "silently vanishes" gap). None of these block a first implementation pass, but all six should get an explicit human decision before this ships to real members rather than being resolved by whichever agent happens to build it next.
