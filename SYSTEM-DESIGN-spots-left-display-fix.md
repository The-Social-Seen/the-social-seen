# SYSTEM-DESIGN — Public "spots left" undercounts occupied seats

> Produced by: Architect agent
> Date: 2026-07-13
> Status: **SPEC — ready for backend-developer implementation.** Ship today.
> Trigger: live production bug, discovered 2026-07-13, actively affecting an event happening tomorrow (2026-07-14).
> Cross-references: `SYSTEM-DESIGN.md` ADR-04 (`event_with_stats` origin), ADR-15 (admin waitlist-promotion payment holds), `SYSTEM-DESIGN-admin-waitlist-promotion-payment.md` (the feature whose Addendum §A surfaced this bug).

---

## Table of Contents

1. [TL;DR](#1-tldr)
2. [Root cause — it's two bugs wearing one trenchcoat](#2-root-cause--its-two-bugs-wearing-one-trenchcoat)
3. [Field-by-field classification of `event_with_stats`](#3-field-by-field-classification-of-event_with_stats)
4. [Why `confirmed_count` must NOT be redefined in place](#4-why-confirmed_count-must-not-be-redefined-in-place)
5. [The migration](#5-the-migration)
6. [Proof: `confirmed_count` and `revenue_collected` are byte-identical before/after](#6-proof-confirmed_count-and-revenue_collected-are-byte-identical-beforeafter)
7. [Required application-code follow-up (not optional, not a separate PR)](#7-required-application-code-follow-up-not-optional-not-a-separate-pr)
8. [Call-site audit](#8-call-site-audit)
9. [The side-effect judgment: widened predicate vs. today's bug](#9-the-side-effect-judgment-widened-predicate-vs-todays-bug)
10. [RLS / grants](#10-rls--grants)
11. [Anon-visibility decision for the new column](#11-anon-visibility-decision-for-the-new-column)
12. [TypeScript type change + test blast radius](#12-typescript-type-change--test-blast-radius)
13. [Deployment sequencing, risk, rollback](#13-deployment-sequencing-risk-rollback)
14. [Explicitly out of scope](#14-explicitly-out-of-scope)
15. [Open questions / recommended fast-follows](#15-open-questions--recommended-fast-follows)

---

## 1. TL;DR

- **Bug:** `event_with_stats.confirmed_count` / `spots_left` count `status = 'confirmed'` bookings only. The real booking gates (`book_event_paid`, `claim_waitlist_spot`, `admin_promote_waitlist_to_hold`, `admin_hold_confirmed_booking_for_payment`) all count `status IN ('confirmed', 'pending_payment')`. Any time a seat is held by an in-flight Stripe checkout, or by an admin payment-remediation hold, the public site understates occupancy and overstates availability.
- **The fix has two required parts, both must ship in the same deploy:**
  1. A SQL migration that adds a new `occupied_count` column to `event_with_stats` (`confirmed + pending_payment`) and rebases `spots_left` on it. `confirmed_count` and `revenue_collected` are proven mathematically unchanged (§6).
  2. A **required** TypeScript change to `getEventBySlug()` in `src/lib/supabase/queries/events.ts`. This function does **not** read the view's own `spots_left` column — it re-derives `spots_left` locally in JS from `confirmed_count` alone. **Shipping the migration without this code change leaves the bug fully live on the single highest-stakes page: the event detail page, where the "Book Now" button actually lives.** See §7 — this is the most important finding in this document.
- **Correcting your two-bucket assumption:** `confirmed_count` should **not** be redefined in place — it must stay confirmed-only, because it deliberately backs the admin "Booked" column and is the audit-basis sibling of `revenue_collected`. Widening it in place would quietly recreate the same "numbers don't add up" bug pattern on the *admin* side. Instead, a new field (`occupied_count`) carries the confirmed+pending_payment concept, and `spots_left` is rebased on it. `total_attending` should also **not** widen (see §3) — that's a distinct, separately-broken, pre-existing issue that isn't part of today's fix.
- **Judgment on the side-effect (§9):** ship it, unhedged. The new cost (a genuinely-abandoned checkout makes an event look ~1 seat more sold-out than reality for up to ~50 minutes, self-healing) is strictly bounded and safe-by-default. The status-quo bug is unbounded and already live: `reap_stale_pending_bookings()` explicitly *excludes* `is_admin_hold = true` rows (`AND is_admin_hold = false`), and both admin-hold Server Actions (`promoteFromWaitlist`, `sendPaymentLinkForConfirmedBooking`) hardcode `holdExpiresAt: null` today — so Amy's and Yasemin's remediated bookings will overstate availability **indefinitely**, not for 35 minutes, until a human intervenes. Confirmed by reading the code, not assumed.
- **No RLS/grant changes needed** (§10) — verified against three precedent migrations that already DROP+CREATE this exact view with zero GRANT statements, relying on Supabase's schema-level default privileges.
- **CLAUDE.md's anon-visibility rule is scoped to `public.profiles` columns** and doesn't textually apply to a view over `events`/`bookings` (§11) — but I ran the equivalent analysis anyway and it's safe to expose.

---

## 2. Root cause — it's two bugs wearing one trenchcoat

The reported symptom ("spots left went up when an admin moved bookings out of `confirmed`") has **one** SQL-level cause but **two** locations that need fixing:

1. **`event_with_stats` (the view).** Defined by `supabase/migrations/20260402000011_create_views.sql`, most recently modified by `20260507000002_add_revenue_to_event_with_stats.sql` (the current, live definition — read in full below). `confirmed_count` and `spots_left` are both computed from a subquery scoped to `WHERE status = 'confirmed'`.

2. **`getEventBySlug()` in `src/lib/supabase/queries/events.ts` (lines 294–329).** This is the function behind `/events/[slug]` — the event detail page, `BookingSidebar`, `MobileBookingBar`, and the SEO JSON-LD. It does **not** `SELECT *` from the view the way every other reader does. It selects only `confirmed_count, total_attending` from `event_with_stats`, then **re-derives `spots_left` itself in JavaScript**:

   ```ts
   const confirmed = statsResult.data?.confirmed_count ?? 0
   ...
   const spotsLeft = event.capacity == null ? null : Math.max(event.capacity - confirmed, 0)
   ```

   This means the event detail page's `spots_left` is **not sourced from the view's `spots_left` column at all** — it's a second, independent implementation of the same (currently-buggy) formula. Fixing the view alone does not touch this code path. This is exactly the "arithmetic like `capacity - confirmed_count`" pattern you asked me to hunt for, and it's on the one page where getting it wrong actually lets someone click "Book Now" and land on the waitlist.

Every *other* reader of the view (`getPublishedEvents`, `getPastEvents`, `getRelatedEvents`, `getAdminEvents`) does a plain `SELECT '*, ...'` and will pick up the corrected `spots_left` automatically once the view changes — zero code changes needed for those. `getEventBySlug` is the one deliberate exception, for reasons that made sense when it was written (see the existing comment at lines 279–292 about RLS-scoped direct counts) but that reasoning didn't anticipate a second, wider predicate.

---

## 3. Field-by-field classification of `event_with_stats`

Current live shape (from `20260507000002_add_revenue_to_event_with_stats.sql`): `e.*`, `confirmed_count`, `revenue_collected`, `avg_rating`, `review_count`, `spots_left`.

| Field | Formula today | "Is there room / how full?" | Widen to confirmed+pending_payment? | Verdict |
|---|---|---|---|---|
| `confirmed_count` | `COUNT(*)` where `status='confirmed'` | Feeds `spots_left`'s (buggy) formula, but its own job is audit/money tracking | **No** | Stays exactly as-is. Backs the admin "Booked" column (`EventsTable.tsx`) and is the sibling basis of `revenue_collected`. See §4 for why redefining it would be a mistake, not just an unnecessary change. |
| `revenue_collected` | `SUM(price_at_booking)` where `status='confirmed'` | No — money actually collected | **No** (your instruction, confirmed correct) | Unchanged. `pending_payment` is by definition not-yet-collected. Proven byte-identical output in §6. |
| `spots_left` | `capacity - confirmed_count` | **Yes — this is the bug** | **Yes** | Rebased on the new `occupied_count`. This is the actual fix. |
| `avg_rating`, `review_count` | Aggregated from `event_reviews` | No — unrelated to bookings at all | N/A | Untouched. |
| `total_attending` | *(intended: `confirmed_count + external_attendees`)* | Superficially yes (it's a "how full" adjacent number, and it's in a capacity-progress-bar's fill %) | **No — correcting your assumption** | See below. Also: **it currently doesn't exist on the view at all** — a separate, pre-existing regression (§15). Out of scope today either way. |
| *(new)* `occupied_count` | `COUNT(*)` where `status IN ('confirmed','pending_payment')` | Yes — this **is** "how full," definitionally | — | New field. `spots_left` derives from it. See §4–§5. |
| all other `e.*` columns | passthrough from `events` | No | N/A | Untouched. |

**Why `total_attending` should NOT widen, even once its own (separate) bug is fixed:** "X people going" reads as a roster claim — people who are actually coming. Someone 90 seconds into a Stripe Checkout session hasn't committed to anything; if they abandon and get reaped 35 minutes later, a "people going" counter that ticks back down with no visible "someone cancelled" event is a worse trust signal than a stable, honest, confirmed-only headline. Compare to `spots_left`: users already understand availability counters as reservation-based and expect them to flicker (this is how every ticketing site with a cart-hold works) — but they read an "attendee" head-count as a roster of real people, not a snapshot of in-progress carts. This is a semantic distinction, not a technical one, and it's the reason your working two-bucket split needed correcting rather than just confirming.

---

## 4. Why `confirmed_count` must NOT be redefined in place

This is the one place I'm actively overriding your stated assumption rather than just confirming it, so the reasoning needs to be explicit.

`src/components/admin/EventsTable.tsx` (admin event list) renders:

```tsx
<td>{event.confirmed_count}/{event.capacity ?? '∞'}</td>   {/* "Booked" column */}
...
<td>{event.revenue_collected !== null ? formatPrice(event.revenue_collected) : '—'}</td>   {/* "Revenue" column */}
```

This is **deliberate, documented** platform-only/paid-only accounting — the migration that added `total_attending` (`20260505205025_add_events_external_attendees.sql`) says so explicitly: *"confirmed_count and spots_left are unchanged (preserves audit/admin semantics — admin EventsTable continues to read confirmed_count for a platform-only view)."*

If `confirmed_count` were redefined in place to mean confirmed+pending_payment:

- The admin "Booked" column would silently start including people who haven't paid yet, sitting directly next to a "Revenue" column that (correctly, per your own constraint) still only reflects confirmed/paid money.
- That's the **exact same class of "numbers don't visually add up" confusion** this whole fix exists to eliminate — just relocated from the public site to the admin dashboard, and arguably worse there, since admins are the ones expected to trust these numbers for real financial reconciliation.
- `total_attending`'s formula is *literally* `confirmed_count + external_attendees` at the SQL level (once that field is restored — §15). Silently widening `confirmed_count` would silently widen `total_attending` too, as an unreviewed side effect of an unrelated column's formula, not a deliberate choice.

**Decision:** introduce a new, additive `occupied_count` column instead. `confirmed_count` keeps its current, narrow, audit-correct meaning untouched. This is the smaller, safer change, and it's the one that doesn't require re-litigating the admin Booked-column design decision under today's time pressure.

---

## 5. The migration

**File to create** (not created by this agent — architect does not write to `supabase/migrations/`): `supabase/migrations/20260713000005_widen_spots_left_to_include_pending_payment.sql`

Numbering note: today already has `...000001`, `...000002`, `...000004` (`...000003` is deliberately reserved for the still-unbuilt `revert_expired_admin_holds` cron per `20260713000004`'s own header — do not use it). `...000005` is next and free.

```sql
-- Migration: widen_spots_left_to_include_pending_payment
--
-- Fixes a live production bug (2026-07-13): the public "spots left" /
-- SOLD OUT / waitlist-CTA signal only counted status='confirmed'
-- bookings, while the actual booking gates (book_event_paid,
-- claim_waitlist_spot, admin_promote_waitlist_to_hold,
-- admin_hold_confirmed_booking_for_payment) all count
-- status IN ('confirmed', 'pending_payment') when deciding whether a
-- new booking gets confirmed or waitlisted. Whenever a seat was held by
-- an in-flight Stripe checkout, or by an admin payment-remediation hold
-- (see SYSTEM-DESIGN-admin-waitlist-promotion-payment.md Addendum §A),
-- the public site understated occupancy and overstated availability —
-- a member could see "spots available," attempt to book, and land on
-- the waitlist instead of getting confirmed. See
-- SYSTEM-DESIGN-spots-left-display-fix.md for the full design,
-- including why confirmed_count and revenue_collected are deliberately
-- LEFT UNCHANGED (they back the admin "Booked"/"Revenue" columns and
-- must stay audit-correct) and why a new occupied_count column carries
-- the widened concept instead of redefining confirmed_count in place.
--
-- Shape change
-- ────────────
-- Adds one column to the existing event_with_stats view:
--   occupied_count  bigint  -- COUNT of 'confirmed' + 'pending_payment'
--                           -- bookings (zero-coalesced). The codebase's
--                           -- own vocabulary already calls this
--                           -- "occupied" — see book_event_paid_with_fee's
--                           -- comment: "both 'confirmed' AND
--                           -- 'pending_payment' count as occupied."
-- Rebases spots_left's CASE expression on occupied_count instead of
-- confirmed_count. confirmed_count and revenue_collected keep their
-- EXACT existing formulas (now expressed via FILTER instead of a
-- blanket WHERE, so they can coexist with occupied_count's wider base
-- population) — proven byte-identical output for every possible row in
-- SYSTEM-DESIGN-spots-left-display-fix.md §6. avg_rating / review_count
-- untouched. total_attending is NOT restored or touched here — it's a
-- separate, pre-existing, already-flagged regression (see the doc's
-- §15) and is explicitly out of scope for this fix.
--
-- Anon visibility
-- ───────────────
-- CLAUDE.md's "new column on public.profiles" rule doesn't textually
-- apply — this isn't a profiles column. Ran the equivalent analysis
-- anyway: occupied_count is a scalar aggregate COUNT, same privacy
-- class as the already-public confirmed_count/spots_left. It exposes
-- no new sensitive information — anon can already see events.capacity
-- and the old spots_left, so "how many seats are technically held right
-- now, paid or not" is not a new category of disclosure. No new GRANT
-- needed — see "Grants" note below.
--
-- Grants
-- ──────
-- No GRANT/REVOKE statements in this migration, deliberately. Verified
-- against three precedent migrations that already DROP+CREATE this
-- exact view (20260505205025, 20260506000001, 20260507000002) — none
-- of them issue a GRANT either, and the view has continued to serve
-- anon/authenticated reads correctly in production after each. This
-- confirms the view relies on Supabase's schema-level default
-- privileges (applied automatically to new objects), not a
-- migration-issued grant — there is nothing to lose by recreating the
-- view under the same name/owner. Row-level visibility (published vs.
-- draft events) is unaffected — the view still inherits RLS from
-- public.events / public.bookings / public.event_reviews exactly as
-- before; only the internal aggregate formula changes, not which
-- tables are read or how their RLS is evaluated.
--
-- Why DROP + CREATE (not CREATE OR REPLACE)
-- ─────────────────────────────────────────
-- Postgres CREATE OR REPLACE VIEW requires new columns to be appended
-- at the end of the column list. occupied_count belongs next to
-- confirmed_count (its sibling aggregate from the same bookings
-- subquery), not at the very end — same reasoning, same DROP IF EXISTS
-- + CREATE pattern already established by 20260506000001 and
-- 20260507000002.
--
-- Idempotency
-- ───────────
-- DROP VIEW IF EXISTS + CREATE VIEW — safe to re-run; re-applying after
-- a successful apply is a no-op-ish recreate (matches the two
-- precedent migrations' documented idempotency story).
--
-- Dependencies
-- ────────────
-- No other database object (function, other view, materialized view)
-- references event_with_stats — verified via
-- `grep -rn "FROM.*event_with_stats\|JOIN.*event_with_stats" supabase/migrations/`,
-- zero real hits (only comment-only "Verify:" lines in prior
-- migrations). DROP VIEW will not fail on a dependency.
--
-- Rollback
-- ────────
-- DROP VIEW public.event_with_stats; then recreate verbatim from
-- 20260507000002_add_revenue_to_event_with_stats.sql's CREATE VIEW
-- body. Not destructive either direction — no data is mutated by this
-- migration, only a read-model formula.
--
-- Post-merge
-- ──────────
-- CI applies migrations to local Supabase only. After merge run manually:
--   supabase db push --include-all --linked
-- This is a live-incident fix — confirm the push has actually run
-- (memory: migrations need a manual push step; a merged PR alone does
-- NOT reach production).

DROP VIEW IF EXISTS public.event_with_stats;

CREATE VIEW public.event_with_stats AS
SELECT
  e.*,
  COALESCE(bc.confirmed_count, 0)     AS confirmed_count,
  COALESCE(bc.occupied_count, 0)      AS occupied_count,
  COALESCE(bc.revenue_collected, 0)   AS revenue_collected,
  COALESCE(rc.avg_rating, 0)          AS avg_rating,
  COALESCE(rc.review_count, 0)        AS review_count,
  CASE
    WHEN e.capacity IS NULL THEN NULL
    ELSE GREATEST(e.capacity - COALESCE(bc.occupied_count, 0), 0)
  END AS spots_left
FROM public.events e
LEFT JOIN (
  SELECT
    event_id,
    COUNT(*) FILTER (WHERE status = 'confirmed')                      AS confirmed_count,
    COUNT(*)                                                          AS occupied_count,
    SUM(price_at_booking) FILTER (WHERE status = 'confirmed')::bigint AS revenue_collected
  FROM public.bookings
  WHERE status IN ('confirmed', 'pending_payment') AND deleted_at IS NULL
  GROUP BY event_id
) bc ON bc.event_id = e.id
LEFT JOIN (
  SELECT event_id,
         AVG(rating)::numeric(3,2) AS avg_rating,
         COUNT(*)                  AS review_count
  FROM public.event_reviews
  WHERE is_visible = true
  GROUP BY event_id
) rc ON rc.event_id = e.id
WHERE e.deleted_at IS NULL;

-- Verify (general): rows where the widened predicate actually changes
-- the answer — i.e. events with an in-flight pending_payment row. Most
-- rows will show confirmed_count = occupied_count (no pending_payment
-- in flight), so a blanket LIMIT 5 wouldn't demonstrate anything.
--   SELECT id, title, capacity, confirmed_count, occupied_count, spots_left
--   FROM public.event_with_stats
--   WHERE confirmed_count <> occupied_count
--   LIMIT 10;
--
-- Verify (this specific incident): confirms today's two remediated
-- bookings (Amy Sangam, Yasemin Salp — admin_hold_confirmed_booking_
-- for_payment) now correctly reduce spots_left for their event.
--   SELECT ews.id, ews.title, ews.capacity, ews.confirmed_count,
--          ews.occupied_count, ews.spots_left
--   FROM public.event_with_stats ews
--   JOIN public.bookings b ON b.event_id = ews.id
--   WHERE b.is_admin_hold = true AND b.status = 'pending_payment';
```

---

## 6. Proof: `confirmed_count` and `revenue_collected` are byte-identical before/after

You asked me to confirm, not assume, that `revenue_collected`'s semantics are untouched. Walking every case:

**`confirmed_count`:**
- An event with only `confirmed` rows: identical either way — the `FILTER` restates exactly what the old blanket `WHERE status = 'confirmed'` did.
- An event with only `pending_payment` rows, zero `confirmed`: **before**, the old blanket-`WHERE` subquery produces no row at all for that `event_id` (the row never enters the group), so the outer `COALESCE(bc.confirmed_count, 0)` → `0`. **After**, the subquery *does* produce a row for that `event_id` (because `pending_payment` rows now pass the wider base `WHERE`), but `COUNT(*) FILTER (WHERE status = 'confirmed')` over zero matching rows returns `0` (not `NULL` — `COUNT` is defined to return 0 on an empty filtered set). Same result: `0`.
- Mixed rows: `FILTER` scopes the count to exactly the `confirmed` subset regardless of what else is in the group. Identical.

**`revenue_collected`:**
- Same three cases. The only wrinkle: `SUM(...) FILTER (WHERE status = 'confirmed')` over zero matching rows returns `NULL` (unlike `COUNT`, `SUM` returns `NULL` on an empty set, not `0`) — but that `NULL` is exactly what the outer `COALESCE(bc.revenue_collected, 0)` already existed to handle, producing `0` either way. Identical end result in every case.

Both fields are provably, mathematically identical to their current output for every possible combination of booking statuses. Nothing about `revenue_collected`'s meaning changes — it's the same `SUM(price_at_booking)` over `status = 'confirmed'` rows, just re-expressed with `FILTER` so it can sit next to `occupied_count` in a subquery whose *base* population is wider.

---

## 7. Required application-code follow-up (not optional, not a separate PR)

**File:** `src/lib/supabase/queries/events.ts`, function `getEventBySlug` (lines ~294–329, ~358–374).

This is a specification for `backend-developer` — the architect is not editing this file.

**Current:**

```ts
const [statsResult, reviewResult] = await Promise.all([
  supabase
    .from('event_with_stats')
    .select('confirmed_count, total_attending')
    .eq('id', event.id)
    .maybeSingle(),
  ...
])
...
const confirmed = statsResult.data?.confirmed_count ?? 0
const totalAttending = statsResult.data?.total_attending ?? confirmed
...
const spotsLeft = event.capacity == null ? null : Math.max(event.capacity - confirmed, 0)
...
return {
  ...eventFields,
  confirmed_count: confirmed,
  total_attending: totalAttending,
  revenue_collected: null,
  avg_rating: avgRating,
  review_count: reviewCount,
  spots_left: spotsLeft,
  ...
}
```

**Required change:**

```ts
const [statsResult, reviewResult] = await Promise.all([
  supabase
    .from('event_with_stats')
    .select('confirmed_count, occupied_count, total_attending')   // + occupied_count
    .eq('id', event.id)
    .maybeSingle(),
  ...
])
...
const confirmed = statsResult.data?.confirmed_count ?? 0
// Defensive fallback to `confirmed`, same established pattern as
// totalAttending directly below — protects against partial-deploy skew
// if this code ever runs ahead of the migration.
const occupied = statsResult.data?.occupied_count ?? confirmed
const totalAttending = statsResult.data?.total_attending ?? confirmed
...
const spotsLeft = event.capacity == null ? null : Math.max(event.capacity - occupied, 0)   // occupied, not confirmed
...
return {
  ...eventFields,
  confirmed_count: confirmed,
  occupied_count: occupied,        // new — required by the widened EventWithStats type, §12
  total_attending: totalAttending,
  revenue_collected: null,
  avg_rating: avgRating,
  review_count: reviewCount,
  spots_left: spotsLeft,
  ...
}
```

Also update the existing comment block (lines 279–293) that explains why this uses the view instead of a direct `bookings` count — it currently only mentions the RLS-scoping reason; it should also note that `occupied_count`/`spots_left` fold in `pending_payment` to match the booking RPCs' gate.

**Why this is not optional:** without it, the migration alone changes nothing a member actually sees on `/events/[slug]`. `event.spots_left` on that page continues to come from the old, buggy, locally-recomputed value. Every consumer downstream of `getEventBySlug` — `BookingSidebar` (the "Book Now"/"Join Waitlist" button, the "Only N spots left" copy, the sold-out block), `MobileBookingBar`, and `eventJsonLd` (SEO `availability`) — would keep showing the wrong number. This is the page where the reported incident actually bites (a member clicks Book Now believing there's room).

The Server Action–level booking submission itself was never at risk of overselling — `book_event_paid`/`claim_waitlist_spot` already gate correctly with a row lock regardless of what the UI displayed. What this fix (both parts) closes is the **UI's prediction** of what the RPC will do, so a member doesn't get a false "there's room" signal before they've even tried.

Test-file consequence: `src/lib/supabase/queries/__tests__/events.test.ts` already has a precise regression-style test (`'requests total_attending in the stats select'`, pinning the exact select-string contract) — the same pattern needs a sibling assertion for `occupied_count`, and the `'falls back to ... when missing from the view (defensive)'` test needs an `occupied_count`-fallback counterpart. This is `tester`/`backend-developer` work, flagged here so it isn't a surprise.

---

## 8. Call-site audit

Every file that reads `event_with_stats`, `EventWithStats`, `confirmed_count`, `spots_left`, `revenue_collected`, or `total_attending`, and what happens to each once the view + `getEventBySlug` both change:

| File | Reads | Mechanism | Action needed |
|---|---|---|---|
| `src/lib/supabase/queries/events.ts` — `getPublishedEvents`, `getPastEvents`, `getRelatedEvents` | `spots_left`, `confirmed_count` (via `SELECT *`) | Passthrough of the view's own columns | **None.** Automatically corrected. |
| `src/app/(admin)/admin/actions.ts` — `getAdminEvents` | same, via `SELECT *` | Passthrough | **None.** `occupied_count` arrives inertly (unrendered today). |
| `src/lib/supabase/queries/events.ts` — `getEventBySlug` | `confirmed_count`, `total_attending`, locally re-derives `spots_left` | **Independent re-implementation**, bypasses the view's own `spots_left` | **Required change — §7.** This is the critical one. |
| `src/components/events/EventCard.tsx` | `event.spots_left` (`SpotsIndicator`, `isSoldOut`) | Direct passthrough prop | None — auto-fixed once the row it receives has the corrected `spots_left` (true for every caller: `EventsPageClient`, `UpcomingEventsSection`, `EventDetailClient`'s related-events grid). |
| `src/components/events/EventsPageClient.tsx` | none (filters/splits only) | — | None. |
| `src/components/landing/UpcomingEventsSection.tsx` | none (renders `EventCard`) | — | None. |
| `src/components/events/BookingSidebar.tsx` | `event.spots_left` (`isSoldOut`, `CapacitySection` numeric copy + sold-out block), `event.total_attending` (headline + progress-bar fill %) | Reads whatever `EventDetail` it's given | `spots_left`-driven copy and the Book/Waitlist CTA are auto-fixed once `getEventBySlug` (§7) ships. The progress-bar **fill percentage** still derives from `total_attending / (capacity + external_attendees)`, which does *not* fold in `pending_payment` — see the cosmetic follow-up noted in §15. Not blocking; the numeric "Only N spots left" text directly above the bar is correct. |
| `src/components/events/MobileBookingBar.tsx` | `spotsLeft` prop | Passthrough from `EventDetailClient` | None — auto-fixed via §7. |
| `src/components/events/EventDetailClient.tsx` | `event.spots_left` (`isSoldOut`, resume-booking effect gate), `event.total_attending` (Attendees quick-info panel) | Reads the `EventDetail` from `getEventBySlug` | None — auto-fixed via §7. |
| `src/lib/seo/event.ts` — `eventJsonLd` | `event.spots_left`, `event.capacity` (schema.org `availability`) | Reads the `EventDetail` from `getEventBySlug` | None — auto-fixed via §7. Correctly benefits: Google will stop being told "InStock" for an event that would actually waitlist a real booking attempt. |
| `src/components/admin/EventsTable.tsx` | `event.confirmed_count` ("Booked" column), `event.revenue_collected` ("Revenue" column) | `SELECT *` passthrough | **None — verified must NOT change.** See §4/§6. |
| `src/components/admin/CancelEventModal.tsx` | none directly — consumes a separate `getEventCancelPreview` result, not the view | — | None. |
| `src/app/(admin)/admin/actions.ts` — `promoteFromWaitlist` (free-event branch) | Its own direct `bookings` query, `status IN ('confirmed','pending_payment')` | Does not read `event_with_stats` at all | None — already correct, already matches the widened definition, untouched by this migration. |
| `src/app/(admin)/admin/events/[id]/page.tsx`, `.../bookings/page.tsx` | Neither reads stats fields (edit form / attendee list only) | — | None. |
| Test fixtures (9 files, ~28 occurrences of `confirmed_count:`) | Build `EventWithStats`/`EventDetail`-shaped literals | TS interface gains a new required field | See §12 — mechanical, flagged as blast radius, not a design risk. |
| `e2e/*.spec.ts` | Checked — none assert on `spots_left`/`confirmed_count` directly | — | None. |
| Any other DB object (function/view) | Checked — none reference `event_with_stats` | — | None; `DROP VIEW` has no dependency to fail on. |

---

## 9. The side-effect judgment: widened predicate vs. today's bug

You asked me to judge, not just describe. Here's the comparison, with the receipts:

**The new cost (widening's downside):** a *genuinely-abandoned checkout* — a member who starts paying and gives up — makes the event look one seat more sold-out than reality until `reap_stale_pending_bookings()` cancels the row. That function's predicate is `created_at < now() - interval '35 minutes'`, and the pg_cron schedule ticks every 15 minutes, so the worst-case window from "checkout abandoned" to "seat visibly reopens" is roughly **35–50 minutes**. This is a *normal, self-healing, industry-standard* characteristic of any reservation-hold system — it's how a Ticketmaster/Eventbrite cart-hold behaves too.

**The status-quo bug (what's live right now):** I confirmed, by reading the code rather than assuming, that today's specific incident — Amy Sangam's and Yasemin Salp's bookings, held via `admin_hold_confirmed_booking_for_payment` — is **not** covered by the 35-minute reaper at all:

- `reap_stale_pending_bookings()` (as of migration `20260713000002`) has an explicit `AND is_admin_hold = false` predicate — admin holds are deliberately excluded, because they're meant to get "an admin-communicated payment window, not the standard 35-minute abandoned-checkout timeout."
- `sendPaymentLinkForConfirmedBooking` (the exact Server Action used for this remediation) hardcodes `holdExpiresAt: null` — confirmed by reading `src/app/(admin)/admin/actions.ts` lines 1871–1875 and cross-checked against `SYSTEM-DESIGN-admin-waitlist-promotion-payment.md` Addendum §A.3, which documents this as a known, deliberate deferral (the auto-revert cron, `revert_expired_admin_holds`, "still doesn't exist and isn't being built now").

So, absent this fix, the two remediated bookings will overstate the event's availability **indefinitely** — until Amy/Yasemin pay, or an admin manually runs `admin_revert_hold_to_waitlist` (Gap B) — not for 35 minutes. That's not a bounded, self-healing cost; it's an open-ended one, and it's live on an event happening tomorrow.

**Verdict:** widen it. The two failure modes are not symmetric in severity:
- Widening's failure mode is *conservative*: worst case, a member sees "waitlist" messaging when a technical spot exists, for under an hour, self-correcting with no human involved. Mild friction, before the member has committed to anything.
- The status quo's failure mode is *unsafe*: a member is told "come on in," commits to the booking flow, and gets bounced to the waitlist *after* forming an expectation — a materially worse point in the funnel to disappoint someone, and with no natural expiry today.

A ~35–50 minute window of "looks slightly more full than reality" for abandoned checkouts is a clearly acceptable, in fact standard, cost for permanently closing an unbounded, already-live "looks more available than reality" bug. Ship it.

---

## 10. RLS / grants

**No changes needed.** Evidence, not assumption:

- `public.events` itself (the view's base table) has RLS enabled with row policies but **no explicit `GRANT SELECT` statement anywhere in `supabase/migrations/`** — confirmed by reading `20260402000003_create_events.sql` in full. It has served anon reads correctly since Batch 1 regardless.
- `event_with_stats` has never had an explicit `GRANT` statement in any of its five prior migrations (`20260402000011`, `20260505205025`, `20260506000001`, `20260507000001`, `20260507000002`) — confirmed by grep across every migration mentioning the view. Three of those five already DROP+CREATE the exact same view, and it kept working for anon/authenticated after each.
- This is consistent with a schema-level default-privilege grant (`anon`, `authenticated` get baseline `SELECT` on new `public` schema objects) applied by the Supabase platform at project bootstrap, not by any migration in this repo. New objects — including a freshly `DROP`+`CREATE`d view of the same name — pick this up automatically; there is nothing to re-declare.
- Row-level visibility (published-only for anon, drafts visible to admins) comes from `public.events`' own RLS policy, which this migration does not touch. Only the internal aggregate formula inside the view changes.
- The aggregate itself was already crossing the per-row RLS boundary deliberately — the existing comment in `events.ts` (lines 279–292) documents that the view computes `COUNT(*)` "with definer privileges, so the aggregate sees ALL confirmed bookings; only that single number leaves the view, individual booking rows remain RLS-protected." Widening *which statuses* feed that same, already-reviewed, already-trusted aggregate doesn't change the privacy boundary — it's still a scalar count, never raw booking rows (no `user_id`, no email, nothing PII), regardless of how many statuses it spans.

---

## 11. Anon-visibility decision for the new column

CLAUDE.md's rule ("New column on `public.profiles`? Make an explicit anon-visibility decision... Omit from the anon GRANT unless...") is **textually scoped to `public.profiles` columns**. `event_with_stats` is a view over `events`/`bookings`/`event_reviews`, not `profiles` — the rule doesn't literally apply here, and there's no equivalent "secure by default, allow-list only" posture documented for this view (its sibling columns `confirmed_count`/`spots_left`/`revenue_collected` are all already publicly exposed).

Running the equivalent analysis anyway, since the *spirit* of the rule is good practice: `occupied_count` is a scalar `COUNT`, the same privacy class as the already-public `confirmed_count`/`spots_left`. It discloses "how many seats are technically held right now, paid or not" — not a new category of sensitive information; anon can already see `events.capacity` and derive a close approximation from the (currently buggy) `spots_left`. No PII, no financial detail beyond what `revenue_collected` (also already public to whoever can already read the view) exposes. Safe to expose at the same level as its siblings — no separate allow-list mechanism needed or precedented for this view.

---

## 12. TypeScript type change + test blast radius

**File:** `src/types/index.ts`, `EventWithStats` interface. Add, next to `confirmed_count`:

```ts
export interface EventWithStats extends Event {
  confirmed_count:   number
  /**
   * confirmed + pending_payment. The "is there room" number — spots_left
   * is capacity - occupied_count. NOT the same as confirmed_count (which
   * stays paid/confirmed-only for the admin Booked/Revenue columns) and
   * NOT the same as total_attending (confirmed + external_attendees, a
   * "who's actually coming" social-proof number). Added by migration
   * 20260713000005 (spots-left-display-fix).
   */
  occupied_count:    number
  total_attending:   number
  revenue_collected: number | null
  avg_rating:        number
  review_count:      number
  spots_left:        number | null
  primary_tag:       PrimaryTag
}
```

Because `EventDetail extends EventWithStats`, this makes `occupied_count` a **required** field on every object that claims to be an `EventWithStats` or `EventDetail` — including test fixtures. This is not purely additive from a compile-time perspective.

**Blast radius, sized precisely:** 9 test files, ~28 literal `confirmed_count:` occurrences, most concentrated in a handful of `makeEvent`/`makeEventDetail` factory functions per file (not 28 independent manual edits):

```
src/app/(admin)/admin/__tests__/actions-get-events.test.ts
src/components/admin/__tests__/EventsTable.test.tsx
src/components/events/__tests__/BookingModal.test.tsx
src/components/events/__tests__/BookingSidebar.test.tsx
src/components/events/__tests__/EventCard.test.tsx
src/components/events/__tests__/EventDetailClient.test.tsx
src/components/events/__tests__/EventsPageClient.test.tsx
src/lib/seo/__tests__/event.test.ts
src/lib/supabase/queries/__tests__/events.test.ts
```

Each factory needs a sensible default added (e.g. `occupied_count: confirmed_count` unless a test specifically wants to exercise the divergent case — mirrors how `total_attending`/`external_attendees` were threaded through these same factories previously, per their existing fixture entries). This is mechanical, low-risk, one-time work — flagged here so `tester`/`backend-developer` isn't surprised by a wide `pnpm tsc --noEmit` failure list, not because it changes the design.

**Alternative considered and rejected:** making `occupied_count` optional (`occupied_count?: number`) to avoid the fixture churn. Rejected — it would leave `spots_left`'s backing data undocumented as a type-level contract, inconsistent with how every sibling field on this interface is required, and it doesn't actually reduce real work (whoever wires up `getEventBySlug` still needs to populate it correctly; an optional type just lets other call sites forget to).

---

## 13. Deployment sequencing, risk, rollback

**Sequencing (both required, same deploy):**
1. Migration `20260713000005` (§5).
2. `getEventBySlug` change (§7) + `EventWithStats.occupied_count` type addition (§12) + test fixture updates.
3. `supabase db push --include-all --linked` — **manual step, does not happen automatically on merge** (per existing project memory). For a same-day incident fix, confirm this step actually ran before considering the fix live — a merged PR alone does not reach production.

**Risk:**
- SQL correctness: low. Proven equivalent for the two untouched fields (§6); the new/changed fields (`occupied_count`, `spots_left`) are a straightforward, well-precedented predicate widening matching four other RPCs already doing exactly this.
- Deployment-sequencing risk is the real one: shipping the migration without the `getEventBySlug` change produces a **false sense of having fixed the incident** — the admin dashboard and events-listing page would look correct, but the actual event detail page (where the reported risk lives) would not change at all. Flag this explicitly to whoever verifies the fix today: check `/events/<the-affected-event-slug>` itself, not just the listing page.
- No data mutation risk — this is a read-model (view) change only; no `UPDATE`/`DELETE` on any table.

**Rollback:** `DROP VIEW public.event_with_stats;` then recreate verbatim from `20260507000002`'s `CREATE VIEW` body (reproduced in this doc's blockquote history / git history of that migration file). Reverting the `getEventBySlug` change is a plain code revert. Neither direction loses data.

---

## 14. Explicitly out of scope

Per your constraints, none of the following are touched by this fix, and none of them should be inferred as implicitly included:

- `book_event_paid()`, `claim_waitlist_spot()`, `admin_promote_waitlist_to_hold()`, `admin_hold_confirmed_booking_for_payment()` — already correct, untouched.
- `revenue_collected`'s semantics — proven unchanged, not just left alone (§6).
- `reap_stale_pending_bookings()` cadence (currently 35 min / 15-min pg_cron tick) — not adjusted, despite being discussed as context for §9's judgment.
- `external_attendees` / the "platform-only vs. inflated-with-partners" axis of `spots_left` — that's a separate, deliberate, already-documented design decision (`20260505205025`'s "spots_left also stays platform-only... deliberate") and is orthogonal to the confirmed/pending_payment axis this fix addresses. Not revisited.
- The still-missing `revert_expired_admin_holds` cron (migration slot `...000003`, reserved, not built) — referenced only as supporting evidence for §9's judgment, not built or scheduled here.

---

## 15. Open questions / recommended fast-follows

None of these block today's fix. Flagging rather than guessing silently, as instructed.

1. **`total_attending` is currently absent from `event_with_stats` entirely — a separate, pre-existing regression, not introduced by this fix.** Trace: migration `20260505205025` added it; migration `20260506000001` ("F1b-schema") recreated the view "verbatim from Migration 011" while dropping the `events.category` column, and in doing so silently reverted the view to its *pre*-`total_attending` shape; `20260507000002` (revenue) recreated the view again without restoring it. The application layer already has a defensive fallback for this (`statsResult.data?.total_attending ?? confirmed`, in `getEventBySlug`, with an explicit test: `'falls back to confirmed_count when total_attending is missing from the view (defensive)'`) — so nothing is currently crashing, but every event with `external_attendees > 0` is silently under-reporting its "X people going" headline in production right now, and the fallback is firing on every request, not just as a safety net. **Recommendation:** a small, separate follow-up migration restoring `total_attending = confirmed_count + external_attendees` to the view (still NOT widened to include `pending_payment` — see §3's reasoning). This is a real, live, distinct bug; I'm flagging it, not fixing it here, per your explicit "keep the design as small as correctly fixes the [spots-left] bug" constraint.

2. **`BookingSidebar`'s capacity progress-bar fill % will be cosmetically inconsistent with the (now-correct) numeric "Only N spots left" copy directly above it**, whenever a `pending_payment` row exists. The bar's width is `total_attending / (capacity + external_attendees)` — unaffected by this fix, since `total_attending` isn't touched. Once `getEventBySlug` ships (§7), the numeric copy and the Book/Waitlist CTA will correctly reflect `pending_payment` holds, but the bar's fill will still look slightly less full than the copy claims. This is purely decorative (no incorrect gating, no false availability promise — the actionable CTA is already correct), so it's not blocking. **Recommendation:** once `occupied_count` and (separately) `total_attending` both exist on the view, switch the bar's numerator to `occupied_count + external_attendees` in a small frontend follow-up.

3. **Field naming:** I named the new column `occupied_count`, chosen because the codebase's own existing comment in `book_event_paid_with_fee`'s migration already uses this exact word ("both 'confirmed' AND 'pending_payment' count as occupied"). Cheap to rename before merge if you'd prefer `held_count`/`reserved_count`/something else — flagging as a naming choice, not a load-bearing decision.

4. **Whether to expose `occupied_count` as a top-level view column at all**, vs. computing it only inside the `bc` subquery and referencing it solely within `spots_left`'s `CASE` expression (never surfacing it in the outer `SELECT` list). I chose to expose it (§4, §5) for debuggability — direct queryability during exactly the kind of incident that prompted this fix — and because hiding a load-bearing intermediate value specifically to dodge test-fixture churn is a false economy. If you'd rather minimize the `EventWithStats` type's surface area and accept the reduced debuggability, that's a legitimate alternative; happy to redo §5/§12 that way if you prefer it.

---

## HANDOVER

- **Agent:** architect
- **Task:** Design the fix for the public "spots left" bug (`event_with_stats` undercounts occupied seats vs. the real booking-gate RPCs) — live production incident, 2026-07-13.
- **Files changed:** `SYSTEM-DESIGN-spots-left-display-fix.md` (created), `SYSTEM-DESIGN.md` (added ADR-16 cross-reference).
- **Migrations planned:** `supabase/migrations/20260713000005_widen_spots_left_to_include_pending_payment.sql` — full SQL specified in §5, not yet created.
- **Tests added:** none (architect doesn't write tests). Flagged required test updates: `occupied_count` select-string + fallback regression tests in `events.test.ts` (mirroring the existing `total_attending` pair), plus fixture-factory updates across the 9 files listed in §12.
- **Next agent:** `backend-developer` — to (1) create and apply the migration in §5, (2) make the **required** `getEventBySlug` change in §7 (this is not optional — the migration alone does not fix the reported incident on the event detail page), (3) add `occupied_count` to the `EventWithStats` type per §12, (4) update the 9 test-fixture files. Then `tester` for the new/updated regression tests named in §7/§12.
- **Risks / open questions:**
  - **Deployment-sequencing risk is the main one** (§13): shipping the migration without the `getEventBySlug` code change gives a false sense of having fixed the incident — verify the actual affected event's detail page, not just the listing page, before declaring this closed.
  - Manual `supabase db push --include-all --linked` required post-merge — CI does not do this (existing project pattern).
  - Three non-blocking fast-follows flagged in §15 (`total_attending`'s separate pre-existing regression, the progress-bar cosmetic follow-up, and two naming/design bikesheds) — none block today's fix, all are cheap to defer.
  - HANDOFF NEEDED for anything beyond the spec above: implementing the migration file, the `getEventBySlug` diff, the type change, and the test updates are all `backend-developer` work; I have not written or modified any source file.
