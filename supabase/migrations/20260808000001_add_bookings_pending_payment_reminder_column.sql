-- Migration: add_bookings_pending_payment_reminder_column
--
-- Adds the "have we reminded this pending_payment booking to complete
-- checkout" gate. See SYSTEM-DESIGN-pending-payment-visibility.md §2.
--
-- Shape follows profiles.profile_nudge_email_sent_at (single nullable
-- timestamptz used as both the send-once gate and the audit timestamp) —
-- NOT the bookings.is_admin_hold / admin_hold_expires_at shape, because
-- unlike that pair this is one fact, not two independent ones.
--
-- Deliberately NOT reset when the booking later transitions away from
-- pending_payment (confirmed via payment, cancelled via reaper or user
-- abandon, etc.) — it stays as a permanent historical marker ("we sent
-- one reminder about this booking, once"), same non-resetting behaviour
-- as profile_nudge_email_sent_at. No CHECK constraint ties it to status
-- for the same reason.
--
-- ── Anon-visibility ──────────────────────────────────────────────────────
-- N/A — bookings has no anon SELECT policy at all (RLS restricts SELECT
-- to row owner + admin; see 20260713000001's identical note). Column
-- inherits the table-wide posture.
--
-- ── Idempotency ────────────────────────────────────────────────────────
-- ADD COLUMN IF NOT EXISTS. COMMENT ON COLUMN is idempotent by spec.
--
-- ── Safety / blast radius ────────────────────────────────────────────────
-- Purely additive, nullable, no default write. Zero behavioural change
-- until the new pending-payment-reminder cron (20260808000002 +
-- supabase/functions/pending-payment-reminder) starts setting it.
--
-- ── Post-merge ────────────────────────────────────────────────────────────
-- CI applies migrations to local Supabase only. After merge run manually:
--   supabase db push --include-all --linked

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS pending_payment_reminder_sent_at timestamptz;

COMMENT ON COLUMN public.bookings.pending_payment_reminder_sent_at IS
  'Set once when the abandoned-checkout reminder email has been sent (or attempted) for this pending_payment booking. NULL = not yet sent. Gates the pending-payment-reminder pg_cron job (20260808000002) against double-sending; never reset once set, even after the booking later transitions to confirmed/cancelled — matches profiles.profile_nudge_email_sent_at''s non-resetting, once-only semantics. NOT scoped to is_admin_hold rows — those are excluded from this reminder entirely (own admin-managed email flow) and this column is never set for them.';

-- ── No new indexes ─────────────────────────────────────────────────────────
-- Demo scale (mirrors 20260713000001's own "no new indexes" note). If
-- this table ever grows large, a partial index
-- `WHERE status = 'pending_payment' AND pending_payment_reminder_sent_at
-- IS NULL` would directly serve the cron job's own predicate — noted for
-- future, not required now.

-- ── RLS unchanged ──────────────────────────────────────────────────────────
-- Existing bookings policies cover the new column (SELECT: owner or
-- admin; UPDATE: owner or admin — the cron job writes via service_role,
-- which bypasses RLS entirely). No new policy needed.
