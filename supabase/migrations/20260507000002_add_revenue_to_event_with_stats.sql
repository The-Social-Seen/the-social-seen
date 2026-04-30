-- Migration: add revenue_collected to event_with_stats
--
-- Purpose
-- ───────
-- Admin events listing needs a per-event "amount collected" figure. The
-- accurate source of truth is SUM(bookings.price_at_booking) for confirmed
-- bookings, snapshotted at purchase time by book_event_paid() and persisted
-- when the Stripe webhook flips the booking from pending_payment → confirmed.
-- Computing it client-side as `confirmed_count × events.price` is wrong if
-- the event price changes after some bookings were taken; this migration
-- exposes the correct aggregate alongside confirmed_count / avg_rating /
-- review_count.
--
-- Shape change
-- ────────────
-- Adds one column to the existing event_with_stats view:
--   revenue_collected  bigint  -- sum of price_at_booking in pence
--                              -- (zero-coalesced when no confirmed bookings)
--
-- Anon visibility
-- ───────────────
-- The view inherits RLS from underlying tables. revenue_collected is a
-- pure aggregate of bookings.price_at_booking for confirmed rows. Because
-- confirmed_count and events.price are already publicly readable for
-- published events, the revenue figure is already derivable from public
-- data (modulo price drift). No new privacy exposure. We do not narrow
-- access; admin pages are the only documented consumer.
--
-- Why DROP + CREATE (not CREATE OR REPLACE)
-- ─────────────────────────────────────────
-- Postgres CREATE OR REPLACE VIEW requires the new column list to begin
-- with the existing columns in the same order — additional columns may
-- only be appended at the end. We want revenue_collected to sit next to
-- confirmed_count (its sibling aggregate from the same bookings subquery),
-- not at the end after spots_left, so we use the DROP IF EXISTS + CREATE
-- VIEW pattern already established by migration
-- 20260506000001_drop_events_category_and_triggers.sql.
--
-- Idempotency
-- ───────────
-- The DROP uses IF EXISTS, and the matching CREATE follows immediately.
-- Re-running this migration after a successful apply is a no-op-ish
-- recreate for the view (CREATE VIEW errors if the view exists, but we
-- DROP IF EXISTS just before, so the pair is idempotent under replay).

DROP VIEW IF EXISTS public.event_with_stats;

CREATE VIEW public.event_with_stats AS
SELECT
  e.*,
  COALESCE(bc.confirmed_count, 0)     AS confirmed_count,
  COALESCE(bc.revenue_collected, 0)   AS revenue_collected,
  COALESCE(rc.avg_rating, 0)          AS avg_rating,
  COALESCE(rc.review_count, 0)        AS review_count,
  CASE
    WHEN e.capacity IS NULL THEN NULL
    ELSE GREATEST(e.capacity - COALESCE(bc.confirmed_count, 0), 0)
  END AS spots_left
FROM public.events e
LEFT JOIN (
  SELECT
    event_id,
    COUNT(*)                          AS confirmed_count,
    SUM(price_at_booking)::bigint     AS revenue_collected
  FROM public.bookings
  WHERE status = 'confirmed' AND deleted_at IS NULL
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

-- Verify: SELECT id, confirmed_count, revenue_collected FROM public.event_with_stats WHERE confirmed_count > 0 LIMIT 5;
