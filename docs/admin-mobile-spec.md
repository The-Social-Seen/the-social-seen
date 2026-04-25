# Admin Mobile-Responsive Spec

**Audience:** Sophia (co-founder) checking the admin tools on her iPhone in the back of an Uber after dinner. She needs to feel that the back office runs as nicely as the public site. The bar is Stripe Dashboard / Linear / Square Dashboard — not "the desktop version, squashed."

**Scope:** every admin page below `768px` (Tailwind `<md:`). Desktop (`lg:`+) and tablet (`md:` 768–1023px) are out of scope — they already work. The only mobile work already done is the bottom tab bar in [AdminSidebar.tsx](src/components/admin/AdminSidebar.tsx) — that stays, all spec below assumes it is present and reserves `pb-20` of content padding for it.

**Breakpoints in this document:**
- "**Mobile**" = `<md:` = `<768px`. Primary design target.
- "**Tablet**" = `md:` = `768–1023px`. Touch up if obviously broken; otherwise leave alone.
- "**Desktop**" = `lg:` = `≥1024px`. Do not change.

The reference frame for screenshots/measurements is **iPhone 14, 390×844, Safari**. The hardest case is **iPhone SE 2nd gen, 375×667** — anything that fits there, fits everywhere.

---

## 1. Universal mobile patterns

### 1.1 Page-level scaffolding

The current admin layout ([src/app/(admin)/layout.tsx:52](src/app/(admin)/layout.tsx)) is fine — keep `lg:pl-64 pb-20 lg:pb-0` and the `p-6` content padding. The remaining pattern work happens **inside** each page.

| Pattern | Mobile rule |
|---|---|
| Page heading | Stay `font-serif text-2xl`. Do not shrink — the visual identity matters. |
| Card wrappers | Today: `bg-bg-card border border-border rounded-xl p-6`. Mobile: keep, but reduce inner padding to `p-4` below `md:` (`p-4 md:p-6`). The 24px wall-on-three-sides is too much on a 375px screen. |
| Section spacing | `space-y-6` is fine; do not tighten. |
| Page-header action button | If the heading row has a CTA (e.g. "Create Event"), stack it BELOW the heading on mobile, full-width, gold. Pattern: `flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3`. The CTA should never wrap to a second line or get cropped. |
| Back-arrow + title rows | Today's pattern (44×44 back chevron + heading) is correct — keep. Subtitle (`text-sm text-text-tertiary`) wraps to a second line on mobile if needed; do not truncate. |

### 1.2 Tables → cards (the big one)

The admin currently uses one pattern for tables: a real `<table>` inside `overflow-x-auto`, with `hidden md:table-cell` / `hidden lg:table-cell` to drop columns at narrower widths. That is **not** the target experience. Hidden columns hide critical data; horizontal scroll inside a card is awkward to discover. We swap the entire table-rendering for a **stacked card list** below `md:`.

**Single canonical pattern — every admin table follows this:**

- Below `md:`: render an `<ul>` of "**row cards**" — one per data row. The `<table>` is hidden (`hidden md:table`). The `<ul>` is hidden at `md:` and up (`md:hidden`).
- Each row card is `rounded-lg border border-border bg-bg-card p-4 space-y-2`. Cards are stacked with `space-y-3` between them.
- Inside each card, content is divided into three zones:
  - **Title row** (top): primary identity of the row + a status badge on the right. `flex items-start justify-between gap-3`.
  - **Body** (middle): key metadata, label/value pairs. `text-sm`. Each pair is `flex items-center justify-between` so the label is left and the value is right.
  - **Action row** (bottom): a divider (`border-t border-border pt-3`) above a horizontal row of action buttons, evenly distributed (`flex items-center justify-end gap-2`).
- For the `<ul>` to feel right, **the existing in-table CTA buttons reflow** — they become full-text labelled buttons (`Edit`, `Bookings`, `Delete`) instead of icon-only 44×44 squares. Icon stays as a leading glyph: `<Pencil className="w-4 h-4" /> Edit`. This is critical for discoverability — icon-only on a tiny card is illegible.
- Loading shimmer for the row card is a 64px-tall skeleton with the same border radius.

A simple worked example ("Events" table):

```
┌─────────────────────────────────────────┐
│ ▣  Wine & Wisdom at Borough     [Past] │   ← title row + status
│    Sat, 12 Apr · Dining               │   ← body line 1: date · category
│    £35   ·   28/30 booked              │   ← body line 2: price · capacity
│ ─────────────────────────────────────── │
│  [✎ Edit]  [👥 Bookings]  [🗑 Delete]  │   ← action row
└─────────────────────────────────────────┘
```

**Per-table mobile mapping** is in §3 below.

### 1.3 Search / filter / export bars

Tables come with a top bar — a search input, a sort `<select>`, an Export CSV button (e.g. `MembersTable`). Today it uses `flex flex-col sm:flex-row gap-3`. That is **almost right** but `sm:` is 640px and admin lives at `lg:` width — keep `flex-col` until `md:`. Mobile rule:

- Below `md:`: stack vertically, full width. Search first, sort second, export third.
- Search input: full width, 44px tall (today is `py-2` ≈ 36px — too short for thumb). Use `h-11`.
- Sort `<select>`: full width below `md:`, label above it as a small `text-xs text-text-tertiary` line ("Sort by"). The bare select is ambiguous on mobile.
- Export CSV: a full-width text-and-icon button (gold outline secondary), placed below sort. Pattern: `border border-gold/40 text-gold rounded-full w-full h-11 inline-flex items-center justify-center gap-2`. Today it is a tiny inline link — that is a desktop tertiary action; mobile needs a real button.
- Filter tab pills (the inner `<div>` with "All / Confirmed / Waitlisted / Cancelled / No-shows" inside `BookingsTable` and `ReviewsTable`): wrap to two lines below `md:` (`flex-wrap`). Each tab pill stays `min-h-[44px]` (today `min-h-[36px]` — too short). Keep the segmented-control look (cream pill bg, white selected card).

### 1.4 Forms

[EventForm.tsx](src/components/admin/EventForm.tsx) is the only large form. The pattern below applies to it and to any future admin form.

**Mobile rules for forms:**

- All `grid grid-cols-1 md:grid-cols-2` rows already collapse correctly — leave these. Audit confirms 5 such rows in EventForm; all OK.
- All inputs and `<select>`s must be `h-11` (44px) below `md:`. Today they are `py-2` (~36px).
- Labels stay above the input (already the case via `<FormField>`). No floating labels — they're trendy but break with autofill on iOS.
- The hidden-venue toggle on the same row as the postcode is fine because the row is `md:grid-cols-2` and stacks below `md:`. No change.
- Radio groups (`Refund Policy`): each radio row is `min-h-[44px]` and the radio + label have at least `gap-3` (today `gap-2`). The radio button itself stays 16px (`h-4 w-4`) but the wrapping label takes the full row, so the entire row is the tap target.
- The "What's Included" inclusions list (label + icon select + remove): below `md:` reflow to **two rows per item** — row 1 is the label input full width, row 2 is the icon select (left, flex-1) and the remove button (right, 44×44). Today three controls sit on one line and the icon select is `w-32` — fine on desktop, cramped on mobile.
- **Sticky save bar** below `md:`. The form is long enough (≈12 visible fields, 800px+ scroll) that keeping the Save button at the bottom forces a long scroll just to commit a one-field edit. Pattern: a bottom-fixed bar `fixed inset-x-0 bottom-16 bg-bg-card border-t border-border p-3 lg:static lg:bg-transparent lg:border-0 lg:p-0` containing the same two buttons (`Update / Cancel`). `bottom-16` clears the bottom tab bar (h-16). Both buttons full-width, side by side: `flex gap-3` with `flex-1` each. The original in-flow buttons at the foot of the form should be hidden on mobile (`hidden lg:flex`) so they don't duplicate.
- Error/success banners: stay inline at the top of the form. They are already full-width via `space-y-6`. Keep.
- The `min-h-[44px]` rule applies to **every** button in the form, including the small "Add item" link inside `InclusionsList` — it is a `text-sm` link today; bump to a labelled button on mobile (`+ Add item`, `min-h-[44px]`, gold outline rounded-full).

### 1.5 Dialogs / modals

Two admin dialogs exist today:

- [ConfirmDialog.tsx](src/components/ui/ConfirmDialog.tsx) — used by `EmailAttendeesForm`, `DuplicateEventButton`. Centred Radix Dialog, `max-w-md`.
- [MemberModerationDialog.tsx](src/components/admin/MemberModerationDialog.tsx) — bespoke Radix Dialog, also centred `max-w-md`.

Both should adopt the **mobile bottom-sheet, desktop centred** pattern that the public app uses in [BookingModal.tsx](src/components/events/BookingModal.tsx) — that's the user's existing mental model and it should carry into the admin so the brand feels coherent.

**Spec for both Radix dialogs below `md:`:**

- Bottom sheet: anchored to the bottom of the screen. `fixed inset-x-0 bottom-0 rounded-t-2xl` (no top corners), `max-h-[90vh] overflow-y-auto`, `pb-[env(safe-area-inset-bottom)]` so it clears the home indicator.
- Drag handle: a centred 4×40 pill at the top (`bg-border-light h-1 w-10 mx-auto rounded-full mt-3`). Visual cue only; not functionally draggable. Matches `BookingModal`.
- Title row: same as today (Title + close X).
- Action buttons: stack full-width vertically below `md:` (`flex flex-col-reverse gap-2 lg:flex-row lg:justify-end`). Primary at bottom (closest to thumb), Cancel above. `flex-col-reverse` puts Cancel visually above Confirm but DOM-wise primary remains the default focus; if focus order matters, pass `data-autofocus` on Confirm.
- For `MemberModerationDialog` specifically — it has up to 3 action buttons (Reinstate / Suspend / Ban). Below `md:` stack all three full-width. Order top→bottom: most-destructive last (Reinstate, Suspend, Ban, Cancel) so Ban sits closest to the thumb. Reasoning: of the three, Ban is the one Sophia is most likely to come here to do. Cancel is at the very bottom but full-width and visually distinct.
- Above `md:`: keep the existing centred modal exactly as today. Do not regress the desktop layout.

The cleanest implementation is to add a `responsive` prop to `ConfirmDialog` and reuse it for `MemberModerationDialog` (or copy the responsive class set into `MemberModerationDialog`). Frontend-developer's call.

### 1.6 Dashboard charts / KPI cards

- KPI cards already use `grid-cols-1 md:grid-cols-2 lg:grid-cols-4` — that single-column stack on mobile is fine. **Recommendation: switch to `grid-cols-2 md:grid-cols-2 lg:grid-cols-4`** so all four cards are visible at a glance below `md:`. Each card at 50% of a 375px screen with `gap-6` (24px) and `p-6` (24px) leaves ~140px wide cards — the `text-3xl` value still fits ("£12,400" ≈ 96px wide at 30px font). One-column-stack KPIs forces a 4-card scroll just to see the headline metrics; that defeats the dashboard.
- Card padding inside KPIs at `p-4 md:p-6` (today `p-6`).
- Card order matters more on mobile. Keep current order — Members, Upcoming Events, Revenue, Avg Rating — as the editorial-priority Sophia cares about. Don't reorder.
- **BookingsChart** at `height={300}` and `ResponsiveContainer` works — recharts handles the width. One adjustment: the `margin={{ left: -20 }}` on the `<BarChart>` clips the Y-axis tick labels at narrow widths. Below `md:`, set the left margin to `0` and let recharts space it. Verify "12" doesn't get clipped at 375px.
- The Dashboard's secondary grid (`grid-cols-1 lg:grid-cols-3`) — chart in 2 columns, RecentActivity in 1 — already stacks cleanly to single column below `lg:`. Keep.
- **RecentActivity** today has 5 items, each 2 lines. Fine on mobile. Below `md:`, ensure the user/event names don't wrap awkwardly — long event titles should `truncate` after one line of overflow with a `title=` for full text. If they truncate, no fix needed.

### 1.7 Tap targets — universal

All interactive elements **must** be `min-h-[44px] min-w-[44px]` on mobile. The codebase already has `min-h-[44px]` in many places (back-arrows, retry buttons, Email-attendees CTA) — replicate the pattern. Anything sub-44 fails a touch-target audit.

Specifically watch out for:

- Filter tab pills inside BookingsTable / ReviewsTable: today `min-h-[36px]`. Bump to 44 on mobile.
- "Promote" button on a waitlisted row: today `min-h-[36px]`. Bump to 44 on mobile (in the row card, the action row treats this as a regular button anyway — fine).
- "Hide / Show" review-toggle button: today `min-h-[36px]`. Same bump.
- Inline review-text expand button (it's a `<button>` with no padding around the `<text>`): give it `py-2` so the row is at least 36px and the *card itself* hosts the click area on mobile (see ReviewsTable mapping below).
- Export CSV link in BookingsTable / MembersTable: today no min-height — it's a text link. Promote to a proper button on mobile per §1.3.

---

## 2. Mobile copy adjustments

The header copy and field labels were written for desktop column widths. Below `md:`, the following labels should switch to a shorter variant. Implement via `<span className="md:hidden">Short</span><span className="hidden md:inline">Long</span>` or via a prop on shared components.

| Where | Desktop label | Mobile label | Why |
|---|---|---|---|
| EventsTable column / row card | "Booked" (e.g. `28/30`) | Same | Already short — keep. |
| EventsTable action button | (none — icon only) | "Edit" / "Bookings" / "Delete" | Per §1.2, icon-only buttons in stacked cards are illegible. |
| MembersTable header | "Job Title" | "Title" | Saves 6 chars in metadata rows. |
| BookingsTable filter tab | "Waitlisted" | "Waitlist" | Wraps cleanly into 2-row segmented control. |
| BookingsTable filter tab | "No-shows" | "No-shows" | Keep — the hyphen makes it readable. |
| Notifications page header | "Failed sends" link/button | "Failed" + count badge | The button is the only secondary admin action that doesn't have to compete for thumb space; consider a count badge `Failed (3)` instead of the icon when count > 0. |
| EmailAttendeesForm CTA | "Send to Attendees" | "Send to 28" (where 28 = confirmed count) | Anchors the action to the actual count; saves ambiguity. |
| EventForm submit button | "Update Event" / "Create Event" | "Save" / "Create" | Sticky save bar should not be 14 chars wide on a 187.5px-wide button. |
| EventForm slug preview | `thesocialseen.com/events/<slug>` | `…/events/<slug>` | The hostname is fine to elide on mobile. |
| Deleted accounts page subhead | "Hard-deleted after 30 days (manual for now)." | Same — 2-line wrap is fine. | Don't shorten — this is real ops information. |

A general principle: **never abbreviate a value Sophia might cross-reference** (member name, event title, error message). Only labels, helper text, and CTAs are fair game for mobile shortening.

---

## 3. Per-page acceptance criteria

Each page below has 2–4 mobile-ready bullets. The frontend-developer ships when **all bullets are true at 375×667** (iPhone SE) and at 390×844 (iPhone 14), in light mode and dark mode, with seeded data.

### 3.1 Dashboard — `src/app/(admin)/admin/page.tsx`

- [ ] All 4 KPI cards visible without horizontal scroll at 375px wide, laid out 2-up (`grid-cols-2`). The £-revenue value renders without ellipsis up to "£99,999".
- [ ] BookingsChart renders in full at 375px wide with no clipped Y-axis tick labels and no overflow inside its card.
- [ ] RecentActivity card sits below the chart (one-column stack at `<lg:`) and each activity item displays user, action, and event title legibly without overflow.
- [ ] No element on the page horizontally scrolls. Bottom 80px clear of content (bottom-nav clearance).

### 3.2 Events list — `src/app/(admin)/admin/events/page.tsx`

- [ ] Heading "Events" and "Create Event" CTA stack vertically below `sm:`. The "Create Event" button is full-width, gold, with `+` icon and `Create Event` label.
- [ ] Below `md:`, each event row renders as a stacked card (per §1.2 layout). Card displays: thumbnail (40×40), title, status badge, date, category tag, price, booked count, and three labelled action buttons.
- [ ] Long event titles wrap to two lines max inside the card title. Three-line titles truncate with ellipsis and a `title=` attribute carries the full string.
- [ ] Empty state ("No events yet…") is centred in the card and the card extends to a sensible min-height (~280px) so the page doesn't feel collapsed.

### 3.3 Event create / edit — `src/app/(admin)/admin/events/[id]/page.tsx` and `events/new/page.tsx`

- [ ] All 16 form fields render full-width at 375px, with 44px-tall inputs and clearly readable labels. No field is cramped or horizontally scrolling.
- [ ] The Refund Policy radio group: each radio row is at least 44px tall and wraps long copy ("Custom — refunds close N hours…") to two lines without overlapping the radio button.
- [ ] The "What's Included" inclusion items reflow to two rows per item: label input full width on row 1; icon select + remove button on row 2.
- [ ] Sticky save bar fixed to `bottom-16` (above the bottom-nav), full width, with `[Cancel] [Save]` side by side at 50/50 width. The bar has a top border, matches the page bg, and respects safe-area insets.
- [ ] On the Edit page, the "Duplicate Event" button stacks below the page heading on mobile (full-width, secondary outline) — does not crowd the back-arrow row.

### 3.4 Event bookings — `src/app/(admin)/admin/events/[id]/bookings/page.tsx`

- [ ] Header reads "{Event title}" + "X confirmed · Y waitlisted" stacked under the back-arrow row, both visible without truncation at 375px (event title wraps if needed).
- [ ] Filter tabs (All / Confirmed / Waitlisted / Cancelled / No-shows) wrap to two rows below `md:`, each pill `min-h-[44px]`. The active pill is visually clear.
- [ ] Booking rows render as cards: title row = member full name + status badge; body = email + booked-relative-time + waitlist position (if waitlisted) + payment badge (if paid); action row = "Promote" or "No-show" / "Undo" labelled button. Email truncates with `…` after ~30 chars and exposes the full string in `title=`.
- [ ] Export CSV button is full-width below `md:` (per §1.3 pattern), placed at the top of the card alongside the filter tabs.
- [ ] The "Email all attendees" form sits in its own card below the bookings list. Subject and body inputs are 44px-tall / multiline-textarea full width. The `[Send to N]` CTA is full-width below `md:`. The confirm dialog opens as a bottom sheet (per §1.5).

### 3.5 Members list — `src/app/(admin)/admin/members/page.tsx`

- [ ] Search/sort/export bar follows §1.3 pattern: stacked vertical, 44px-tall search input, sort with label above, full-width export button.
- [ ] Below `md:`, each member row renders as a card: title = avatar (32×32) + full name + status badge; body = email, job title (if any), company (if any), events attended, joined-relative; action = "Moderate" labelled button (right-aligned, full label not "icon-only").
- [ ] Admins (`role === 'admin'`) render the card without a Moderate action — instead show a faint "Admin" tag in the title-row right.
- [ ] MemberModerationDialog opens as a bottom sheet on mobile per §1.5, with reason textarea full-width and `[Reinstate / Suspend / Ban / Cancel]` actions stacked full-width.

### 3.6 Reviews — `src/app/(admin)/admin/reviews/page.tsx`

- [ ] Filter tabs (All / Visible / Hidden) wrap correctly with 44px-tall pills.
- [ ] Below `md:`, each review row renders as a card: title row = author avatar + name + visibility dot+label; body = star rating, event title, full review text (up to 3 lines, then "Read more" expanding inline); date relative; action = "Hide" / "Show" labelled button full-width inside the action row.
- [ ] The expanded review text is fully visible — no truncation when expanded. Tap on the text or the "Read more" link expands.
- [ ] Empty state ("No reviews found") centred, with a sensible min-height (~280px).

### 3.7 Notifications — `src/app/(admin)/admin/notifications/page.tsx`

- [ ] Heading "Notifications" and "Failed sends" link stack vertically below `sm:` — link is full-width on mobile with a leading warning icon and trailing failed-count badge.
- [ ] NotificationForm: To/Subject/Body fields all 44px tall (textarea is `rows={4}` ≈ 88px which is fine), CTA "Send Notification" full-width below `md:`. The yellow demo-mode banner stays at the top of the form.
- [ ] History list renders below the form. Each item shows subject (1-line truncate), recipient-type, sender, and relative time on the right. Long subjects truncate at ~30 chars; tap the row to expand the full subject (Phase 2 — for now `title=` for desktop hover, mobile gets the truncated string).
- [ ] No table on this page — already a list. Just verify the right-aligned timestamp doesn't wrap or overlap the subject.

### 3.8 Failed notifications — `src/app/(admin)/admin/notifications/failed/page.tsx`

- [ ] Header back-arrow row + page title + subtitle wrap correctly; subtitle ("Email sends the system logged as failed…") wraps to up to 3 lines without overlapping.
- [ ] Below `md:`, each failed row renders as a card: title = template name + relative-time; body = recipient email (truncated), subject (truncated), error message (full, wraps); action = "Retry" labelled button full-width inside action row.
- [ ] Inline retry success/error message renders inside the card, below the action row, with appropriate emerald/red text.
- [ ] Empty state ("No failed notifications. Everything's landing in inboxes.") centred at ~200px min-height.

### 3.9 Members > Deleted accounts — `src/app/(admin)/admin/deleted-accounts/page.tsx`

- [ ] Below `md:`, each deleted-account row renders as a card: title = placeholder name + "Hard-delete overdue" badge if applicable (otherwise nothing — the countdown lives in the body); body = User ID (mono, first 8 chars + "…"), Deleted (relative), Joined (relative), Countdown (e.g. "12 days until hard-delete" or the danger badge).
- [ ] No actions row — this page is read-only. The card has no bottom border / divider where the action row would otherwise be.
- [ ] Empty state ("No deleted accounts.") centred at ~200px min-height.
- [ ] Subtitle ("Members who closed their account…") wraps without truncation.

### 3.10 Cross-page

- [ ] No admin page horizontally scrolls at 375px in any state.
- [ ] All buttons, links, tabs, radios, and select triggers are ≥44×44 on mobile.
- [ ] Dark mode passes the same audit as light. Border / surface / text contrast remains compliant (no new hex values introduced).
- [ ] All text wraps cleanly — no clipped descenders, no overflow into the next card, no tooltip-only essential information.
- [ ] No layout shift when entering / leaving a page (skeleton heights match real content heights ±20%).

---

## 4. Touch-target audit

Buttons / links currently below 44×44 on mobile that the frontend-developer must fix:

| File | Element | Today | Target |
|---|---|---|---|
| EventsTable.tsx:122 | Edit / Bookings / Delete icon buttons | 44×44 (already) | Keep — but reflow to labelled buttons in row card per §1.2. |
| BookingsTable.tsx:117 | Filter tab pill | `min-h-[36px]` | `min-h-[44px]` below `md:`. |
| BookingsTable.tsx:227 | NoShow toggle pill | text-xs `py-1` ≈ 28px | `min-h-[44px]` below `md:`. Inside row-card action row this becomes a primary action button — width `flex-1` if siblings exist. |
| ReviewsTable.tsx:117 | Filter tab pill | `min-h-[36px]` | `min-h-[44px]` below `md:`. |
| ReviewsTable.tsx:61 | Hide / Show toggle | `min-h-[36px]` | `min-h-[44px]` below `md:`. |
| ReviewsTable.tsx:186 | Review-text expand `<button>` | bare text, no padding | The whole card is the tap target; the expand control becomes a labelled link "Read more / Show less" with `py-2`. |
| MembersTable.tsx:201 | Moderate button | `text-xs` `py-1` ≈ 28px | `min-h-[44px]` below `md:`. Inside row-card action row. |
| MembersTable.tsx:104 | Search input | `py-2` ≈ 36px | `h-11` below `md:`. |
| MembersTable.tsx:111 | Sort `<select>` | `py-2` ≈ 36px | `h-11` below `md:`. |
| MembersTable.tsx:122 | Export CSV link | `inline-flex text-sm` no min-height | Promote to full-width labelled button below `md:` per §1.3. |
| BookingsTable.tsx:128 | Export CSV link | same | same. |
| EventForm.tsx all `.form-input` | inputs and `<select>` | `padding 0.5rem` ≈ 36px | `h-11` (44px) below `md:`. Bump in the global `.form-input` style block. |
| EventForm.tsx:382 | Cancel button | `py-3` ≈ 44px (already OK) | Move into sticky save bar per §1.4; remove inline duplicate. |
| InclusionsList.tsx:82 | "Add item" link | `text-sm` no min-height | Promote to a labelled button (`+ Add item`, gold outline rounded-full) `min-h-[44px]` below `md:`. |
| PromoteButton.tsx:26 | Promote button | `min-h-[36px]` | `min-h-[44px]` below `md:`. |
| ConfirmDialog.tsx:152 | Cancel / Confirm | `py-2` ≈ 36px | `min-h-[44px]` below `md:`. |
| MemberModerationDialog.tsx:148 | All 4 action buttons | `py-2` ≈ 36px | `min-h-[44px]` below `md:`. |

This is **not** a complete audit — frontend-developer should run a final pass across `src/components/admin/**` looking for any `min-h-[36px]`, `py-1`, `py-1.5`, or unset min-height on a button/link/select.

---

## 5. Out of scope (explicit Phase 2 deferrals)

These were considered and intentionally left for later. Listed so we don't sneak them in.

- **Drag-to-reorder** for inclusion items, event order, or anything else. The desktop pattern is `↑↓` arrow buttons or no reorder at all; mobile drag-to-reorder is a substantial UX investment with its own touch-handling concerns. Defer.
- **Mobile-specific swipe actions** on row cards (swipe left to delete, swipe right to edit). Tempting but risky — a misfire-delete is bad. Use the explicit labelled action buttons in the action row.
- **Quick-actions FAB** (a floating "+" gold button on Events / Members). The page-level CTA stacking from §1.1 is enough; a FAB collides with the bottom-nav and adds visual noise. Revisit if Sophia tells us "I'm tapping Create a lot."
- **Pull-to-refresh** on tables. iOS Safari supports it natively for the page; explicit gesture handling on a list is out.
- **Haptic feedback** on confirm dialogs. Native web does not expose this consistently.
- **Search-as-you-type with virtualisation** for the members list. Today's debounced URL-param search ([MembersTable.tsx:58](src/components/admin/MembersTable.tsx)) is fine for the demo.
- **Keyboard-driven shortcuts** on mobile. iOS keyboard space is precious; admin shortcuts (`e` for edit etc.) belong on desktop only.
- **A separate "compact density" toggle.** Mobile gets the card density it gets — adding a setting is bloat.
- **Tablet-specific layouts** (768–1023px). The `md:` table-with-hidden-columns pattern remains there; only `<md:` switches to cards.
- **The `BookingsChart` Y-axis label rotation** (e.g. vertical "Bookings"). Recharts handles this poorly on mobile — leave the axis numeric-only.
- **Server-side pagination** for any of the tables. Sophia has 1k members at most for the demo; client-side render is fine.

---

## HANDOVER

- **Agent:** ux-designer
- **Task:** Mobile-responsive design spec for the entire `/admin/*` area at <768px. Defines table-to-card pattern, form rules, dialog responsiveness, dashboard reflow, copy adjustments, touch-target audit, and per-page acceptance criteria for 10 pages.
- **Files changed:** `docs/admin-mobile-spec.md` (new).
- **Migrations planned:** none (design phase).
- **Tests added:** none (design phase). Phase 2 implementer should add Playwright snapshots at 375px and 390px for each of the 10 pages.
- **Next agent:** frontend-developer — execute against this spec on the same `feat/admin-mobile-responsive` branch. Recommended order: §1.2 table→card pattern first (biggest payoff), then §1.5 dialog responsiveness (smallest blast radius), then §1.4 EventForm sticky save bar, then per-page polish.
- **Risks / open questions:**
  - The `grid-cols-2` switch for KPI cards (§1.6) is opinionated — if Sophia prefers single-column-stack-with-larger-numbers, frontend-developer can revert that one decision easily.
  - The sticky save bar in EventForm (§1.4) requires the bar to sit above the existing bottom-nav (`bottom-16`). Confirm this stacks correctly when the iOS keyboard opens — keyboards push the page up, the sticky bar should ride above the keyboard. If iOS quirks emerge, fall back to a non-sticky button at the foot of the form for mobile (still full-width).
  - "Email all attendees" CTA copy of "Send to {N}" requires the count to be reactive to backend changes between page loads. Today the count is server-rendered — fine for demo, revisit if real-time is needed.
  - No spec is given for `/admin` notification *push* / realtime UI — none exists yet. If Phase 3 adds realtime, write a separate spec.
