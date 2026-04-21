-- Migration: notification_retry_and_dedupe (P2-5)
--
-- The P2-5 daily edge function sends venue-reveal, reminder (2-day / day-of),
-- and review-request emails to confirmed attendees. Two concerns this migration
-- addresses:
--
--   1. Idempotency — cron runs are not guaranteed to run exactly once (manual
--      invocation, retries, etc.). We must never send the same reminder twice
--      to the same user for the same event on the same day. A `dedupe_key`
--      column with a partial UNIQUE index gives us cheap per-(event,user,day)
--      uniqueness enforced at the DB layer: the INSERT fails with 23505 and
--      the function swallows it as "already sent".
--
--   2. Retry of prior failures — when Resend returns a transient 5xx the
--      send wrapper already retries once inline; but persistent failures
--      (provider outage, invalid recipient after auth changes, etc.) should
--      be retried on the next daily run. `retried_at timestamptz` lets the
--      edge function pick rows that haven't been retried too recently and
--      avoid hot-looping.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, CREATE UNIQUE INDEX IF NOT EXISTS.

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS dedupe_key text,
  ADD COLUMN IF NOT EXISTS retried_at timestamptz;

-- Partial UNIQUE index — only rows with a dedupe_key compete. Existing
-- admin in-app announcements have dedupe_key = NULL and are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS ux_notifications_dedupe_key
  ON public.notifications (dedupe_key)
  WHERE dedupe_key IS NOT NULL;

-- Composite index supporting the retry-selection query:
--   SELECT ... WHERE channel = 'email' AND status = 'failed'
--     AND (retried_at IS NULL OR retried_at < now() - interval '12 hours')
--     AND created_at > now() - interval '3 days'
CREATE INDEX IF NOT EXISTS idx_notifications_retry_candidates
  ON public.notifications (channel, status, retried_at, created_at)
  WHERE channel = 'email' AND status = 'failed';
