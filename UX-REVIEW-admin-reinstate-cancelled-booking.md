# UX copy spec — Admin reinstate a reaper-cancelled booking

> Produced by: UX Designer agent
> Date: 2026-08-08
> Status: **COPY FINAL — ready for backend-developer to drop in verbatim**
> Companion to: `SYSTEM-DESIGN-admin-reinstate-cancelled-booking.md` (architecture — read that for the
> "why"; this doc is only the "what to write"). Covers architect §4.6 (email) and §5 (admin "cancelled
> N ago" display), plus the button/toast copy the architect explicitly deferred to me (§8, item 4).
>
> Scope discipline: this is copy only. No component structure, no RPC/data-model decisions, no new
> visibility booleans — those are already fully specified in the architect's doc. I've read
> `waitlist-promotion.ts`, `confirmed-unpaid-payment-link.ts`, and `pending-payment-reminder.ts` for
> house voice, and `PromoteButton.tsx`/`DemoteHoldButton.tsx` for admin-toast conventions, and match
> both deliberately rather than inventing new patterns.

---

## 1. Email: `reinstatedBookingPaymentLinkTemplate()`

**File:** `src/lib/email/templates/reinstated-booking-payment-link.ts` (new — architect confirmed this
is a genuinely third scenario, not a branch on either sibling).

**Input shape** — identical to the two sibling templates (`AdminHoldEmailContext`, already declared in
`admin-hold.ts`): `fullName`, `eventTitle`, `eventSlug`, `eventDate`, `eventTime`, `priceInPence`,
`bookingFeePence`, `checkoutUrl`, `holdExpiresAt: string | null`. Per architect §3.4, `priceInPence`
here is the booking's **preserved** `price_at_booking`, not the event's current price — the copy below
doesn't reference this mechanism at all (it shouldn't need to), it just renders "Ticket" / "Total" the
same as both siblings.

### 1.1 Framing decision (why this copy, not the siblings' copy)

The honest fact pattern is: *the member's payment window closed, their booking was genuinely cancelled
and the seat released, and an admin has now put it back on hold for them.* That's different from both
siblings:

- Not `waitlistPromotionTemplate` — they were never on a waitlist this cycle. Saying "you're in!" or
  "a spot's been saved" (waitlist framing) would be factually wrong in the other direction from
  before — it would hide that anything happened.
- Not `confirmedUnpaidPaymentLinkTemplate` — they do **not** currently hold a confirmed seat. Saying
  "you have a confirmed place" would be false; their booking is `pending_payment`, same runtime state
  as `confirmedUnpaidPaymentLinkTemplate`'s recipient, but arrived at via a completely different (and
  much more email-worthy) path.
- The tone must do two things at once: **acknowledge plainly that the booking was cancelled** (not
  bury it), and **not scold** ("you missed your window!"). The copy below states the fact once, in one
  sentence, past tense, no blame language ("didn't complete," "missed," "failed to" are all avoided),
  then immediately pivots to the fix.

### 1.2 Subject line

```
Your spot's back: {eventTitle}
```

Matches the house convention of a short lead phrase + colon + event title (`waitlistPromotionTemplate`
uses `You're in: {eventTitle}`; `confirmedUnpaidPaymentLinkTemplate` uses `Action needed: complete
payment for {eventTitle}`). "Your spot's back" is deliberately not "You're in" (not confirmed) and not
"Action needed" (that phrase is already owned by the sibling template for a different situation —
reusing it here would make two structurally different emails look identical in an inbox list).

### 1.3 Preview text

```
We've reserved your spot again — complete payment to keep it.
```

### 1.4 Headline (H1)

```
We've reserved your spot again.
```

Matches the sibling headlines' register exactly (`Your spot's on hold.` / `A spot's been saved for
you.` / `Let's finish confirming your spot.`) — short, present-tense, declarative. "Again" is the one
word doing the acknowledgement work: it signals, without alarm, that this isn't the first time.

### 1.5 Body copy (first paragraph — the honest acknowledgement)

```html
<p style="margin:0 0 16px 0;">
  Hi {firstName} &mdash; your payment window for <strong>{eventTitle}</strong> closed
  before we received your payment, so your spot was released. We&rsquo;ve reserved it
  again for you &mdash; please complete payment below to secure it.
</p>
```

This is the one sentence that carries the acknowledgement: "closed... so your spot was released" is a
plain statement of fact, not an apology and not an accusation. It does not say "you missed your
window" (accusatory) and does not skip straight to "here's your spot" (which would hide that anything
happened). Second sentence pivots immediately to the resolution and the action.

### 1.6 Detail block (Event / Date / Time)

Identical structure to both siblings — reuse `renderDetailRow` verbatim, no copy changes:

```html
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-top:1px solid ${COLORS.border};border-bottom:1px solid ${COLORS.border};margin:0;">
  ${renderDetailRow({ label: 'Event', value: input.eventTitle })}
  ${renderDetailRow({ label: 'Date', value: input.eventDate })}
  ${renderDetailRow({ label: 'Time', value: input.eventTime })}
</table>
```

### 1.7 Price table

Byte-identical structure/copy to both siblings (labels "Ticket" / "Booking fee" / "Total", same
non-refundable-fee footnote) — no new copy needed, reuse verbatim:

```html
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:24px 0 0 0;">
  <tr>
    <td style="padding:8px 0;font-size:14px;color:${COLORS.textSecondary};">Ticket</td>
    <td style="padding:8px 0;font-size:14px;color:${COLORS.charcoal};text-align:right;">${escapeHtml(formatPriceExact(input.priceInPence))}</td>
  </tr>
  <tr>
    <td style="padding:8px 0;font-size:14px;color:${COLORS.textSecondary};">Booking fee</td>
    <td style="padding:8px 0;font-size:14px;color:${COLORS.charcoal};text-align:right;">${escapeHtml(formatPriceExact(input.bookingFeePence))}</td>
  </tr>
  <tr>
    <td style="padding:8px 0;font-size:14px;color:${COLORS.textSecondary};border-top:1px solid ${COLORS.border};"><strong>Total</strong></td>
    <td style="padding:8px 0;font-size:14px;color:${COLORS.charcoal};text-align:right;border-top:1px solid ${COLORS.border};"><strong>${escapeHtml(totalLabel)}</strong></td>
  </tr>
</table>
<p style="margin:8px 0 0 0;font-size:12px;color:${COLORS.textSecondary};">
  The booking fee covers card processing and isn&rsquo;t refundable.
</p>
```

### 1.8 Button

```
Complete payment ({totalLabel})
```

Same pattern as both siblings (`Complete payment (£42.00)`) — keep the dynamic total in the label, it's
already established and tested house style. `href` = `input.checkoutUrl`.

### 1.9 Urgency block — `holdExpiresAt` is `null` (per architect §6, for the foreseeable future)

Per the task brief's instruction, reuse the exact same neutral no-deadline copy the two sibling
templates already use for their `null` branch, verbatim — not a new variant. Consistency across the
three templates matters more here than a bespoke line, and the existing neutral line already reads
correctly for this scenario without modification:

```html
<p style="margin:16px 0 0 0;font-size:13px;color:${COLORS.textSecondary};text-align:center;">
  Complete payment below to secure your spot.
</p>
```

If `holdExpiresAt` is ever non-null in future (not expected per architect §6, but the template should
still handle it defensively since the field is typed `string | null`), reuse the sibling pattern's
non-null branch verbatim too, swapping only the verb to match "reserved" framing:

```html
<p style="margin:16px 0 0 0;font-size:13px;color:${COLORS.textSecondary};text-align:center;">
  Reserved until <strong>{holdExpiresAt}</strong> &mdash; after that we may need to offer the spot to someone else.
</p>
```

### 1.10 Footer

Identical to both siblings, no copy changes:

```html
<p style="margin:32px 0 0 0;font-size:14px;color:${COLORS.textSecondary};">
  Questions about your spot? You can review all your bookings any time at
  <a href="${siteUrl}/bookings" style="color:${COLORS.gold};text-decoration:none;">your bookings page</a>.
</p>
```

### 1.11 Full assembled reference (drop-in shape, mirrors sibling file structure exactly)

```ts
export function reinstatedBookingPaymentLinkTemplate(
  input: ReinstatedBookingPaymentLinkInput,
): RenderedTemplate {
  const firstName = input.fullName.split(/\s+/)[0] || input.fullName
  const siteUrl = getSiteUrl()

  const totalPence = input.priceInPence + input.bookingFeePence
  const totalLabel = formatPriceExact(totalPence)

  const subject = `Your spot's back: ${input.eventTitle}`

  const urgencyBlock = input.holdExpiresAt
    ? `<p style="margin:16px 0 0 0;font-size:13px;color:${COLORS.textSecondary};text-align:center;">
  Reserved until <strong>${escapeHtml(input.holdExpiresAt)}</strong> &mdash; after that we may need to offer the spot to someone else.
</p>`
    : `<p style="margin:16px 0 0 0;font-size:13px;color:${COLORS.textSecondary};text-align:center;">
  Complete payment below to secure your spot.
</p>`

  const bodyHtml = `<h1 style="margin:0 0 16px 0;font-family:Georgia,'Times New Roman',Times,serif;font-size:28px;font-weight:bold;color:${COLORS.charcoal};">
  We&rsquo;ve reserved your spot again.
</h1>

<p style="margin:0 0 16px 0;">
  Hi ${escapeHtml(firstName)} &mdash; your payment window for
  <strong>${escapeHtml(input.eventTitle)}</strong> closed before we received your
  payment, so your spot was released. We&rsquo;ve reserved it again for you &mdash;
  please complete payment below to secure it.
</p>

<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-top:1px solid ${COLORS.border};border-bottom:1px solid ${COLORS.border};margin:0;">
  ${renderDetailRow({ label: 'Event', value: input.eventTitle })}
  ${renderDetailRow({ label: 'Date', value: input.eventDate })}
  ${renderDetailRow({ label: 'Time', value: input.eventTime })}
</table>

<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:24px 0 0 0;">
  <tr>
    <td style="padding:8px 0;font-size:14px;color:${COLORS.textSecondary};">Ticket</td>
    <td style="padding:8px 0;font-size:14px;color:${COLORS.charcoal};text-align:right;">${escapeHtml(formatPriceExact(input.priceInPence))}</td>
  </tr>
  <tr>
    <td style="padding:8px 0;font-size:14px;color:${COLORS.textSecondary};">Booking fee</td>
    <td style="padding:8px 0;font-size:14px;color:${COLORS.charcoal};text-align:right;">${escapeHtml(formatPriceExact(input.bookingFeePence))}</td>
  </tr>
  <tr>
    <td style="padding:8px 0;font-size:14px;color:${COLORS.textSecondary};border-top:1px solid ${COLORS.border};"><strong>Total</strong></td>
    <td style="padding:8px 0;font-size:14px;color:${COLORS.charcoal};text-align:right;border-top:1px solid ${COLORS.border};"><strong>${escapeHtml(totalLabel)}</strong></td>
  </tr>
</table>
<p style="margin:8px 0 0 0;font-size:12px;color:${COLORS.textSecondary};">
  The booking fee covers card processing and isn&rsquo;t refundable.
</p>

${renderButton({ label: `Complete payment (${totalLabel})`, href: input.checkoutUrl })}

${urgencyBlock}

<p style="margin:32px 0 0 0;font-size:14px;color:${COLORS.textSecondary};">
  Questions about your spot? You can review all your bookings any time at
  <a href="${siteUrl}/bookings" style="color:${COLORS.gold};text-decoration:none;">your bookings page</a>.
</p>`

  const html = renderShell({
    previewText: `We've reserved your spot again — complete payment to keep it.`,
    bodyHtml,
  })

  return {
    subject,
    html,
    text: htmlToText(html),
  }
}
```

(Backend-developer: JSDoc/imports/interface for the file are the architect's already-specified shape
in §4.6 — I've only written the copy-bearing parts above; wire up `ReinstatedBookingPaymentLinkInput`
identically to `WaitlistPromotionInput`/`ConfirmedUnpaidPaymentLinkInput`.)

---

## 2. Admin bookings table copy

Internal tool — utilitarian register per CLAUDE.md (the "Soho House meets Time Out" bar applies to
member-facing surfaces, not admin internals). Plain, direct, no editorial voice needed here.

### 2.1 "Cancelled N ago" display

Show on **every** row where `status = 'cancelled'` and `cancelled_at` is set (not just eligible-for-
reinstatement rows) — an admin looking at a cancelled row with no visible reason and no button
shouldn't have to guess why. Reuse the codebase's existing `formatDistanceToNow(date, { addSuffix:
true })` convention (already used identically in `BookingsTable.tsx` for `created_at`, `MembersTable`,
`ReviewsTable`, etc. — don't invent a second date-formatting pattern):

```
Cancelled {formatDistanceToNow(new Date(booking.cancelled_at), { addSuffix: true })}
```

Renders as: `Cancelled 2 hours ago`, `Cancelled 12 days ago`. Muted/secondary text colour (`text-muted`
/ dark-mode `text-dark-muted`), `text-xs`, placed directly under the `StatusBadge` for that row.

**When `cancellation_reason` is present** (i.e. this row is `cancelled` but NOT eligible for
reinstatement — cancelled as part of an event cancellation, per architect §1.2/§1.5): add a second
line, same muted/`text-xs` styling, directly below the "Cancelled N ago" line:

```
Reason: {cancellation_reason}
```

No icon, no separate tooltip component — a plain second line is enough for an internal table and
avoids pulling in tooltip infrastructure for one field. If `cancellation_reason` is long enough to
wrap awkwardly in the table, truncate with `truncate` + native `title={cancellation_reason}` attribute
for the full text on hover (zero new component, standard HTML). Don't build anything more elaborate
than that — this is exactly the "don't over-design an internal admin tool" case the brief called out.

**When `cancellation_reason` is absent** (eligible row): no "Reason:" line — the presence of the
Reinstate button (below) is itself the signal that this row is actionable. Do not add a redundant
"Eligible for reinstatement" label; the button is the affordance.

### 2.2 Reinstate button — `ReinstateBookingButton.tsx`

Mirrors `PromoteButton.tsx`'s exact interaction pattern (`useTransition`, no `confirm()` guard — this
is a positive/additive action for the member, not a destructive one, same reasoning that let
`PromoteButton` skip a confirm dialog).

| State | Copy |
|---|---|
| Idle button label | `Reinstate` |
| Pending button label | `Reinstating...` |
| Static caption under button (always visible, before click) | `Emails a new payment link` |
| Success message (replaces caption) | `Payment link emailed to {memberName}` |
| Error | `alert(result.error)` — surface the Server Action's error string verbatim, no client-side rewording (see §2.4) |

The caption is the one deliberate addition beyond `PromoteButton`'s pattern: unlike "Promote," which
an admin already understands from the waitlist page's context, "Reinstate" on a cancelled row is a
rarer, higher-stakes action worth one line of always-visible explanation so nobody clicks it uncertain
of what it does. Styling: same `text-[10px]` treatment already used for `PromoteButton`'s inline
success message, muted colour when idle, `text-success` colour on success (component swaps the string,
not the style class).

Button visual language: reuse the existing gold-fill primary action styling already on `PromoteButton`
(`bg-gold hover:bg-gold-dark text-white`) — this is the "make it happen" action on the row, same class
of action as Promote.

### 2.3 Release button — `ReleaseReinstatedHoldButton.tsx`

Mirrors `DemoteHoldButton.tsx` exactly (danger-outline styling, `confirm()` guard retained per
architect §4.8/§8 item 2 — I agree with the architect's lean: this is at least as consequential as
demoting to waitlist, arguably more so, since it fully cancels a spot the member was just given back).

| State | Copy |
|---|---|
| Idle button label | `Cancel Reinstatement` |
| Pending button label | `Cancelling...` |
| `confirm()` dialog text | `Cancel this reinstatement? Their payment link will stop working and the spot will go back to cancelled.` |
| Success message | `{memberName} returned to cancelled` |
| Error | `alert(result.error)` — verbatim (see §2.4) |

Label reasoning: `DemoteHoldButton` names its label after the **destination** ("Move to Waitlist"), not
the mechanism — matching that convention, this button names its destination too, but "Move to
Cancelled" reads oddly as a button (cancelled isn't a place you "move" someone). "Cancel Reinstatement"
names the action from the admin's own mental model (undo what I just did) while still being accurate
about the outcome, and reads unambiguously next to a row whose status badge already says the booking
is back in `pending_payment` limbo.

Confirm dialog: adapted directly from `DemoteHoldButton`'s existing text (`"Move this person back to
the waitlist? Their payment link will stop working."`) — same "this person" generic phrasing (the
component doesn't carry `memberName` as a prop, matching `DemoteHoldButton`'s existing signature), same
"their payment link will stop working" clause carried over verbatim since it's still true here, with
the destination clause swapped from "back to the waitlist" to "back to cancelled" to match this
button's actual effect.

### 2.4 Toast/error copy — reuse the RPC's own strings, no rewrite

Decision: **do not** add a client-side error-copy layer distinct from the Server Action's own returned
`error` string. This matches the established, already-hardened convention in this codebase (see
`project_admin_actions_error_messages` — PR #101 specifically moved *toward* surfacing the Postgres/RPC
error detail directly in admin actions, not away from it) and both existing sibling buttons
(`PromoteButton`, `DemoteHoldButton`) already do exactly this — `alert(result.error)`, unmodified.

The architect's RPC/Server Action error strings (§4.1, §4.2, §4.7 of the design doc) are already
written in plain, admin-appropriate English and need no rewording for display. Reproduced here for
reference only (not to be changed):

- `Admin access required`
- `Invalid booking fee`
- `Booking not found`
- `Only cancelled bookings can be reinstated`
- `This booking was not cancelled by the automatic payment timeout — cannot reinstate`
- `This booking was cancelled as part of an event cancellation — cannot reinstate`
- `This booking has a payment record — cannot reinstate`
- `This booking was refunded — cannot reinstate`
- `This booking is already an active hold`
- `This is a free-event booking — reinstate by re-booking directly, not via this tool`
- `This member already has an active booking for this event`
- `This member's account has been deleted — cannot reinstate`
- `Event not found`
- `Event is cancelled`
- `Event has already passed`
- `This is now a free event — reinstate by re-booking directly, not via this tool`
- `Event is at full capacity — cannot reinstate`
- `Booking ID is required`
- `This booking is not an active reinstatement hold — it may have already been paid, cancelled, or released.`

One addition worth calling out, not a rewrite: the `23505` unique-index race the architect flags in
§4.1's closing note ("Race note") needs a friendly message at the TS catch layer, since that one
*isn't* one of the RPC's own `jsonb_build_object('error', ...)` branches — it's a raw Postgres
constraint violation the TS layer must catch and translate. Suggested copy for that one specific catch:

```
This member already has another active booking for this event — refresh and check before retrying.
```

### 2.5 Success message copy — summary table

| Action | Success copy |
|---|---|
| Reinstate | `Payment link emailed to {memberName}` |
| Release | `{memberName} returned to cancelled` |

Both match the existing inline-text-success convention (`text-success`, replaces the button's
secondary line, no toast/snackbar component needed — this app has no toast system for admin actions
today and this feature shouldn't be the one to introduce it under incident time pressure).

---

## 3. Quick-reference for the four live members

No bespoke copy needed for Amaya Kaur / Senam Paya / Christian I / Laura Florez Perez specifically —
they go through the exact same "Reinstate" button and email template as any future occurrence of this
state. Once the migration and UI ship, the admin's actual steps are: open the event's bookings page →
see `Cancelled N ago` under each of their rows with no `Reason:` line (confirming eligibility) → click
`Reinstate` on each → each gets `reinstatedBookingPaymentLinkTemplate()`.

---

## HANDOVER
- **Agent:** ux-designer
- **Task:** Copy spec for admin "reinstate a reaper-cancelled booking" flow — member-facing email template (`reinstatedBookingPaymentLinkTemplate`) and internal admin UI copy (Reinstate/Cancel Reinstatement buttons, "Cancelled N ago" row display, toast/error copy).
- **Files changed:** Created `/Users/miteshbhimjiyani/Developer Projects/Social Seen/.claude/worktrees/jovial-kowalevski-27ad37/UX-REVIEW-admin-reinstate-cancelled-booking.md` (new copy spec, no source files touched).
- **Migrations planned:** none (copy/design phase — see architect's `SYSTEM-DESIGN-admin-reinstate-cancelled-booking.md` §4.3 for the actual migration).
- **Tests added:** none (design phase).
- **Next agent:** `backend-developer` — implement `reinstated-booking-payment-link.ts` (§1.11 of this doc is a direct drop-in reference), the migration + RPCs + Server Actions per the architect's doc, and `ReinstateBookingButton.tsx`/`ReleaseReinstatedHoldButton.tsx` per §2.2/§2.3 of this doc.
- **Risks / open questions:**
  - This is copy for a live incident affecting four real members — recommend a human (Sophia/co-founder or Mitesh) skims the email copy (§1) before it sends to a real inbox, same "reserved review step" precedent the two sibling templates' own JSDoc already calls out for themselves.
  - Architect's own open questions (§8 of their doc) are unresolved by this spec and remain backend-developer/product decisions: (1) whether `suspended`/`banned` members should be blocked from reinstatement at the RPC level, (2) confirming the `confirm()` guard stays on the release button (this spec assumes yes, per §2.3).
  - I did not design a toast/snackbar system — both actions use the existing `alert()` + inline-text-success convention already established by `PromoteButton`/`DemoteHoldButton`. If a future pass wants to unify admin actions onto a real toast component, that's a separate, non-urgent frontend task, not part of this fix.
