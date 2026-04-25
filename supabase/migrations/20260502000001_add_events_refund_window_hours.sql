-- Migration: add_events_refund_window_hours
--
-- Adds `events.refund_window_hours` so each event can carry its own
-- cancellation-refund policy. Replaces a hardcoded 48-hour constant in
-- the cancelBooking Server Action.
--
-- Semantics:
--   - 48  → default. Refund issued if user cancels >48h before start.
--   - 72, 168, etc. → custom longer windows (3 days, 7 days, …).
--   - 0   → non-refundable. Used as the sentinel for "no refunds ever".
--
-- The CHECK enforces non-negative values; the application layer treats
-- `refund_window_hours = 0` as "never refund" and any positive integer
-- as "refund if hoursUntilEvent > refund_window_hours".
--
-- Anon visibility: this column IS exposed via the events SELECT grant.
-- Refund policy is part of the public booking experience — the cancel
-- modal needs to show "non-refundable" before a user even commits to
-- buying. No PII, no internal-only data.

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS refund_window_hours integer NOT NULL DEFAULT 48;

ALTER TABLE public.events
  ADD CONSTRAINT chk_events_refund_window_non_negative
  CHECK (refund_window_hours >= 0);

COMMENT ON COLUMN public.events.refund_window_hours IS
  'Hours before event start within which cancellations are refunded. 0 = non-refundable; 48 = default; any positive integer for a custom window.';
