-- Migration: reaper_pgcron_schedule
--
-- Schedules the orphan-`pending_payment`-booking reaper inside Postgres
-- via pg_cron, replacing the Vercel cron entry that previously drove the
-- `/api/admin/cron/reap-stale-bookings` route on a once-per-day cadence.
--
-- ── Why pg_cron, not Vercel cron ───────────────────────────────────────────
-- On 2026-05-15 we discovered that the reaper had been silent-failing for
-- 17 consecutive days. The Vercel-cron-originated requests were arriving
-- without an `x-vercel-cron` header and the `CRON_SECRET` env var was
-- unset in Vercel Production, so every scheduled tick fell through to
-- `Bearer undefined` and 401'd. From the outside the cron looked
-- "scheduled" in the Vercel dashboard; from the inside it reaped zero
-- rows for two and a half weeks. The user (Roza) eventually hit a stuck
-- `pending_payment` row blocking her from re-booking and surfaced the
-- bug. PR #107 added a Sentry alarm on the missing-CRON_SECRET branch
-- so the same env-var-missing failure mode can't sit silent for that
-- long again — but the underlying failure mode (a scheduled job that
-- depends on a Vercel env var to authenticate against its OWN backend)
-- is still load-bearing. This migration removes the failure mode at the
-- source: pg_cron has no env-var dependency, no Bearer auth, no Sentry
-- alarm path. The job runs as `postgres` inside the DB. As long as the
-- DB is up, the reaper runs.
--
-- Secondary benefit: Vercel Hobby caps cron frequency at once-per-day.
-- pg_cron has no such cap. The new schedule is `*/15 * * * *` (every
-- 15 minutes), matching the original PR #77 design intent and giving a
-- worst-case unblock latency of ~50 min from a user abandoning a Stripe
-- Checkout session, vs ~24h on the Vercel daily cadence.
--
-- ── What this supersedes ───────────────────────────────────────────────────
-- The `"crons"` array entry in `vercel.json` pointing at
-- `/api/admin/cron/reap-stale-bookings`. That array is removed in the
-- same PR as this migration.
--
-- The Vercel route itself (`src/app/api/admin/cron/reap-stale-bookings/
-- route.ts`) STAYS in place — repurposed as a manual-probe surface for
-- ad-hoc incident response (`curl -H "Authorization: Bearer ${CRON_SECRET}"
-- ...`). The route's docstring is updated to reflect the new role; its
-- body, auth chain, Sentry instrumentation, and 9-test pin all stay
-- verbatim. Two paths to the same effect: this SQL function for the
-- scheduled path, the route's inline UPDATE for manual probes. The
-- predicate set + UPDATE column set must stay in sync between the two.
--
-- ── Operator setup required ────────────────────────────────────────────────
-- NONE. This is the standout difference vs `20260514070757_supersede_
-- daily_notifications_schedule_with_vault_pattern.sql`: that migration
-- needs three pieces of post-apply operator setup (Edge Function env +
-- two vault secrets) before the cron fires successfully. This migration
-- needs zero. No vault, no env vars, no `pg_net`, no JWT. After
-- `supabase db push --include-all --linked` lands, the schedule is
-- installed and the next 15-minute tick runs.
--
-- ── References ─────────────────────────────────────────────────────────────
--   • PR #107       — Sentry alarm on missing CRON_SECRET (incident response)
--   • 2026-05-15    — Roza incident (17-day silent 401)
--   • Memory note   — project_migration_apply_step.md (operator must run
--                     `supabase db push --include-all --linked` post-merge;
--                     CI applies migrations to local Supabase only)
--   • Memory note   — project_platform_cron_silent_failure.md (2 incidents
--                     in 3 weeks — prefer pg_cron for new scheduled SQL
--                     jobs)
--
-- ── Extensions ─────────────────────────────────────────────────────────────
-- pg_cron is pre-installed on every Supabase managed Postgres project,
-- so this is a no-op there. The `IF NOT EXISTS` keeps the migration
-- runnable against a fresh local Supabase stack where the extension
-- may need to be created. We do NOT also `CREATE EXTENSION pg_net` —
-- this job is pure SQL and makes no HTTP calls.
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

-- ── Function: public.reap_stale_pending_bookings() ─────────────────────────
-- Cancels every `pending_payment` booking that:
--   - has no stripe_payment_id (i.e. Stripe webhook never confirmed payment)
--   - has not been soft-deleted
--   - was created more than 35 minutes ago
-- Returns the count of rows reaped (lands in cron.job_run_details.return_message).
--
-- WHERE clause is byte-identical to the Vercel route's predicate set
-- (route.ts:98-101) — see the SAFETY comment on that route.
--
-- SECURITY DEFINER + owner=postgres: runs with superuser privileges,
-- bypassing RLS on `bookings`. This is the same trust boundary as the
-- Vercel route's `service_role` client; the function just moves it
-- inside the DB. `SET search_path = public, pg_catalog` is the Supabase
-- SECURITY DEFINER best practice — prevents a hijacked search_path
-- resolving `bookings` to a user-shadowed table.
--
-- We use a CTE `UPDATE … RETURNING id` wrapped in `SELECT count(*)` —
-- single statement, atomic, no SELECT-FOR-UPDATE-then-UPDATE race
-- window. Postgres's UPDATE already takes row-level locks on the
-- matched rows.
CREATE OR REPLACE FUNCTION public.reap_stale_pending_bookings()
RETURNS integer AS $$
DECLARE
  v_reaped integer;
BEGIN
  WITH reaped AS (
    UPDATE public.bookings
       SET status       = 'cancelled',
           cancelled_at = now()
     WHERE status              = 'pending_payment'
       AND stripe_payment_id   IS NULL
       AND deleted_at          IS NULL
       AND created_at          < now() - interval '35 minutes'
    RETURNING id
  )
  SELECT count(*) INTO v_reaped FROM reaped;

  RETURN v_reaped;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public, pg_catalog;

-- ── Permissions ────────────────────────────────────────────────────────────
-- Default Postgres grants EXECUTE on new functions to PUBLIC. We override:
-- - REVOKE FROM PUBLIC: standard Supabase posture, explicit grants only.
-- - GRANT TO service_role: lets the admin client call the RPC. Not
--   strictly required today (the Vercel manual-probe route still uses an
--   inline UPDATE), but makes a future "swap the route's UPDATE for an
--   `await admin.rpc('reap_stale_pending_bookings')` call" a 1-line
--   change. Also useful for ad-hoc DBA invocations during incidents.
-- - No GRANT to `authenticated` or `anon` — intentional security
--   boundary. An authenticated user must never be able to force-cancel
--   `pending_payment` rows; that would let any logged-in member bulk-
--   cancel paid-event seat holds.
-- - pg_cron itself runs the scheduled command as `postgres` (the role
--   that called `cron.schedule(...)` from this migration). `postgres`
--   is the function owner, so its EXECUTE is implicit and unaffected
--   by REVOKE FROM PUBLIC.
REVOKE EXECUTE ON FUNCTION public.reap_stale_pending_bookings() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.reap_stale_pending_bookings() TO   service_role;

-- ── Unschedule any existing job ────────────────────────────────────────────
-- `cron.unschedule(jobname)` raises if the job doesn't exist, so guard
-- it. Same idempotency pattern as `20260514070757`. Re-running this
-- migration won't double-schedule the job (which would harmlessly but
-- confusingly produce two parallel runs every 15 min in
-- `cron.job_run_details`).
--
-- Order matters: unschedule THEN schedule. Reversing the order would
-- unschedule the freshly-installed job on re-run.
DO $$
BEGIN
  PERFORM cron.unschedule('reap-stale-pending-bookings');
EXCEPTION WHEN OTHERS THEN
  -- No existing schedule — nothing to do.
  NULL;
END $$;

-- ── Schedule ───────────────────────────────────────────────────────────────
-- Every 15 minutes (UTC; pg_cron schedules don't auto-adjust for DST,
-- but that doesn't matter for a fixed-interval job). The function's
-- return value (`integer` row count) lands in
-- `cron.job_run_details.return_message`, giving free observability
-- without pg_net instrumentation.
--
-- Dollar-quoting (`$$ … $$`) on the command body so the inner SELECT
-- isn't escaped twice. Same convention as `20260514070757`.
SELECT cron.schedule(
  'reap-stale-pending-bookings',
  '*/15 * * * *',
  $$ SELECT public.reap_stale_pending_bookings(); $$
);

-- ── Apply-time notice ──────────────────────────────────────────────────────
-- One-shot reminder in the apply log so the operator sees the schedule
-- landed. Mirrors the daily-notifications migration's apply-time block,
-- but without the "missing setup" branches because there's nothing for
-- the operator to set up here.
DO $$
BEGIN
  RAISE NOTICE '---';
  RAISE NOTICE 'reap-stale-pending-bookings pg_cron schedule installed.';
  RAISE NOTICE 'Cadence: */15 * * * * (every 15 min, UTC). No operator setup required.';
  RAISE NOTICE 'Verify post-apply:';
  RAISE NOTICE '  SELECT jobname, schedule, active FROM cron.job WHERE jobname = ''reap-stale-pending-bookings'';';
  RAISE NOTICE '---';
END $$;
