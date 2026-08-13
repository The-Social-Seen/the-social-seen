-- Migration: correct_verified_stranded_comp_bookings
--
-- Human-verified correction for bookings identified by the audit-only
-- migration 20260813131020_backfill_stranded_comp_bookings_zero_totals.sql
-- (14 candidates found; 1 excluded here, see below), per
-- docs/SYSTEM-DESIGN-webhook-comp-detection-fix.md §5.10'.
--
-- All 13 ids below are for "Social Seen Summer Rooftop Party"
-- (social-seen-summer-rooftop-party), all created between 2026-08-05 and
-- 2026-08-13, all sharing the exact same stranded-comp signature (real
-- Stripe Checkout Session, no PaymentIntent, no Stripe fee, full face
-- value still on price_at_booking).
--
-- Verification basis (documented honestly — not every row was
-- individually pulled up in the Stripe Dashboard):
--   - 1 of the 13 (rish_jain@hotmail.com) was individually verified
--     against a real Stripe `customer.discount.created` event by the
--     site owner (Mitesh), firing ~40 seconds before the booking's
--     created_at, confirming a genuine 100%-off promotion-code
--     redemption.
--   - The remaining 12 were approved by the site owner on 2026-08-13
--     based on sharing the byte-identical signature with that verified
--     row: same event, same £10.00 price, same "real checkout session +
--     no payment ever recorded" shape, spread consistently over the
--     same 8-day window. Not each individually pulled up in Stripe.
--
-- A SEPARATE, related correction — NOT part of this migration and NOT
-- one of the 13 ids below — was applied out-of-band on 2026-08-13 for
-- booking a458c3cc-7e06-4452-b729-7ddb2ce43234 (ayy7991@gmail.com,
-- same event). That booking shared the same root-cause verification (a
-- real Stripe `customer.discount.created` event, ~16 seconds before its
-- created_at) but was NOT one of Migration 1's 14 audit candidates —
-- by audit time its status had already been moved to 'pending_payment'
-- (an admin had clicked "Send Payment Link" on it, itself a symptom of
-- this same underlying bug — see fix/send-payment-link-zero-price-
-- bookings), so it needed restoring status→'confirmed' and clearing
-- is_admin_hold in addition to zeroing price/fee — outside this
-- migration's narrow, price-only scope. Applied directly via the
-- Supabase SQL Editor (not a tracked migration) by the site owner,
-- guarded by an equivalent WHERE status='pending_payment' AND
-- is_admin_hold=true re-validation. Documented here, in prose, since no
-- migration file exists for it — flagged as a one-off exception to the
-- "changes go through migrations" rule, made deliberately for a single
-- already-verified row rather than establishing a pattern.
--
-- One additional candidate from Migration 1's 14 — booking id
-- 7c518da0-608f-41bd-a8f8-284876f5443f (mitesh50@hotmail.com,
-- "A Weekend Hiking in the Peak District", £250.00, created 2026-06-08) —
-- is DELIBERATELY EXCLUDED from this migration — different event, much
-- older, an order of magnitude higher value, and not yet confirmed by
-- the site owner as a legitimate self-comp. Left as an open candidate
-- for a future, separately-verified correction.
--
-- Verified ids (booking id — member email — Stripe Checkout Session id
-- cross-checked — verified by — date):
--   e0b5ddbf-4343-4209-a98a-248f4de1e3f5 — rish_jain@hotmail.com — cs_live_b10JVur64QBsx2ZUWi50P5XCmVQAnP9O7pZV4WRCg5Ib8Z0Ldms5R0SOyd — mitesh (individual Stripe check) — 2026-08-13
--   bfd3e832-c3ad-4ce8-a3b5-64a132e3b1fd — nikhil_1990@hotmail.co.uk — cs_live_b1QjEMHLVe36UX9q3Xb7pCC1LWTp4mWcZktrvyje7Txe5z7UKF0Mw2Wkla — mitesh (pattern match, approved) — 2026-08-13
--   950f34c2-54f9-4219-a965-159968181abf — sebastien.dessere@gmail.com — cs_live_b1sy1KHC4C4OIbIrghIakzSwMCemNo1I23TtAF29F0c2v1d7BZxl8e4qfM — mitesh (pattern match, approved) — 2026-08-13
--   c3d57263-1f3d-43ef-9300-e62e7fc6c61a — juliataylor86@gmail.com — cs_live_b1qp088BevCh5cjOBZ6JbWSQ1QBRqo6iq9ISXVPnu2Cziw7ClQPwwDtcyy — mitesh (pattern match, approved) — 2026-08-13
--   02ea486a-05f0-491c-83ad-4ec16e6388de — texiaia@gmail.com — cs_live_b1D5nP8jgkIiCuXhiGvSf5GzlwSSYuCU0Bq8RDQY0e5QVXS9bezzZ0GPDa — mitesh (pattern match, approved) — 2026-08-13
--   e9433994-5069-479b-ba51-a8d247921c63 — anisha.sukha@gmail.com — cs_live_b1XZJaKWThRwJDqcmKgPWacSsv9jhTO9P7uE9qHUPe6qsEMs3rk18TtzfV — mitesh (pattern match, approved) — 2026-08-13
--   7e8eeeaa-e9f3-4c2e-85e4-c6bc2be20de3 — rohin.d@hotmail.co.uk — cs_live_b1r9Szeyw4iC0FQj5rtHPNMf4RiHTeaKZO2gW8rZY2vUJXTWvDPPJ3uVjp — mitesh (pattern match, approved) — 2026-08-13
--   848bb4e8-6ffa-4bf7-99ab-dd66f0c83817 — helloharpal@outlook.com — cs_live_b1JjHd2MdVMfLccgrEIa3pQfYg1NITHYTBinKNe85sxTbSQJ1sl8mfwZKm — mitesh (pattern match, approved) — 2026-08-13
--   84bb36ed-176b-4d64-8117-3bd7af161731 — naz.imambaccus@gmail.com — cs_live_b1ZIXAkZnEM357Pu1elsTc4w4CTkiDxfbxMavsvT0gcsU81M8va74pYOs8 — mitesh (pattern match, approved) — 2026-08-13
--   9d0a8b92-8580-4426-867f-0d14ffcd1615 — francescadestefano13@outlook.com — cs_live_b1GA09DXmqAdqcqq78larlpR9ZDDSZVETwgmiHwuLvGfY1WZ9EzdoWLs8i — mitesh (pattern match, approved) — 2026-08-13
--   5b0dae84-6a09-41fc-a22d-34e68e94d935 — mkivella@gmail.com — cs_live_b1rcdALCZiAIdMLxt53SzFe27apSH32P7rfSiMxhvLgQxi1qYLagSdVJ6D — mitesh (pattern match, approved) — 2026-08-13
--   9147b781-c821-4ba9-8d43-f09e417d3796 — moreilly0011@gmail.com — cs_live_b1dHDQj3blDfCARH7mkJGki342r6xwtFhSi7oSNK2QVPfrDZ32M6FtuMtk — mitesh (pattern match, approved) — 2026-08-13
--   d9e81307-39d7-4438-9a90-639da215509e — christina.dinolfo@collectionpot.com — cs_live_b15VarDfBjCe3fVbtexeiUTdtuY5QRiZJEsAX6PNiW6KR62oSxPVm4dWI0 — mitesh (pattern match, approved) — 2026-08-13
--
-- Idempotency
-- ───────────
-- Re-running finds zero rows the second time — price_at_booking > 0 is
-- part of the re-validation predicate below, so an already-corrected row
-- (price_at_booking = 0) no longer matches and is silently skipped, not
-- re-processed.
--
-- Post-merge
-- ──────────
-- CI applies migrations to local Supabase only. After merge run manually:
--   supabase db push --include-all --linked
-- Capture the CORRECTED/WARNING NOTICE output as the final audit trail
-- for this incident.

DO $$
DECLARE
  v_verified_ids CONSTANT uuid[] := ARRAY[
    'e0b5ddbf-4343-4209-a98a-248f4de1e3f5'::uuid,
    'bfd3e832-c3ad-4ce8-a3b5-64a132e3b1fd'::uuid,
    '950f34c2-54f9-4219-a965-159968181abf'::uuid,
    'c3d57263-1f3d-43ef-9300-e62e7fc6c61a'::uuid,
    '02ea486a-05f0-491c-83ad-4ec16e6388de'::uuid,
    'e9433994-5069-479b-ba51-a8d247921c63'::uuid,
    '7e8eeeaa-e9f3-4c2e-85e4-c6bc2be20de3'::uuid,
    '848bb4e8-6ffa-4bf7-99ab-dd66f0c83817'::uuid,
    '84bb36ed-176b-4d64-8117-3bd7af161731'::uuid,
    '9d0a8b92-8580-4426-867f-0d14ffcd1615'::uuid,
    '5b0dae84-6a09-41fc-a22d-34e68e94d935'::uuid,
    '9147b781-c821-4ba9-8d43-f09e417d3796'::uuid,
    'd9e81307-39d7-4438-9a90-639da215509e'::uuid
  ];
  r RECORD;
  v_corrected_count integer := 0;
  v_matched_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  -- Belt-and-braces: re-validate every id against the ORIGINAL safety
  -- signal (same 5 conditions + 2 exclusions as Migration 1) at write
  -- time, not just at verification time. Protects against a row's state
  -- having changed in the gap between verification and this migration
  -- running. A verified id that no longer matches the safety signal is
  -- logged and skipped, NOT force-corrected.
  --
  -- The matched set is captured into v_matched_ids BEFORE any UPDATE
  -- runs (not re-queried afterward) — a row just corrected in this loop
  -- has price_at_booking=0 and would otherwise no longer match its own
  -- "price_at_booking > 0" predicate, producing a false "no longer
  -- matches" warning for the very row that was just successfully fixed.
  -- Caught by hand-testing before this shipped (mutate-then-requery is
  -- the bug; capture-then-mutate is the fix).
  FOR r IN
    SELECT b.id, p.email, e.slug AS event_slug,
           b.price_at_booking AS old_price_at_booking,
           b.booking_fee_pence AS old_booking_fee_pence
    FROM   public.bookings b
    JOIN   public.profiles p ON p.id = b.user_id
    JOIN   public.events   e ON e.id = b.event_id
    WHERE  b.id = ANY(v_verified_ids)
      AND  b.status = 'confirmed'
      AND  b.stripe_payment_id IS NULL
      AND  b.stripe_fee_pence = 0
      AND  b.price_at_booking > 0
      AND  b.stripe_checkout_session_id IS NOT NULL
      AND  b.deleted_at IS NULL
      AND  b.refunded_amount_pence = 0
      AND  b.stripe_refund_id IS NULL
      AND  e.deleted_at IS NULL
  LOOP
    v_matched_ids := array_append(v_matched_ids, r.id);
    UPDATE public.bookings
    SET    price_at_booking = 0, booking_fee_pence = 0
    WHERE  id = r.id;
    v_corrected_count := v_corrected_count + 1;
    RAISE NOTICE 'CORRECTED (verified) booking % (%, event %): price_at_booking 0, booking_fee_pence 0 (was £%, £%)',
      r.id, r.email, r.event_slug,
      to_char(r.old_price_at_booking / 100.0, 'FM999999990.00'),
      to_char(r.old_booking_fee_pence / 100.0, 'FM999999990.00');
  END LOOP;

  -- A verified id that's neither in this run's matched set NOR already
  -- sitting at price_at_booking=0 (corrected this run, or a prior run —
  -- idempotency case) is the only case that genuinely needs re-review:
  -- refund activity appeared, the row/event was soft-deleted, or a typo
  -- in the id. Re-running this migration after a successful first run
  -- must NOT re-warn about rows that are already correctly settled.
  FOR r IN
    SELECT v.id
    FROM   unnest(v_verified_ids) AS v(id)
    JOIN   public.bookings b ON b.id = v.id
    WHERE  NOT (v.id = ANY(v_matched_ids))
      AND  b.price_at_booking > 0
  LOOP
    RAISE WARNING 'Verified id % no longer matches the safety signal — NOT corrected, needs re-review', r.id;
  END LOOP;

  RAISE NOTICE 'Verified-id backfill corrected % of % listed booking(s)', v_corrected_count, array_length(v_verified_ids, 1);
END $$;
