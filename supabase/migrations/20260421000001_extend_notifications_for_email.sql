-- Migration: extend_notifications_for_email
--
-- Extends the existing public.notifications table (originally designed for
-- admin in-app announcements) to also serve as the audit log for
-- transactional emails sent via Resend (P2-4).
--
-- New columns:
--   channel             — 'in_app' | 'email' | 'sms' (default 'in_app' for
--                         backwards compat with existing rows)
--   recipient_email     — actual SMTP recipient (post-sandbox-redirect)
--   provider_message_id — Resend's message id, populated on success
--   status              — 'sent' | 'failed' | 'pending'
--   error_message       — failure reason (NULL on success)
--   template_name       — 'welcome' | 'booking_confirmation' | etc.
--
-- The send wrapper (src/lib/email/send.ts) inserts via the admin client
-- because the existing RLS policies are admin-only — system-level email
-- sends shouldn't require an authenticated user context (e.g. cron-driven
-- venue-reveal emails in P2-5 will have no requesting user).
--
-- `sent_by` is made nullable so system emails can omit it. Existing rows
-- already have NOT NULL values so this is a permissive change — no data
-- loss risk.
--
-- Idempotent: ALTER ... ADD COLUMN IF NOT EXISTS, ALTER ... DROP NOT NULL
-- (no-op if already nullable), CREATE INDEX IF NOT EXISTS.

-- ── Make sent_by nullable for system emails ─────────────────────────────────
ALTER TABLE public.notifications
  ALTER COLUMN sent_by DROP NOT NULL;

-- ── Add new columns ─────────────────────────────────────────────────────────
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS channel             text NOT NULL DEFAULT 'in_app',
  ADD COLUMN IF NOT EXISTS recipient_email     text,
  ADD COLUMN IF NOT EXISTS provider_message_id text,
  ADD COLUMN IF NOT EXISTS status              text NOT NULL DEFAULT 'sent',
  ADD COLUMN IF NOT EXISTS error_message       text,
  ADD COLUMN IF NOT EXISTS template_name       text;

-- ── CHECK constraints for the new enum-like text columns ────────────────────
-- Using text + CHECK rather than a Postgres enum because:
--   1. Adding new channels later (push, whatsapp) doesn't require an enum
--      ALTER (which can be awkward in transactions);
--   2. The set of values is small enough that a CHECK is readable.
DO $$ BEGIN
  ALTER TABLE public.notifications
    ADD CONSTRAINT chk_notifications_channel
    CHECK (channel IN ('in_app', 'email', 'sms'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.notifications
    ADD CONSTRAINT chk_notifications_status
    CHECK (status IN ('sent', 'failed', 'pending'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Index for the future admin failed-notification view ─────────────────────
-- Composite index supports queries like
--   SELECT * FROM notifications
--   WHERE channel = 'email' AND status = 'failed'
--   ORDER BY sent_at DESC
CREATE INDEX IF NOT EXISTS idx_notifications_channel_status_sent_at
  ON public.notifications (channel, status, sent_at DESC);

-- ── RLS policies ────────────────────────────────────────────────────────────
-- The existing admin-only SELECT/INSERT/UPDATE policies (from migration 010)
-- still apply. The send wrapper uses the admin client (service_role) which
-- bypasses RLS — appropriate for system-level audit inserts. Members never
-- need to read these rows directly; the future admin retry view will read
-- them under the existing admin SELECT policy.
--
-- No policy changes here. Confirmed:
--   - notifications_select : admin-only ✓
--   - notifications_insert : admin-only ✓ (system inserts via admin client)
--   - notifications_update : admin-only ✓
