-- Migration: add events.external_attendees + total_attending on event_with_stats
--
-- Purpose
-- ───────
-- Admins running events with partner organisations need to record off-platform
-- attendees so the public event card's "X people going" reflects the true
-- total. The platform sells N tickets via the booking flow; the partnership
-- brings M extra people who don't book through us.
--
-- Design decision (keep this small)
-- ─────────────────────────────────
-- external_attendees is PURELY ADDITIVE to the public-facing "going" display.
-- It does NOT consume capacity. The booking RPCs (book_event, book_event_paid,
-- claim_waitlist_spot) continue to gate purely on platform confirmed_count vs
-- capacity. spots_left also stays platform-only — when platform bookings hit
-- capacity, new bookings waitlist as today.
--
-- Admin discipline: if a partnership takes over part of the event, the admin
-- manually lowers `capacity` to the platform allowance they want to sell
-- (could be 0). The system intentionally does NOT enforce
-- external_attendees <= capacity — that constraint would block legitimate
-- "intentional oversell" setups and doesn't add real safety (admins can
-- lower capacity to invalidate it after the fact anyway).
--
-- Shape change
-- ────────────
-- 1. ALTER TABLE public.events ADD COLUMN external_attendees integer NOT NULL
--    DEFAULT 0 CHECK (external_attendees >= 0).
-- 2. Update event_with_stats to expose `total_attending` =
--    confirmed_count + external_attendees, sitting next to confirmed_count.
--    confirmed_count and spots_left are unchanged (preserves audit/admin
--    semantics — admin EventsTable continues to read confirmed_count for
--    a platform-only view; public callsites switch to total_attending in
--    a follow-up frontend change).
--
-- Anon visibility
-- ───────────────
-- The events table's existing GRANTs cover the new column — anon will read
-- external_attendees and total_attending automatically. This is deliberate:
-- partnership headcount isn't sensitive intel, and the simpler model avoids
-- column-level GRANT plumbing. If a future partner explicitly objects to
-- their headcount being visible, restrict at that point.
--
-- Why DROP + CREATE (not CREATE OR REPLACE)
-- ─────────────────────────────────────────
-- Postgres CREATE OR REPLACE VIEW requires new columns to be appended at the
-- end. We want total_attending to sit next to confirmed_count (its sibling
-- aggregate) rather than after spots_left, so we follow the DROP IF EXISTS
-- + CREATE pattern established by 20260507000002_add_revenue_to_event_with_stats.
--
-- Idempotency
-- ───────────
-- ADD COLUMN IF NOT EXISTS on the table; DROP VIEW IF EXISTS + CREATE on
-- the view. Safe to replay.

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS external_attendees integer NOT NULL DEFAULT 0
    CHECK (external_attendees >= 0);

COMMENT ON COLUMN public.events.external_attendees IS
  'Off-platform partnership attendees. Additive to the public-facing "going" display via event_with_stats.total_attending. Does NOT consume capacity — booking RPCs gate on platform confirmed_count only.';

DROP VIEW IF EXISTS public.event_with_stats;

CREATE VIEW public.event_with_stats AS
SELECT
  e.*,
  COALESCE(bc.confirmed_count, 0)                          AS confirmed_count,
  COALESCE(bc.confirmed_count, 0) + e.external_attendees   AS total_attending,
  COALESCE(bc.revenue_collected, 0)                        AS revenue_collected,
  COALESCE(rc.avg_rating, 0)                               AS avg_rating,
  COALESCE(rc.review_count, 0)                             AS review_count,
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

-- Verify:
--   SELECT id, confirmed_count, external_attendees, total_attending, spots_left
--   FROM public.event_with_stats LIMIT 5;
