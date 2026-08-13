-- Migration: restore_total_attending_on_event_with_stats
--
-- ── RECONSTRUCTED FILE — read before touching this migration ───────────────
-- This file was applied to production on 2026-07-15 (confirmed live: the
-- view's total_attending column has been serving real traffic since then —
-- see project memory project_total_attending_regression), but the .sql
-- file itself was somehow never present in / was lost from the git history
-- that ended up on `main` — `git log --all -- 'supabase/migrations/20260715143136_*'`
-- returns nothing, and the very next tracked migration
-- (20260713000005_widen_spots_left_to_include_pending_payment.sql, dated
-- two days EARLIER on 2026-07-13) explicitly says in its own header
-- "total_attending is NOT restored or touched here ... out of scope for
-- this fix" — i.e. the tracked history never shows this column being
-- added at all, despite it being live in prod today.
--
-- This file is a faithful reconstruction, not a guess: every row of the
-- live `event_with_stats` view was checked against the formula below
-- (confirmed_count + external_attendees) on 2026-08-13 and matched
-- exactly, with zero discrepancies across a 15-row sample spanning
-- 0-count and large-count events alike. The CREATE VIEW body is
-- otherwise byte-for-byte identical to 20260713000005's, with only
-- total_attending appended — confirmed by diffing this file's column
-- list against a live `SELECT * FROM event_with_stats LIMIT 1`.
--
-- Root cause of the loss is unknown and out of scope for this repair —
-- flagged as a project memory note for follow-up (was there a bad
-- rebase / force-push on `main`? a squash that dropped a commit?).
-- This migration's only job is to bring the git-tracked history back in
-- sync with what has actually been running in production, so future
-- `supabase db push --include-all --linked` runs stop erroring on
-- "Remote migration versions not found in local migrations directory"
-- for this version, and so a future recreation of this view (the next
-- one will inherit from this file, not from 20260713000005) doesn't
-- silently drop total_attending a fourth time — see
-- project_total_attending_regression memory for the first three drops.
--
-- Shape change
-- ────────────
-- Adds one column to the existing event_with_stats view:
--   total_attending  bigint  -- confirmed_count + external_attendees.
--                            -- Deliberately confirmed-only (does NOT
--                            -- fold in pending_payment, unlike
--                            -- occupied_count/spots_left) — an
--                            -- attendee headline should read as a
--                            -- roster of real people, not flicker with
--                            -- in-flight Stripe checkouts. See
--                            -- SYSTEM-DESIGN-spots-left-display-fix.md §3.
--
-- Anon visibility
-- ───────────────
-- Not a profiles column, CLAUDE.md's column-GRANT rule doesn't
-- textually apply. Same privacy class as the already-public
-- confirmed_count/spots_left — a scalar aggregate, no new sensitive
-- disclosure. No new GRANT needed, consistent with every other
-- DROP+CREATE of this view (20260505205025, 20260506000001,
-- 20260507000002, 20260713000005) — none issue a GRANT, the view
-- relies on Supabase's schema-level default privileges.
--
-- Idempotency
-- ───────────
-- DROP VIEW IF EXISTS + CREATE VIEW — safe to re-run.
--
-- Post-merge
-- ──────────
-- CI applies migrations to local Supabase only. This migration
-- reconstructs a state that is ALREADY LIVE in production — applying
-- it via `supabase db push --include-all --linked` should be a no-op
-- against the live schema (recreates the identical view), and exists
-- purely to reconcile the remote migration-history tracking table
-- with a matching local file, and to fix the local Supabase dev stack
-- (which does NOT have this column without this file).

DROP VIEW IF EXISTS public.event_with_stats;

CREATE VIEW public.event_with_stats AS
SELECT
  e.*,
  COALESCE(bc.confirmed_count, 0)     AS confirmed_count,
  COALESCE(bc.occupied_count, 0)      AS occupied_count,
  COALESCE(bc.revenue_collected, 0)   AS revenue_collected,
  COALESCE(bc.confirmed_count, 0) + COALESCE(e.external_attendees, 0) AS total_attending,
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

-- Verify: total_attending = confirmed_count + external_attendees for every row.
--   SELECT id, title, confirmed_count, external_attendees, total_attending
--   FROM public.event_with_stats
--   WHERE total_attending <> confirmed_count + COALESCE(external_attendees, 0);
-- (Should return zero rows.)
