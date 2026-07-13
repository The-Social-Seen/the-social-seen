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
