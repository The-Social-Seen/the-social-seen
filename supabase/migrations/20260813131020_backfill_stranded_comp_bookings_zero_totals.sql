-- Migration: backfill_stranded_comp_bookings_zero_totals
--
-- AUDIT-ONLY. One-time, read-only diagnostic for bookings potentially
-- stranded by the checkout.session.completed comp-detection bug fixed
-- alongside this migration in src/app/api/stripe/webhook/route.ts. Full
-- design: docs/SYSTEM-DESIGN-webhook-comp-detection-fix.md (§5.1-§5.3 for
-- the still-current candidate signal, §5.4′-§5.11′ for why this migration
-- is audit-only and what happens next).
--
-- ── REVISED 2026-08-13 (same day) after a code-reviewer Block ────────────
-- The original version of this migration paired Phase A (audit) with a
-- Phase B (automatic UPDATE zeroing price_at_booking/booking_fee_pence for
-- every matched row). That was blocked in code review: the 5-condition
-- signal below is NOT uniquely diagnostic of a genuine £0 comp — it is
-- indistinguishable, from DB signals alone, from a row produced by
-- Exploit A in docs/SYSTEM-DESIGN-bookings-write-authorization-hardening.md
-- (a still-open, unpatched vulnerability: any member can PATCH their own
-- booking's status to 'confirmed' via a direct authenticated REST call,
-- with no capacity check and no payment, on a row that already has
-- stripe_checkout_session_id set from checkout-session creation). Auto-
-- correcting on this signal risked silently laundering a fraudulently
-- self-confirmed unpaid booking into looking like a legitimate £0 comp,
-- before any human reviewed it. See the design doc's "Addendum" section
-- for the full reasoning.
--
-- This migration now ONLY reports candidates via RAISE NOTICE. It performs
-- no writes of any kind against public.bookings (or any other table). The
-- actual correction — once a human operator has individually cross-checked
-- each candidate against the Stripe Dashboard — ships as a SEPARATE,
-- later migration with a hardcoded, human-verified id list (design doc
-- §5.10′). That migration does not exist yet and is explicitly out of
-- scope for this one.
--
-- ── Candidate signal (5 conditions, matches the webhook's own comp path)──
--   status = 'confirmed'
--   stripe_payment_id IS NULL
--   stripe_fee_pence = 0
--   price_at_booking > 0
--   stripe_checkout_session_id IS NOT NULL   -- discriminates this bug from
--     the unrelated 2026-07-13 promoteFromWaitlist bug class (migrations
--     20260713000002 / 20260713000004), which produces a superficially
--     similar row shape (confirmed + stripe_payment_id IS NULL on a paid
--     event) but NEVER created a Stripe Checkout Session at all — those
--     rows have stripe_checkout_session_id IS NULL and are correctly
--     excluded by this condition. Both known rows from that incident
--     (Amy Sangam, Yasemin Salp) have since been moved to pending_payment
--     via admin_hold_confirmed_booking_for_payment and no longer match
--     this WHERE clause either way.
--
-- Scoped across ALL events, not just the one event the 13 known rows were
-- found on — the WHERE clause is signal-based, not id-based, per the task
-- brief's explicit instruction not to hardcode this to the known ids.
--
-- ── Additional exclusions (flagged, not silently dropped) ────────────────
--   refunded_amount_pence > 0 OR stripe_refund_id IS NOT NULL
--     — this booking already has refund activity recorded. A booking with
--       a non-zero refunded_amount_pence next to an as-yet-uncorrected
--       full-face-value price_at_booking is a nonsensical state and needs
--       a human to reconcile the sequence of events first.
--   events.deleted_at IS NOT NULL
--     — a financial correction on a booking for a soft-deleted event
--       needs a human's eyes, not automation.
-- Both exclusions are checked defensively (the evidence given does not
-- suggest either applies to the known rows), but if the live diagnostic
-- run does surface one, it is logged as SKIPPED (manual review), not
-- silently omitted from the run's output.
--
-- ── Audit-only design ──────────────────────────────────────────────────
-- Pure read + RAISE NOTICE. Logs every excluded row (with reason) and
-- every candidate row (with temporal context — see below) so a human
-- reading the migration's run log (Supabase SQL editor / psql output) can
-- see exactly which rows warrant a Stripe cross-check. There is no write
-- phase in this file. No UPDATE, INSERT, or DELETE statement targets
-- public.bookings (or any table) anywhere below.
--
-- ── Temporal context tagging (informational only — NOT a safety signal) ──
-- Every row matching the 5-condition signal + passing the 2 exclusions
-- gets a `temporal_context` annotation based on created_at relative to the
-- merge time of the commit that closed the two booking-status-tampering
-- exploit paths named in the fix's design doc (PR #118, commit cab424d,
-- migrations 20260812171530 / 20260812185745). This annotation is context
-- for the human doing the Stripe cross-check (a more recent row is more
-- likely to still have easily-searchable Stripe Dashboard activity) — it
-- is explicitly NOT a verification or trust signal, and every candidate
-- must still be individually checked against Stripe regardless of which
-- tier it falls in. See docs/SYSTEM-DESIGN-webhook-comp-detection-fix.md
-- §5.4′ for why the original "confidence" framing was actively misleading
-- and had to be reworded, not just relabelled.
--
-- IMPORTANT — v_fix_cutoff below is the CODE-MERGE time (cab424d,
-- 2026-08-13T09:23:48+01:00), not necessarily the PRODUCTION-DEPLOY time.
-- Per this repo's known process gap (CI applies migrations to local
-- Supabase only; production needs a separate manual
-- `supabase db push --include-all --linked`), the actual moment those
-- RLS/RPC changes took effect against the LIVE database could be later
-- than this timestamp — and even once live, the underlying exploit has
-- been reachable for the entire lifetime of the bookings table, so this
-- timestamp does not, by itself, rule anything out for any individual row.
--
-- ── CHECK constraint interaction ──────────────────────────────────────────
-- N/A to this migration — chk_bookings_free_no_booking_fee
-- (20260517000001_add_bookings_fee_columns.sql) only matters to whatever
-- migration eventually writes price_at_booking/booking_fee_pence. This
-- file performs no writes, so no CHECK constraint is exercised. Retained
-- as a note for whoever authors the follow-up correction migration
-- (design doc §5.7′/§5.10′).
--
-- ── Anon-visibility ────────────────────────────────────────────────────────
-- N/A — this is a read-only diagnostic against public.bookings, not a
-- schema/column change. No GRANT changes.
--
-- ── Idempotency ────────────────────────────────────────────────────────────
-- Trivially idempotent: this migration never writes anything, so
-- re-running it (e.g. via `supabase db reset` replaying migration
-- history) just re-prints the same CANDIDATE/SKIPPED notices against
-- whatever data is present at run time. Expected against fresh seed data:
-- zero matches (this is a production-data-shaped diagnostic; seed data
-- won't trip it).
--
-- ── Next step (NOT part of this migration) ────────────────────────────────
-- CI applies migrations to local Supabase only. After merge, an operator
-- must run `supabase db push --include-all --linked` to apply against
-- production, per project_migration_apply_step. Immediately after, the
-- operator must capture this migration's full NOTICE output (Supabase
-- dashboard SQL editor run log, or CLI/psql output) as the audit trail,
-- and individually cross-check every CANDIDATE row's id/email/event-slug
-- against the Stripe Dashboard (search Checkout Sessions or Customers by
-- email) for a genuine customer.discount.created / 100%-off promotion-code
-- redemption. Rows that verify get their ids collected into a second,
-- separately-reviewed migration that performs the actual correction (see
-- docs/SYSTEM-DESIGN-webhook-comp-detection-fix.md §5.10′ for that
-- migration's exact design). Rows that do NOT verify in Stripe must not be
-- corrected and should be escalated as a suspected exploit instance
-- instead. See §7 of the design doc for the full operator runbook.

DO $$
DECLARE
  -- See "Temporal context tagging" header note above — this is the
  -- CODE-MERGE time for PR #118 (cab424d), not confirmed prod-deploy time.
  v_fix_cutoff CONSTANT timestamptz := '2026-08-13T09:23:48+01:00';
  r RECORD;
  v_candidate_count integer := 0;
BEGIN
  -- ── Prep: materialize the exact candidate set once, entirely inside
  -- this single DO block/statement, so every notice loop below reads from
  -- the identical materialized row set.
  --
  -- Deliberately created HERE (inside the DO block) rather than as a
  -- preceding top-level `CREATE TEMP TABLE ... ON COMMIT DROP AS SELECT`
  -- statement: migration runners that execute a .sql file
  -- statement-by-statement with autocommit (verified locally against a
  -- real Postgres instance while hand-testing this migration, in the
  -- absence of a local Supabase/Docker stack in this sandbox) commit each
  -- top-level statement in its own transaction, which means an
  -- ON-COMMIT-DROP temp table created by an earlier top-level statement
  -- is already gone by the time a later top-level DO block tries to read
  -- it ("relation does not exist"). Creating and consuming the temp
  -- table entirely within one dollar-quoted DO block (this one) removes
  -- that dependency on how the runner batches/commits the file's
  -- statements.
  CREATE TEMP TABLE _backfill_comp_candidates ON COMMIT DROP AS
  SELECT
    b.id,
    b.user_id,
    b.event_id,
    b.created_at,
    b.price_at_booking  AS old_price_at_booking,
    b.booking_fee_pence AS old_booking_fee_pence,
    p.email,
    e.slug AS event_slug,
    CASE
      WHEN b.created_at >= v_fix_cutoff
        THEN 'context: created after the PR #118 code-merge time (' || v_fix_cutoff || ') that closed the direct-PATCH status-tampering exploit IN CODE REVIEW — HOWEVER (a) that migration may not yet be live in production, see the known db-push gap noted above, and (b) even once live, this timestamp does NOT rule out this exact exploit for THIS row: the vulnerability has been reachable for the entire lifetime of the bookings table (see docs/SYSTEM-DESIGN-bookings-write-authorization-hardening.md), so a pre-cutoff exploit attempt is still possible regardless of when the fix eventually merged. Do not treat this tag as verification — check Stripe directly.'
      ELSE 'context: created before the PR #118 code-merge time (' || v_fix_cutoff || '); no additional inference beyond that.'
    END AS temporal_context
  FROM public.bookings b
  JOIN public.profiles p ON p.id = b.user_id
  JOIN public.events   e ON e.id = b.event_id
  WHERE b.status = 'confirmed'
    AND b.stripe_payment_id IS NULL
    AND b.stripe_fee_pence = 0
    AND b.price_at_booking > 0
    AND b.stripe_checkout_session_id IS NOT NULL
    AND b.deleted_at IS NULL
    AND b.refunded_amount_pence = 0
    AND b.stripe_refund_id IS NULL
    AND e.deleted_at IS NULL;

  -- ── Rows that match the 5-condition signal but fail one of the two
  -- additional exclusions. Flagged for manual review. Nothing in this
  -- migration ever touches these rows.
  FOR r IN
    SELECT
      b.id,
      p.email,
      e.slug AS event_slug,
      CASE
        WHEN b.refunded_amount_pence > 0 OR b.stripe_refund_id IS NOT NULL
          THEN 'refund activity already recorded on this booking (refunded_amount_pence=' || b.refunded_amount_pence || ', stripe_refund_id=' || COALESCE(b.stripe_refund_id, 'null') || ')'
        WHEN e.deleted_at IS NOT NULL
          THEN 'event is soft-deleted (deleted_at=' || e.deleted_at || ')'
      END AS exclusion_reason
    FROM public.bookings b
    JOIN public.profiles p ON p.id = b.user_id
    JOIN public.events   e ON e.id = b.event_id
    WHERE b.status = 'confirmed'
      AND b.stripe_payment_id IS NULL
      AND b.stripe_fee_pence = 0
      AND b.price_at_booking > 0
      AND b.stripe_checkout_session_id IS NOT NULL
      AND b.deleted_at IS NULL
      AND (
        b.refunded_amount_pence > 0
        OR b.stripe_refund_id IS NOT NULL
        OR e.deleted_at IS NOT NULL
      )
    ORDER BY b.created_at
  LOOP
    RAISE NOTICE 'SKIPPED (manual review) booking % (%, event %): %',
      r.id, r.email, r.event_slug, r.exclusion_reason;
  END LOOP;

  -- ── Candidates for human/Stripe review. Pure read — this migration
  -- never writes to public.bookings (or anything else). The actual
  -- correction, once verified, ships as a separate later migration — see
  -- docs/SYSTEM-DESIGN-webhook-comp-detection-fix.md §5.10′.
  FOR r IN SELECT * FROM _backfill_comp_candidates ORDER BY created_at
  LOOP
    v_candidate_count := v_candidate_count + 1;
    RAISE NOTICE 'CANDIDATE booking % (%, event %) created % — %  — price_at_booking=%p booking_fee_pence=%p',
      r.id, r.email, r.event_slug, r.created_at, r.temporal_context,
      r.old_price_at_booking, r.old_booking_fee_pence;
  END LOOP;

  RAISE NOTICE 'Backfill audit found % candidate(s) for manual review (0 corrected — audit-only migration, see docs/SYSTEM-DESIGN-webhook-comp-detection-fix.md §5.10′ for the correction step)',
    v_candidate_count;
END $$;

-- No verify-SELECT here — there is no write for a before/after comparison
-- to confirm. See docs/SYSTEM-DESIGN-webhook-comp-detection-fix.md §5.10′
-- for the operator workflow that follows this migration: capture the
-- CANDIDATE/SKIPPED notices above, cross-check each CANDIDATE against the
-- Stripe Dashboard, and hand verified ids to a second, separately-reviewed
-- migration that performs the actual correction.
