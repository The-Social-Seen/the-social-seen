-- Migration: bookings_cancellation_columns (P2-7b)
--
-- Adds audit + refund columns to bookings for the user-cancellation +
-- 48h refund policy. All nullable — existing cancelled-via-RLS bookings
-- from before this migration keep working (their audit trail is just the
-- `status = 'cancelled'` transition + updated_at).
--
--   cancelled_at            — distinct from updated_at: when THIS cancel
--                             happened. updated_at moves for other reasons
--                             (admin tweaks, soft-delete, etc.).
--
--   cancellation_reason     — optional user-supplied text. Currently
--                             unused in UI (simple "Cancel" button), but
--                             captured in the schema so future admin
--                             can add a dropdown without another
--                             migration.
--
--   refunded_amount_pence   — 0 if no refund was issued. price_at_booking
--                             if fully refunded (48h+ before event,
--                             paid event). A future partial-refund model
--                             can populate with any value ≤ price.
--
--   refunded_at             — when the refund was initiated. Distinct
--                             from webhook `charge.refunded` processing
--                             (that will match on stripe_refund_id).
--
--   stripe_refund_id        — Stripe refund object id, from
--                             stripe.refunds.create. Partial UNIQUE index
--                             guards against accidental double refunds.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS cancelled_at           timestamptz,
  ADD COLUMN IF NOT EXISTS cancellation_reason    text,
  ADD COLUMN IF NOT EXISTS refunded_amount_pence  integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refunded_at            timestamptz,
  ADD COLUMN IF NOT EXISTS stripe_refund_id       text;

COMMENT ON COLUMN public.bookings.cancelled_at IS
  'Timestamp of user or admin cancellation. Distinct from updated_at (which moves for any row change).';
COMMENT ON COLUMN public.bookings.refunded_amount_pence IS
  'Amount refunded in pence. 0 = no refund. Equals price_at_booking for full 48h+ refunds.';
COMMENT ON COLUMN public.bookings.stripe_refund_id IS
  'Stripe Refund id from refunds.create. Partial UNIQUE index prevents double refunds.';

CREATE UNIQUE INDEX IF NOT EXISTS ux_bookings_stripe_refund_id
  ON public.bookings (stripe_refund_id)
  WHERE stripe_refund_id IS NOT NULL;

-- ── Sanity CHECK ───────────────────────────────────────────────────────────
-- refunded_amount_pence > 0 implies refunded_at AND stripe_refund_id are
-- set. Prevents buggy code from recording a refund amount without
-- recording WHEN or WHICH Stripe refund.
DO $$ BEGIN
  ALTER TABLE public.bookings
    ADD CONSTRAINT chk_bookings_refund_consistency
    CHECK (
      refunded_amount_pence = 0
      OR (refunded_at IS NOT NULL AND stripe_refund_id IS NOT NULL)
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── RLS unchanged ──────────────────────────────────────────────────────────
-- bookings_update already allows `user_id = auth.uid() OR admin`. That
-- covers writing these columns on the user's own cancellation path.
-- The refund amount/id fields are set by Server Actions (user-scope) or
-- the admin client (in the webhook); both are authorised.
