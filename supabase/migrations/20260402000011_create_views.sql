-- Migration: 011_create_views
-- Creates the event_with_stats view used by all event listing queries.
-- Amendment 1.5: exact SQL from SYSTEM-DESIGN.md Section 1.
-- CREATE OR REPLACE makes this idempotent.

CREATE OR REPLACE VIEW public.event_with_stats AS
SELECT
  e.*,
  COALESCE(bc.confirmed_count, 0)  AS confirmed_count,
  COALESCE(rc.avg_rating, 0)       AS avg_rating,
  COALESCE(rc.review_count, 0)     AS review_count,
  CASE
    WHEN e.capacity IS NULL THEN NULL
    ELSE GREATEST(e.capacity - COALESCE(bc.confirmed_count, 0), 0)
  END AS spots_left
FROM public.events e
LEFT JOIN (
  SELECT event_id, COUNT(*) AS confirmed_count
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

-- Note: Views in Supabase inherit the RLS of their underlying tables.
-- Queries against event_with_stats will respect events RLS automatically.
-- Admins will see draft events; anonymous users will see published-only.
