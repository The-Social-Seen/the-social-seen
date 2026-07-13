-- Migration: add_bookings_admin_hold_columns
--
-- Adds the two columns that let an admin-created "pay to hold your
-- promoted waitlist spot" pending_payment row be distinguished from a
-- normal self-service checkout. Needed by:
--   (a) reap_stale_pending_bookings() — must SKIP these rows (they get a
--       much longer, admin-communicated payment window than the
--       standard 35-minute abandoned-checkout timeout).
--   (b) the new admin_promote_waitlist_to_hold() RPC (20260713000002)
--       and revert_expired_admin_holds() cron (20260713000003).
--
-- See SYSTEM-DESIGN-admin-waitlist-promotion-payment.md §2 for full
-- rationale, including why this is two columns (not one column with an
-- 'infinity' sentinel — see §2.1) and why the second CHECK constraint
-- is deliberately strict (§2.3).
--
-- ── Anon-visibility ──────────────────────────────────────────────────────
-- N/A — bookings has no anon SELECT policy at all (RLS restricts SELECT
-- to row owner + admin). Both columns inherit the table-wide posture.
--
-- ── Idempotency ──────────────────────────────────────────────────────────
-- ADD COLUMN IF NOT EXISTS + named CHECKs guarded with the standard
-- DO $$ ... EXCEPTION WHEN duplicate_object pattern (matches
-- 20260517000001).
--
-- ── Safety / blast radius ──────────────────────────────────────────────────
-- Purely additive. `is_admin_hold` defaults false and `admin_hold_expires_at`
-- defaults NULL for every existing row — zero behavioural change until the
-- new RPC (20260713000002) starts setting them. No table rewrite risk at
-- demo scale; CHECK validation is a single sequential scan of a small table.
--
-- ── Post-merge ────────────────────────────────────────────────────────────
-- CI applies migrations to local Supabase only. After merge run manually:
--   supabase db push --include-all --linked
-- Verify: SELECT column_name FROM information_schema.columns
--         WHERE table_name = 'bookings' AND column_name LIKE 'admin_hold%' OR column_name = 'is_admin_hold';

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS is_admin_hold boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS admin_hold_expires_at timestamptz;

COMMENT ON COLUMN public.bookings.is_admin_hold IS
  'True while this row is a pending_payment seat hold created by an admin waitlist promotion (promoteFromWaitlist / admin_promote_waitlist_to_hold), as opposed to a normal self-service checkout. MUST be cleared back to false in the same statement that moves status away from pending_payment (paid via webhook, reverted via revert_expired_admin_holds, or cancelled) — enforced by chk_bookings_admin_hold_requires_pending_payment. Named to avoid collision with this codebase''s unrelated "Stripe promotion code" concept (allow_promotion_codes).';

COMMENT ON COLUMN public.bookings.admin_hold_expires_at IS
  'Auto-revert deadline for an admin-created hold. NULL = no automated revert (human-managed — either because the admin explicitly chose that, or because the event is too close for a 4h window to make sense; see computeHoldExpiresAt in src/lib/bookings/admin-hold.ts). Non-NULL = revert_expired_admin_holds() reverts this booking to waitlisted once passed. Always NULL when is_admin_hold = false.';

DO $$ BEGIN
  ALTER TABLE public.bookings
    ADD CONSTRAINT chk_bookings_admin_hold_expiry_requires_flag
    CHECK (is_admin_hold = true OR admin_hold_expires_at IS NULL);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.bookings
    ADD CONSTRAINT chk_bookings_admin_hold_requires_pending_payment
    CHECK (is_admin_hold = false OR status = 'pending_payment');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── No new indexes ─────────────────────────────────────────────────────────
-- Demo scale (mirrors the reaper's own migration, which added none either).
-- If this table ever grows large, a partial index
-- `WHERE is_admin_hold = true` would be cheap (the predicate matches a
-- tiny fraction of rows) — noted for future, not required now.
