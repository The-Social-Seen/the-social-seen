-- Migration: stripe_payments_schema (P2-7a)
--
-- Adds the schema needed for Stripe Checkout integration:
--
--   1. `pending_payment` booking_status enum value
--      A paid-event booking starts here: the row exists (locking the
--      capacity slot) but Stripe has not yet confirmed the payment. The
--      webhook handler moves it to `confirmed` on
--      `checkout.session.completed`, or the booking is deleted if the
--      user cancels out of the Stripe hosted page.
--
--   2. `bookings.stripe_payment_id text` (nullable)
--      The Stripe PaymentIntent id from checkout.session.completed.
--      Populated by the webhook; used for idempotency checks and for
--      issuing refunds in P2-7b.
--
--   3. `bookings.stripe_checkout_session_id text` (nullable)
--      The Checkout Session id. Populated at session creation time so
--      the webhook can look the booking up by session id before the
--      payment_intent is known.
--
--   4. `profiles.stripe_customer_id text` (nullable)
--      The Stripe Customer id, so a returning member reuses saved
--      payment methods. Populated lazily on first paid booking.
--
-- Index on stripe_checkout_session_id for the webhook's booking lookup.
-- Unique partial index on stripe_payment_id prevents two bookings
-- sharing a PaymentIntent (webhook idempotency at the DB layer).
--
-- Idempotent: ALTER TYPE ADD VALUE IF NOT EXISTS (Postgres 12+),
-- ADD COLUMN IF NOT EXISTS.

-- ── Enum value ─────────────────────────────────────────────────────────────
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction block in older
-- Postgres, but Supabase runs migrations with implicit transactions off for
-- this statement. IF NOT EXISTS guards re-runs.
ALTER TYPE booking_status ADD VALUE IF NOT EXISTS 'pending_payment';

-- ── Booking columns ────────────────────────────────────────────────────────
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS stripe_payment_id            text,
  ADD COLUMN IF NOT EXISTS stripe_checkout_session_id   text;

COMMENT ON COLUMN public.bookings.stripe_payment_id IS
  'Stripe PaymentIntent id (populated by webhook on checkout.session.completed). Used for refunds.';
COMMENT ON COLUMN public.bookings.stripe_checkout_session_id IS
  'Stripe Checkout Session id (populated when the session is created, before payment). Used by the webhook handler to look the booking up.';

CREATE INDEX IF NOT EXISTS idx_bookings_stripe_checkout_session
  ON public.bookings (stripe_checkout_session_id)
  WHERE stripe_checkout_session_id IS NOT NULL;

-- Unique index — webhook idempotency at the DB layer. Even if
-- checkout.session.completed fires twice (retry, duplicate delivery),
-- the second UPDATE can't set the same stripe_payment_id on a different
-- booking.
CREATE UNIQUE INDEX IF NOT EXISTS ux_bookings_stripe_payment_id
  ON public.bookings (stripe_payment_id)
  WHERE stripe_payment_id IS NOT NULL;

-- ── Profile column ─────────────────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS stripe_customer_id text;

COMMENT ON COLUMN public.profiles.stripe_customer_id IS
  'Stripe Customer id. Populated lazily on first paid booking so returning members reuse saved payment methods.';

-- Partial unique index — one Stripe customer per profile, but NULL is
-- allowed (most profiles never book a paid event).
CREATE UNIQUE INDEX IF NOT EXISTS ux_profiles_stripe_customer_id
  ON public.profiles (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

-- ── Column-level GRANT: stripe_customer_id is not anon-visible ─────────────
-- Consistent with the "secure by default" model established in P2-2: this
-- PII-adjacent column is REVOKEd from anon. Authenticated users can read
-- their own row via RLS. Service role bypasses.
REVOKE SELECT (stripe_customer_id) ON public.profiles FROM anon;

-- ── Note on book_event() RPC ───────────────────────────────────────────────
-- The existing book_event() RPC inserts free-event bookings as 'confirmed'
-- under a row lock. The paid flow needs the same locking semantics — two
-- users racing for the last paid seat must not both end up with
-- 'pending_payment' rows. Migration 20260422000002 adds
-- book_event_paid() which mirrors book_event() but inserts as
-- 'pending_payment' (or 'waitlisted' if full) and returns the booking id
-- for the Server Action to attach to the Stripe Checkout Session metadata.
