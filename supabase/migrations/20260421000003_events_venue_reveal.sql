-- Migration: events_venue_reveal (P2-5)
--
-- Adds two columns to public.events supporting the "venue reveal" feature:
--
--   venue_revealed  boolean NOT NULL DEFAULT true
--     Default is TRUE so that existing events created before this batch
--     retain their current "venue visible" behaviour. The admin UI defaults
--     new events to FALSE if the admin ticks "Hide venue until 1 week
--     before" in the event form. The daily edge function flips this to
--     TRUE once date_time - now() <= 7 days.
--
--   postcode        text NULL
--     UK postcode used to build the Google Maps link. Nullable — legacy
--     events have no postcode; the UI falls back to a maps search on the
--     full venue_address string when absent.
--
-- No RLS changes — the existing events policies (SELECT public for
-- published events, INSERT/UPDATE admin-only) already cover these columns.
--
-- No column-level GRANT changes — events does not use the "secure by
-- default" column-grant model that profiles uses. All columns are readable
-- by the anon role for published rows.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS.

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS venue_revealed boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS postcode       text;

COMMENT ON COLUMN public.events.venue_revealed IS
  'If false, venue_name + venue_address are hidden from the public event page until 1 week before date_time. The daily scheduled job flips this to true and sends a venue-reveal email to confirmed attendees.';
COMMENT ON COLUMN public.events.postcode IS
  'UK postcode (e.g. "SE1 9BU"). Used to build the Google Maps link on the event page and in the venue-reveal email. Nullable — venue_address alone is sufficient for a maps search fallback.';
