-- Migration: schedule_pending_payment_reminder
--
-- Schedules the pending_payment abandoned-checkout reminder inside
-- Postgres via pg_cron + pg_net + vault, mirroring
-- 20260514070757_supersede_daily_notifications_schedule_with_vault_pattern.sql
-- exactly (same three extensions, same vault-secret-read-then-http_post
-- DO block shape) but pointed at a NEW Edge Function
-- (supabase/functions/pending-payment-reminder) and a NEW vault secret
-- for that function's URL. Reuses the EXISTING cron_service_role_key
-- vault secret verbatim — same JWT, any Edge Function requiring
-- service-role bearer auth accepts it.
--
-- ── Why NOT folded into reap_stale_pending_bookings()'s own schedule ───────
-- Rejected alternative: append a pg_net call to the reaper's SQL function
-- so one cron tick does both jobs. Rejected because the reaper's own
-- migration explicitly advertises "zero operator setup... no vault, no
-- env vars, no pg_net, no JWT" as a load-bearing safety property — it is
-- deliberately dependency-free so a vault/pg_net/Edge-Function outage can
-- NEVER stop seats from being correctly freed. Coupling a nice-to-have
-- reminder email into that function would trade away that property for
-- no real benefit. Two independent jobs, two independent failure modes,
-- same cadence.
--
-- ── Operator setup required before this cron will fire successfully ────────
-- RESEND_API_KEY / FROM_ADDRESS / REPLY_TO_ADDRESS / CRON_AUTH_TOKEN /
-- NEXT_PUBLIC_SITE_URL are ALREADY set project-wide (daily-notifications
-- setup) — nothing to do there. The ONLY new step:
--   SELECT vault.create_secret(
--     'https://<project-ref>.supabase.co/functions/v1/pending-payment-reminder',
--     'cron_pending_payment_reminder_url',
--     'URL of the pending-payment-reminder Edge Function.'
--   );
-- Until that secret exists, the cron fires every 15 min and no-ops with
-- a RAISE NOTICE (same "succeeds without them" posture as the daily job).
--
-- ── Post-merge ────────────────────────────────────────────────────────────
-- CI applies migrations to local Supabase only. After merge run manually:
--   supabase db push --include-all --linked
-- (per project_migration_apply_step memory note — ship this together
-- with 20260808000001, in that order; no hard DB dependency between them
-- but the Edge Function needs the column from that migration to be
-- meaningfully useful.)
--
-- ── Extensions ─────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_cron       WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net        WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS supabase_vault;

-- ── Unschedule any existing job ────────────────────────────────────────────
DO $$
BEGIN
  PERFORM cron.unschedule('pending-payment-reminder');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- ── Schedule ───────────────────────────────────────────────────────────────
-- Every 15 minutes — see SYSTEM-DESIGN-pending-payment-visibility.md §3
-- for why this cadence is safely below the reaper's 35-minute floor. The
-- eligibility predicate (IS NULL sent-at + age >= 15 min, no upper
-- bound) is robust to a missed/delayed tick, so exact phase relative to
-- the reaper's own schedule doesn't matter.
SELECT cron.schedule(
  'pending-payment-reminder',
  '*/15 * * * *',
  $cron$
  DO $body$
  DECLARE
    v_url  text;
    v_key  text;
  BEGIN
    SELECT decrypted_secret INTO v_url
      FROM vault.decrypted_secrets
      WHERE name = 'cron_pending_payment_reminder_url';
    SELECT decrypted_secret INTO v_key
      FROM vault.decrypted_secrets
      WHERE name = 'cron_service_role_key';

    IF v_url IS NULL OR v_url = '' THEN
      RAISE NOTICE 'pending-payment-reminder skipped: cron_pending_payment_reminder_url not found in vault';
      RETURN;
    END IF;
    IF v_key IS NULL OR v_key = '' THEN
      RAISE NOTICE 'pending-payment-reminder skipped: cron_service_role_key not found in vault';
      RETURN;
    END IF;

    PERFORM net.http_post(
      url := v_url,
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || v_key
      ),
      body := jsonb_build_object('source', 'pg_cron'),
      timeout_milliseconds := 30000
    );
  END;
  $body$;
  $cron$
);

DO $$
BEGIN
  RAISE NOTICE '---';
  RAISE NOTICE 'pending-payment-reminder cron installed (every 15 min).';
  RAISE NOTICE 'Required NEW vault secret (create via Supabase SQL editor if missing):';
  RAISE NOTICE '  SELECT vault.create_secret(''https://<ref>.supabase.co/functions/v1/pending-payment-reminder'', ''cron_pending_payment_reminder_url'');';
  RAISE NOTICE 'Reuses existing cron_service_role_key secret and existing RESEND_API_KEY/FROM_ADDRESS/CRON_AUTH_TOKEN Edge Function env — no other new setup.';
  RAISE NOTICE 'Until the URL secret exists, the cron fires every 15 min and no-ops with a NOTICE.';
  RAISE NOTICE '---';
END $$;
