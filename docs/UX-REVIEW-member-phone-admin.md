# UX Spec — Member Mobile Phone in Admin Tables

**Status:** Ready for frontend-developer (presentation only)
**Author:** ux-designer
**Date:** 2026-06-02
**Branch:** `claude/kind-sinoussi-e81d07`
**Scope:** presentation of `profiles.phone_number` in two existing admin tables + a one-line own-profile verification statement. No code, no data-model decisions.

---

## 0. What this spec does and does not cover

**Covers (presentation only):**
- Where the phone appears in `BookingsTable` (per-event attendees) and `MembersTable` (admin members list), on desktop and on the mobile card variant.
- Header label, cell formatting, link/copy behaviour, null state, mobile responsiveness, dark mode, accessibility — all in design-token terms, zero hex.
- The single assertion the tester should make about the member's own-profile phone display.

**Does NOT cover (and must not be designed here):**
- How `phone_number` is read, granted, or shaped server-side — that is the architect's call (see §8, which flags the data-contract change the architect must make before this can be built).
- The member profile form itself (already shipped — see §7).
- Any change to existing columns, sorts, filters, or the CSV exports.

**Two surfaces. Two existing canonical layouts.** Both tables already render a **desktop `<table>` (`hidden md:block`)** and a **mobile stacked-card `<ul>` (`md:hidden`)** per [docs/admin-mobile-spec.md](./admin-mobile-spec.md) §1.2. This spec slots the phone into **both** layouts of **both** tables — four placements total — reusing the exact patterns already in those components.

---

## 1. Naming — "Mobile", not "Phone"

**Decision: the column header / row-label reads `Mobile`.**

- The audience is UK ("London professionals"). In British usage the personal number a person is reached on is their *mobile*; "Phone" reads as a generic/landline term. Soho House, Citymapper, and UK banking apps all label this field "Mobile".
- The stored field is `profiles.phone_number` and the profile edit form labels its input "Phone number" (see [EditProfileForm.tsx:299](../src/components/profile/EditProfileForm.tsx)). That is a member-facing field label and stays as-is — there is no requirement that an admin column header mirror a form field label, and "Mobile" is the tighter, more natural admin-table header. (If a future consistency pass wants them to match, change the *form* to "Mobile" — do not change this column to "Phone".)
- Header label is exactly `Mobile` (desktop `<th>`); mobile card row-label is exactly `Mobile` (the `<dt>`). No mobile-shortened variant is needed — "Mobile" is already 6 characters, shorter than the existing "Waitlist #" and "Company" labels.

---

## 2. Value formatting and element semantics

### 2.1 Display the stored value verbatim — do NOT reformat

**Decision: render the stored string exactly as persisted (e.g. `+447700900000`, `07700 900000`, `+44 7700 900111`). No client-side reformatting, normalisation, or masking.**

Rationale:
- The field is free-text-ish at entry: the edit form only strips spaces for validation and accepts both `07…` and `+44…` shapes ([EditProfileForm.tsx:103–105](../src/components/profile/EditProfileForm.tsx)). The stored value is therefore *already* in the shape the member typed. Reformatting it (e.g. forcing E.164, inserting spaces) would (a) require a formatter utility that does not exist in the codebase, (b) risk corrupting an unusual-but-valid number, and (c) introduce a second representation that the architect has not been asked to provide. Admin utility favours *fidelity* — Sophia wants to see the number the member actually gave.
- This keeps the data contract to a single `string | null` (see §8). No separately-formatted value is requested.

### 2.2 The value is an actionable `tel:` link

**Decision: when populated, the number renders as an anchor — `<a href="tel:…">{phone_number}</a>` — using the digits of the stored value as the `href`.**

- **Admin-utility justification:** the documented use case is "admins will want to call/message attendees" and the field already powers venue-reveal SMS. On Sophia's iPhone (the demo device — see admin-mobile-spec frame: iPhone 14, 390×844), tapping a `tel:` link offers Call / Message / Add to Contacts natively. On desktop it hands off to FaceTime/handoff or the default handler. This is the single highest-value interaction for the column, so the number *is* the affordance — no separate "call" icon button is needed (which would also add touch-target and column-width cost).
- **`href` shape:** strip whitespace from the stored value for the `href` only (`tel:` tolerates `+` and digits; spaces are unreliable across dialers). The **visible text stays the verbatim stored value.** Example: stored `+44 7700 900111` → `<a href="tel:+447700900111">+44 7700 900111</a>`. This is presentation-side string handling on a value already in hand — it is *not* a request for a normalised value from the data layer.
- **No click-to-copy.** Considered and rejected for this iteration: `tel:` already covers "call/message"; a copy affordance adds a second interactive control per row (icon button, toast, `navigator.clipboard` permission handling, an extra 44×44 target inside an already-dense row) for a marginal gain. The CSV export is the existing bulk-extract path. If Sophia later asks to copy numbers individually, add a copy button as a focused follow-up — do not bundle it here.
- **Link styling (tokens, zero hex):**
  - Default: inherit the cell's body text token (`text-text-secondary`) — the link should read as data first, not as a loud blue hyperlink. It is distinguished from plain text on hover/focus, not by a permanent colour.
  - Hover + focus-visible: `text-gold` (matches the existing LinkedIn link treatment in [ProfileHeader.tsx:108](../src/components/profile/ProfileHeader.tsx), `hover:text-gold`) plus `underline`. Use `hover:text-gold focus-visible:text-gold` and `focus-visible:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50` to match the focus ring used on admin inputs ([MembersTable.tsx:104](../src/components/admin/MembersTable.tsx)).
  - `whitespace-nowrap` on the link so a number never wraps mid-string (matches the "Booked" cell's `whitespace-nowrap`).

---

## 3. Null / empty state

**Decision: members with no phone render a muted em dash — `—` — identical to how the existing tables already render every other empty field.**

- Both tables already use `—` for null `email`, `job_title`, `company`, and `waitlist_position` (e.g. [MembersTable.tsx:180](../src/components/admin/MembersTable.tsx), [BookingsTable.tsx:179](../src/components/admin/BookingsTable.tsx)). The phone null state MUST match this exactly — do not invent "No phone", "N/A", or a greyed pill.
- **Token:** the dash uses `text-text-tertiary` (the lowest-emphasis text token; resolves to `#636366` light / `#A1A1A6` dark — both already audited at ≥5.2:1 contrast per the globals.css comments). This is the same token the existing dashes use.
- **Element:** plain text node, NOT an anchor (there is nothing to dial). Do not render a disabled `tel:` link.
- **Accessibility — the dash must not be read as bare punctuation.** A screen reader encountering a lone "—" may announce "em dash" or nothing, which is ambiguous in a data cell. Render:
  ```
  <span aria-hidden="true">—</span><span class="sr-only">No mobile number</span>
  ```
  This shows the dash visually and announces "No mobile number" to assistive tech. (The existing dashes in these tables do **not** yet do this; for the new Mobile cell, do it correctly. A later hygiene pass can retrofit the older cells — out of scope here.)

---

## 4. Mobile responsiveness (375px / 390px) — per table

The hard constraint: these tables are demo-visible and the desktop variant already drops columns at breakpoints. **Adding a 7th/9th column must not cause horizontal overflow.** Strategy differs per surface because the two desktop tables have different column budgets, but both *mobile* card variants follow the same rule.

### 4.1 BookingsTable — desktop `<table>` (`hidden md:block`)

Current columns: `Name | Email | Status | Payment | Booked | Waitlist # (lg only) | Action`.

- **Placement: insert `Mobile` immediately after `Email`.** Email and Mobile are the two contact fields; keeping them adjacent matches the mental model ("how do I reach this attendee").
- **Breakpoint visibility: the `Mobile` column is `hidden lg:table-cell`** — i.e. it shows only at `lg:` (≥1024px) and up, exactly like the existing `Waitlist #` column ([BookingsTable.tsx:159](../src/components/admin/BookingsTable.tsx)). Between `md:` and `lg:` the table is already near its width budget (six visible columns); adding a seventh at `md:` risks overflow on a 768–1023px admin pane. At `lg:` there is room. Below `md:` the whole table is hidden anyway (cards take over — see §4.2).
  - Apply `hidden lg:table-cell` to **both** the `<th>` and the matching `<td>`.
- **No new horizontal scroll introduced** — the column only appears at the width where it fits. The existing `overflow-x-auto` wrapper remains as the final safety net.

### 4.2 BookingsTable — mobile card `<ul>` (`md:hidden`)

Each booking is a card with title row (name + status badge) and a `<dl>` body of label/value pairs ([BookingsTable.tsx:239–260](../src/components/admin/BookingsTable.tsx)). The card has no width budget problem — it stacks vertically.

- **Add a `Mobile` row to the `<dl>` body, positioned directly below the existing email treatment.** The email currently lives in the title-row sub-line; Mobile sits as the first `<dl>` pair so the two contact details read together near the top of the card. Pattern matches the existing pairs exactly:
  ```
  <div class="flex items-center justify-between gap-3">
    <dt class="text-text-tertiary">Mobile</dt>
    <dd>{ populated ? <tel link> : <dash + sr-only> }</dd>
  </div>
  ```
- **Render the row only when relevant?** No — show the `Mobile` row **always** (populated → `tel:` link; null → the muted dash + sr-only label). Rationale: in a card list, a *consistently present* "Mobile —" line tells Sophia at a glance "this attendee has no number on file", which is itself useful operational signal. (Contrast: email is only shown when present because it sits in the title sub-line, not the labelled `<dl>`. The `<dl>` convention in these cards is label-always-present, value-or-dash — `Waitlist #` is the exception only because it is status-conditional.) The `<dd>`'s value still uses the dash treatment when null.
- The `tel:` link inside the `<dd>` is right-aligned by the `justify-between` row; add `text-right` if the number would otherwise hug the label awkwardly — match the `text-right` already used on the Title/Company values in MembersTable cards.

### 4.3 MembersTable — desktop `<table>` (`hidden md:block`)

Current columns: `Name | Email | Job Title (lg only) | Company (lg only) | Events | Joined | Status | Action`.

- **Placement: insert `Mobile` immediately after `Email`** (same contact-adjacency logic as §4.1).
- **Breakpoint visibility: `hidden lg:table-cell`**, matching the existing `Job Title` and `Company` columns ([MembersTable.tsx:143–144](../src/components/admin/MembersTable.tsx)). This table already carries eight columns and only shows the optional three (`Job Title`, `Company`, and now `Mobile`) at `lg:`. Below `lg:` the four optional columns collapse and the card variant handles `<md:`.
  - Apply `hidden lg:table-cell` to both `<th>` and `<td>`.
- The `Email` cell already has `truncate max-w-[200px]`; the new `Mobile` cell does **not** need truncation (numbers are short) but MUST carry `whitespace-nowrap` so a `+44 …` number never wraps.

### 4.4 MembersTable — mobile card `<ul>` (`md:hidden`)

Each member card has a title row (avatar + name + status) and a `<dl>` body (`Title`, `Company`, `Events`, `Joined`) ([MembersTable.tsx:268–295](../src/components/admin/MembersTable.tsx)).

- **Add a `Mobile` row to the `<dl>` body.** Position: directly **after `Company`** and **before `Events`** — i.e. group the contact/professional detail (Title, Company, Mobile) together, then the activity stats (Events, Joined). Email stays in the title sub-line as today.
- **Always render the row** (populated → `tel:` link; null → muted dash + sr-only), for the same at-a-glance "no number on file" reason as §4.2. Note this differs from the existing `Title`/`Company` rows, which are *conditionally* rendered (`{member.job_title && …}`). The `Mobile` row is **unconditional** so Sophia can always see contactability state. Use the standard pair markup:
  ```
  <div class="flex items-center justify-between gap-3">
    <dt class="text-text-tertiary">Mobile</dt>
    <dd class="text-right">{ populated ? <tel link> : <dash + sr-only> }</dd>
  </div>
  ```

### 4.5 Mobile summary

| Surface | Where phone goes | Visible when |
|---|---|---|
| BookingsTable desktop | New column after Email | `lg:` and up (`hidden lg:table-cell`) |
| BookingsTable mobile card | First `<dl>` pair (above Booked) | always (`<md:`) |
| MembersTable desktop | New column after Email | `lg:` and up (`hidden lg:table-cell`) |
| MembersTable mobile card | `<dl>` pair after Company | always (`<md:`) |

No surface introduces a new horizontal-scroll requirement: desktop columns appear only at the width that fits them; cards stack vertically.

---

## 5. Dark mode

No new tokens; everything resolves through the existing CSS-variable theme (globals.css defines light + dark values for every token used here). Specifically:

- **Phone value / `tel:` link default:** `text-text-secondary` → `#4A4A4C` light / `#C7C7CC` dark. Legible on both `bg-bg-card` surfaces (`#FFFFFF` light / `#2C2C2E` dark).
- **Hover/focus accent:** `text-gold` (`#C9A96E`) is identical in both themes (gold is theme-invariant in globals.css) and is already used as the hover accent on dark surfaces elsewhere — contrast is acceptable against both card backgrounds.
- **Focus ring:** `ring-gold/50` — same as existing admin inputs in both themes.
- **Null dash:** `text-text-tertiary` → `#636366` light / `#A1A1A6` dark; both annotated in globals.css as ≥5.2:1, so the dash and (visually hidden) label pass contrast in both themes.

**Acceptance:** the Mobile cell, the `tel:` link (resting + hover + focus), and the null dash must all be legible in dark mode on `bg-bg-card`. Because they reuse tokens already proven in these exact components, no bespoke dark-mode override is permitted — using `dark:` literal hex would violate the LOCKED-token rule in CLAUDE.md.

---

## 6. Accessibility

1. **`tel:` link has an accessible name.** The link text *is* the phone number, which is a usable accessible name, but a bare number read aloud is ambiguous ("plus four four seven…"). Add context via `aria-label`:
   `aria-label={`Call ${member.full_name} on ${phone_number}`}` (members table) / `aria-label={`Call ${profile.full_name} on ${phone_number}`}` (bookings table). The visible text remains the verbatim number; the `aria-label` gives screen-reader users the who + the action.
2. **Null state is not read as bare punctuation.** Per §3: `<span aria-hidden="true">—</span><span class="sr-only">No mobile number</span>`. Screen reader announces "No mobile number", not "em dash" / silence.
3. **Touch target ≥ 44px on mobile.** The project minimum is `44×44` ([admin-mobile-spec.md §1.7](./admin-mobile-spec.md)). In the mobile card variants the `tel:` link is the tap target and MUST present a ≥44px-high hit area: add `inline-flex items-center min-h-[44px]` (and `py-2` if needed) to the link inside the `<dd>` on `<md:`. On desktop the column lives at `lg:` (pointer-primary) where the 44px rule does not apply, but keep the link comfortably clickable (the existing row `py-3` gives ~44px row height already).
4. **Heading/semantics.** Desktop: the new `<th>` is a real table header (`scope` is implied by `<thead>` position — match the existing `<th>` markup, no extra attributes). Mobile: the `<dt>`/`<dd>` pair is correct semantic markup for a label/value, already the convention in these cards.
5. **Colour is never the sole state indicator.** The `tel:` link is distinguished from plain text by being interactive (hover/focus underline + colour shift) AND by carrying its `aria-label`; the null dash is distinguished by the sr-only "No mobile number" text. Neither relies on colour alone.

---

## 7. Own-profile (Task 3) — single verification statement

> **Tester assertion:** On `/profile`, a signed-in member whose `phone_number` is populated sees that exact saved value rendered in the profile header (the owner-only contact row, next to the email — [ProfileHeader.tsx:122–127](../src/components/profile/ProfileHeader.tsx)), and the same value is pre-filled and editable in the "Phone number" field of the Edit Profile form ([EditProfileForm.tsx:299–310](../src/components/profile/EditProfileForm.tsx)). A member with a null `phone_number` sees no phone line in the header and an empty, editable phone field in the form.

This behaviour **already ships** and is **not being redesigned**. The profile page already fetches the owner's own number via the `getMyPhone()` SECURITY DEFINER RPC and merges it as `profile.phone_number` before passing to the client ([profile/page.tsx:35–57](../src/app/(member)/profile/page.tsx)), so the header and form read it unchanged. The statement above is only here so the tester has one concrete, pass/fail thing to verify alongside the two admin tables — no frontend work is required on the profile for this task.

---

## 8. Data-contract flag — RELAY TO ARCHITECT (blocks build)

**This presentation work cannot be built until the data layer supplies `phone_number` to each surface. Both current admin reads deliberately exclude it, and one is GRANT-restricted at the database level. This is a data-model/security decision the architect owns — not something the frontend-developer should improvise.**

1. **`getEventBookings` (attendees)** currently selects
   `profile:profiles!bookings_user_id_fkey(id, full_name, email, avatar_url)`
   ([admin/actions.ts:1583](<../src/app/(admin)/admin/actions.ts>)) — **no `phone_number`**. The `BookingRow.profile` type in [BookingsTable.tsx:27](../src/components/admin/BookingsTable.tsx) likewise has no phone field. The architect must decide how an admin obtains each attendee's phone (extend this admin-only read to include it, vs a batch `admin_get_user_phone()`-style helper) and expose it on the row the table renders.

2. **`getAdminMembers` (members list)** enumerates an explicit column allow-list that **omits `phone_number`**, because migration `20260503000002 (narrow_phone_number_grant)` revoked `phone_number` from the `authenticated` SELECT GRANT; `select('*')` would now raise `42501`. The code then casts the row `as unknown as MemberWithStats` and notes that any caller needing phone "should switch to `admin_get_user_phone()`" ([admin/actions.ts:1711–1796](<../src/app/(admin)/admin/actions.ts>)). So although the `MemberWithStats` *type* nominally carries `phone_number: string | null` (via `extends Profile`), the runtime value is currently absent. The architect must define the admin-only batch read that populates phone for the members list without re-widening the `authenticated` GRANT.

**What presentation needs from the architect — minimal contract:**
- A single nullable string per row, reachable as `phone_number: string | null` (or an equivalently-named field) on the object each table maps over: the `BookingRow.profile` object for BookingsTable, and the `MemberWithStats` row for MembersTable.
- **No separately-formatted value is required.** Presentation displays the raw stored string and builds the `tel:` href by stripping whitespace client-side (§2). The data layer does **not** need to provide a normalised/E.164 variant. If the architect *prefers* to centralise normalisation, that is their call — but this spec does not request it and does not depend on it.
- Whatever read path is chosen must remain **admin-gated** (phone is PII, already hidden from anon and non-admin members); presentation assumes the value only ever reaches these admin-only components.

Until the architect resolves the above and the field is present on both row shapes, the frontend-developer should treat this spec as blocked.

---

## 9. Acceptance checklist (for the implementer, once unblocked)

Per table, all of the following true at 375×667 (iPhone SE), 390×844 (iPhone 14), and `lg:` desktop, in light **and** dark mode, with seeded data:

- [ ] Header / row-label reads exactly `Mobile`.
- [ ] Populated value renders verbatim (no reformatting) as a `tel:` link; `href` is the stored value with whitespace stripped.
- [ ] `tel:` link: resting = `text-text-secondary`; hover/focus = `text-gold` + underline + `ring-gold/50`; `whitespace-nowrap`; `aria-label="Call {name} on {number}"`.
- [ ] Null value renders the muted em dash via `text-text-tertiary`, with `<span aria-hidden="true">—</span><span class="sr-only">No mobile number</span>`.
- [ ] **BookingsTable desktop:** new column after Email, `hidden lg:table-cell` on `<th>` + `<td>`; no horizontal overflow at `md:`–`lg:`.
- [ ] **BookingsTable mobile card:** unconditional `Mobile` `<dl>` pair (first pair); `tel:` link tap area ≥44px high.
- [ ] **MembersTable desktop:** new column after Email, `hidden lg:table-cell` on `<th>` + `<td>`; `whitespace-nowrap` on the cell.
- [ ] **MembersTable mobile card:** unconditional `Mobile` `<dl>` pair after Company; `tel:` link tap area ≥44px high.
- [ ] Zero literal hex introduced anywhere (all colours via semantic Tailwind tokens).
- [ ] No existing column, sort, filter, or CSV export behaviour changed.
- [ ] Own-profile assertion in §7 still passes (regression check — no profile changes expected).

---

## HANDOVER

- **Agent:** ux-designer
- **Task:** Presentation spec for `profiles.phone_number` in the two admin tables (BookingsTable attendees + MembersTable list), plus a one-line own-profile verification statement. Defines header label ("Mobile"), verbatim value + `tel:` link semantics, null em-dash treatment, desktop column placement (`hidden lg:table-cell` after Email in both), mobile stacked-card `<dl>` placement, dark-mode token mapping, and a11y (aria-label on link, sr-only on null dash, ≥44px tap target).
- **Files changed:** `docs/UX-REVIEW-member-phone-admin.md` (new).
- **Migrations planned:** none (design phase).
- **Tests added:** none (design phase). Implementer should add component tests asserting: populated → `tel:` anchor with stripped-whitespace href + aria-label; null → sr-only "No mobile number"; column hidden below `lg:` on desktop; row present in mobile cards.
- **Next agent:** `architect` FIRST (blocking), then `frontend-developer`.
  - **HANDOFF NEEDED:** this UX flow depends on a data-contract decision. Route to `architect` to decide how `phone_number` is supplied — admin-gated — to (a) the `BookingRow.profile` object from `getEventBookings` (currently selects no phone) and (b) the `MemberWithStats` row from `getAdminMembers` (currently omits phone because migration `20260503000002` revoked it from the `authenticated` GRANT; comment in `admin/actions.ts` already points to an `admin_get_user_phone()` helper). Then back to `frontend-developer` to implement this spec.
- **Risks / open questions:**
  - **Blocking:** neither admin read currently returns `phone_number` (§8). Frontend cannot start until the architect lands the read path on both row shapes.
  - Presentation needs only `string | null`; it does **not** request a normalised/E.164 value (href whitespace-strip is done client-side). Flagged so the architect doesn't over-build the contract.
  - The `tel:` link is the only phone affordance (no click-to-copy this iteration) — noted as an explicit deferral in §2.2 should Sophia later ask for per-row copy.
  - The new Mobile null cell uses the correct sr-only treatment; the *existing* dashes in these tables (email/title/company/waitlist) do not. A later a11y hygiene pass could retrofit them — out of scope here, flagged so it isn't mistaken for an inconsistency I introduced.
