-- Migration: add_bookings_fee_columns (refund-fee-deduction P1)
--
-- Adds two snapshot columns to public.bookings so paid bookings can carry
-- both the booking fee we CHARGED the customer at checkout and the actual
-- Stripe processing fee for that charge. Backs the refund-fee-deduction
-- feature: see SYSTEM-DESIGN-refund-fee-deduction.md.
--
--   1. booking_fee_pence integer NOT NULL DEFAULT 0
--      The fee we charged on top of price_at_booking, in pence. Set at row
--      creation by book_event_paid() / claim_waitlist_spot(); never
--      updates. The formula lives in src/lib/utils/booking-fee.ts and the
--      Server Action passes the computed value to the RPC as
--      p_booking_fee_pence (single source of truth — TS helper).
--
--      On USER cancellation we refund price_at_booking ONLY; this fee
--      stays with the platform to absorb Stripe's processing cost. On
--      ADMIN event cancellation (cancelEventAndRefundBookings) the
--      platform refunds price_at_booking + booking_fee_pence in full.
--
--      Default 0 covers (a) free events, (b) pre-migration rows that
--      never had a fee snapshot, (c) defensive inserts that bypass the
--      RPC (the CHECK constraint below also catches the
--      free-event-with-fee misuse case).
--
--   2. stripe_fee_pence integer NOT NULL DEFAULT 0
--      The ACTUAL processing fee Stripe took for this charge, captured
--      from the BalanceTransaction.fee field in the
--      checkout.session.completed webhook. Reporting / reconciliation
--      ONLY — NOT used in the refund formula. Default 0 covers free
--      events, pre-migration rows, and the tiny window between booking
--      confirmation and the webhook's BalanceTransaction lookup
--      (intentionally non-blocking — a failed lookup logs and continues
--      so a Stripe API blip can't break booking confirmation).
--
-- THREE CHECK constraints:
--   - chk_bookings_booking_fee_non_negative   — booking_fee_pence >= 0
--   - chk_bookings_stripe_fee_non_negative    — stripe_fee_pence  >= 0
--   - chk_bookings_free_no_booking_fee        — price_at_booking > 0
--                                                OR booking_fee_pence = 0
-- All are named, idempotent (DO $$ ... EXCEPTION WHEN duplicate_object),
-- and rollback-droppable. Pattern matches 20260422000003 (the
-- chk_bookings_refund_consistency precedent).
--
-- We deliberately do NOT add `stripe_fee_pence <= booking_fee_pence` as a
-- CHECK. The whole point of stripe_fee_pence is to capture variance — on
-- AmEx / international cards Stripe's actual fee can exceed our displayed
-- fee, and the platform absorbs the delta (locked decision per spec §1.3).
--
-- ── Anon-visibility decision ──────────────────────────────────────────────
-- Both new columns are PII-adjacent transaction internals. Anon already
-- has no SELECT on bookings (RLS restricts SELECT to row owner + admin),
-- so there is no anon GRANT to add. The columns inherit the table-wide
-- access posture. Documented per CLAUDE.md "secure-by-default" rule.
--
-- ── Idempotency ───────────────────────────────────────────────────────────
-- ADD COLUMN IF NOT EXISTS for both columns.
-- DO $$ ... EXCEPTION WHEN duplicate_object guards each named CHECK.
-- COMMENT ON COLUMN is idempotent by SQL spec.
-- Migration is safe to re-run.
--
-- ── Post-merge ────────────────────────────────────────────────────────────
-- CI applies migrations to local Supabase only. After merge run manually:
--   supabase db push --include-all --linked
-- to apply against production. See project_migration_apply_step memory note.

-- ── Columns ────────────────────────────────────────────────────────────────
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS booking_fee_pence integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stripe_fee_pence  integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.bookings.booking_fee_pence IS
  'Non-refundable booking fee CHARGED to the customer at checkout, in pence. Snapshot at row creation by book_event_paid() / claim_waitlist_spot(). 0 for free events and pre-migration rows. On user cancellation we refund price_at_booking only (this fee is kept to absorb Stripe processing cost). On admin event-cancellation we refund price_at_booking + this fee (platform eats the cost).';

COMMENT ON COLUMN public.bookings.stripe_fee_pence IS
  'ACTUAL Stripe processing fee captured from BalanceTransaction.fee in the checkout.session.completed webhook, in pence. Reporting / reconciliation only — NOT used in any refund formula. 0 if the webhook lookup failed (intentionally non-blocking) or the booking is free.';

-- ── CHECK constraints ──────────────────────────────────────────────────────
-- Non-negative guards.
DO $$ BEGIN
  ALTER TABLE public.bookings
    ADD CONSTRAINT chk_bookings_booking_fee_non_negative
    CHECK (booking_fee_pence >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.bookings
    ADD CONSTRAINT chk_bookings_stripe_fee_non_negative
    CHECK (stripe_fee_pence >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Free-event guard: a booking with price_at_booking = 0 cannot carry a
-- non-zero booking fee. Defence-in-depth — the RPC also explicitly checks
-- this before INSERT, and the Server Action layer never calls the fee
-- helper for free events. Constraint catches direct-INSERT misuses.
DO $$ BEGIN
  ALTER TABLE public.bookings
    ADD CONSTRAINT chk_bookings_free_no_booking_fee
    CHECK (price_at_booking > 0 OR booking_fee_pence = 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── No new indexes ─────────────────────────────────────────────────────────
-- Neither column appears in WHERE predicates. They're snapshot fields
-- read by-id alongside the booking row.

-- ── RLS unchanged ──────────────────────────────────────────────────────────
-- Existing bookings policies cover both new columns:
--   SELECT — user_id = auth.uid() OR admin
--   UPDATE — user_id = auth.uid() OR admin (admin client bypasses for
--            webhook writes of stripe_fee_pence)
--   INSERT — authenticated, via SECURITY DEFINER RPCs only
-- No new policies needed.
