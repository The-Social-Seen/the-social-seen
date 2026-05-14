-- Migration: supersede_daily_notifications_schedule_with_vault_pattern
--
-- Supersedes 20260421000004_schedule_daily_notifications.sql.
--
-- ── Why ────────────────────────────────────────────────────────────────────
-- The original migration teaches operators to configure the cron job's URL +
-- service-role JWT via `ALTER DATABASE postgres SET app.settings.*`. On
-- current Supabase cloud, that statement is blocked with
-- `42501: permission denied to set parameter` for every role available to
-- operators (postgres, is_superuser=off) — including via the Dashboard SQL
-- editor and the Management API. The original setup path no longer works.
--
-- Compounding that, the daily-notifications Edge Function on projects with
-- the new API key system can't be authenticated by the auto-injected
-- SUPABASE_SERVICE_ROLE_KEY alone: the gateway rejects `sb_secret_*` format
-- Authorization headers as UNAUTHORIZED_INVALID_JWT_FORMAT before they reach
-- the function. PR #105 added an explicit `CRON_AUTH_TOKEN` fallback env on
-- the function — pg_cron sends a legacy-JWT-format token, gateway accepts,
-- function matches against CRON_AUTH_TOKEN. The cron's command body had to
-- change in concert to read that JWT from somewhere other than a database
-- setting (because `ALTER DATABASE … SET` is blocked).
--
-- The supported alternative is `supabase_vault`. The `vault` schema is
-- pre-installed on every Supabase project and readable by the postgres role
-- via `vault.decrypted_secrets`. This migration re-schedules the cron with
-- a command body that pulls BOTH the function URL AND the service-role JWT
-- from vault, so neither value is hardcoded in this file and neither relies
-- on the blocked ALTER DATABASE pattern.
--
-- ── Operator setup required before this cron will fire successfully ────────
-- After this migration is applied on a fresh project, three things must be
-- in place. The migration succeeds without them — the cron just no-ops
-- (RAISE NOTICE on each missing piece) until they're set.
--
--   1. Edge Function env (via `supabase secrets set`):
--        CRON_AUTH_TOKEN=<legacy-service-role-JWT, ~232 chars, eyJ...>
--      (Use the legacy JWT format. SUPABASE_* env names are reserved and
--      can't be overridden, so this is a separate variable.)
--
--   2. Vault secret — the same JWT, stored for the cron job to read:
--        SELECT vault.create_secret(
--          '<legacy-service-role-JWT>',
--          'cron_service_role_key',
--          'Service role JWT used by daily-notifications cron.'
--        );
--
--   3. Vault secret — the function URL (project-ref specific):
--        SELECT vault.create_secret(
--          'https://<project-ref>.supabase.co/functions/v1/daily-notifications',
--          'cron_edge_function_url',
--          'URL of the daily-notifications Edge Function.'
--        );
--
-- On the current prod project (omabvqhvcdzngeiriiii) the cron has been
-- live-altered via `cron.alter_job` to match this command-body shape since
-- PR #105 was merged. Vault entry #2 already exists; vault entry #3 may
-- need to be created before this migration is applied to prod (the cron
-- will no-op cleanly if the URL is missing — it doesn't crash). The
-- DO/RAISE-NOTICE block at the bottom of this migration prints a reminder
-- in the apply log so the operator can't miss it.
--
-- On a fresh project, all three setup steps must be done; until they are,
-- the cron fires daily and exits with a NOTICE.
--
-- ── References ─────────────────────────────────────────────────────────────
--   • PR #105 — Edge Function CRON_AUTH_TOKEN fallback
--   • Memory: project_supabase_gateway_key_format_inconsistency.md
--   • Memory: project_migration_apply_step.md (post-merge `supabase db push`)
--   • docs/SUPABASE-CONFIG.md §2 + §3 (operator runbook)
--
-- ── Extensions ─────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_cron  WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net   WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS supabase_vault;

-- ── Unschedule any existing job ────────────────────────────────────────────
-- cron.unschedule errors if the job doesn't exist, so guard it. This is
-- the same idempotency pattern the original migration used.
DO $$
BEGIN
  PERFORM cron.unschedule('daily-notifications');
EXCEPTION WHEN OTHERS THEN
  -- No existing schedule — nothing to do.
  NULL;
END $$;

-- ── Reschedule with the vault-based command body ───────────────────────────
-- Runs at 07:00 UTC every day (= 07:00 London GMT / 08:00 London BST).
-- pg_cron schedules are static UTC strings; they don't auto-adjust for DST.
--
-- The DO block reads both secrets from `vault.decrypted_secrets`. If either
-- is missing or empty, RAISE NOTICE and return — no HTTP call is made. The
-- cron job stays "succeeded" in `cron.job_run_details` because the script
-- itself didn't error; the notice is what tells the operator setup is
-- incomplete. (Behaviour mirrors the original migration's missing-settings
-- guard, just sourced from vault instead of database settings.)
SELECT cron.schedule(
  'daily-notifications',
  '0 7 * * *',  -- 07:00 UTC daily (= 07:00 London GMT / 08:00 London BST)
  $cron$
  DO $body$
  DECLARE
    v_url  text;
    v_key  text;
  BEGIN
    SELECT decrypted_secret INTO v_url
      FROM vault.decrypted_secrets
      WHERE name = 'cron_edge_function_url';
    SELECT decrypted_secret INTO v_key
      FROM vault.decrypted_secrets
      WHERE name = 'cron_service_role_key';

    IF v_url IS NULL OR v_url = '' THEN
      RAISE NOTICE 'daily-notifications skipped: cron_edge_function_url not found in vault';
      RETURN;
    END IF;
    IF v_key IS NULL OR v_key = '' THEN
      RAISE NOTICE 'daily-notifications skipped: cron_service_role_key not found in vault';
      RETURN;
    END IF;

    PERFORM net.http_post(
      url := v_url,
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || v_key
      ),
      body := jsonb_build_object('source', 'pg_cron'),
      timeout_milliseconds := 60000
    );
  END;
  $body$;
  $cron$
);

-- ── Apply-time reminder for the operator ──────────────────────────────────
-- The migration above succeeds whether or not the vault secrets exist
-- (cron job is installed; it just no-ops until both secrets land). Print
-- a one-shot reminder in the apply log so operators on a fresh project,
-- or operators applying this for the first time to a project where only
-- `cron_service_role_key` was created, notice that they may need to add
-- `cron_edge_function_url`.
DO $$
BEGIN
  RAISE NOTICE '---';
  RAISE NOTICE 'daily-notifications cron installed.';
  RAISE NOTICE 'Required vault secrets (create via Supabase SQL editor if missing):';
  RAISE NOTICE '  SELECT vault.create_secret(''https://<ref>.supabase.co/functions/v1/daily-notifications'', ''cron_edge_function_url'');';
  RAISE NOTICE '  SELECT vault.create_secret(''<legacy-service-role-JWT>'', ''cron_service_role_key'');';
  RAISE NOTICE 'Required Edge Function env: CRON_AUTH_TOKEN=<same JWT>';
  RAISE NOTICE 'Until these exist, the cron fires daily and no-ops with a NOTICE.';
  RAISE NOTICE '---';
END $$;
