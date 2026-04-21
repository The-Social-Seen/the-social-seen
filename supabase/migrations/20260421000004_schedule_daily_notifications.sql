-- Migration: schedule_daily_notifications (P2-5)
--
-- Schedules the `daily-notifications` Supabase Edge Function to run once a
-- day. The function handles:
--   • Venue reveals (events 7 days out: email + flip venue_revealed = true)
--   • 2-day reminders
--   • Day-of reminders
--   • Review requests (day after the event)
--   • Retry of recent failed email notifications
--
-- Runs at 07:00 UTC — which is 07:00 London in winter (GMT = UTC) and
-- 08:00 London in summer (BST = UTC+1). pg_cron schedules are UTC and
-- don't auto-adjust for DST. This lands reminder emails in inboxes at a
-- reasonable early-morning window year-round; revisit if the skew between
-- winter 07:00 and summer 08:00 matters for open rates.
--
-- ── Operator setup required before this migration is useful ────────────────
-- After this migration is applied on a fresh project, the operator MUST set
-- two Postgres settings that the cron job reads at runtime:
--
--   ALTER DATABASE postgres SET app.settings.edge_function_url =
--     'https://<project-ref>.supabase.co/functions/v1/daily-notifications';
--
--   ALTER DATABASE postgres SET app.settings.service_role_key =
--     '<service-role-jwt>';
--
-- (The service role key is the JWT — NOT the anon key, and NOT logged in
-- git. Read it from .env.local locally or from the Vercel dashboard.)
--
-- If either setting is unset when the job fires, the DO block below RAISES
-- a NOTICE and returns — no HTTP call is made, so nothing breaks. This is
-- intentional: applying this migration on a fresh project shouldn't fail;
-- the operator finishes setup afterwards.
--
-- To deploy the edge function itself, run:
--   supabase functions deploy daily-notifications --no-verify-jwt
-- (--no-verify-jwt because the function does its own service-role check.)
--
-- And set the function's secrets:
--   supabase secrets set RESEND_API_KEY=re_... \
--                        FROM_ADDRESS='The Social Seen <onboarding@resend.dev>' \
--                        SANDBOX_FALLBACK_RECIPIENT=mitesh@skillmeup.co \
--                        REPLY_TO_ADDRESS=info@the-social-seen.com \
--                        NEXT_PUBLIC_SITE_URL=https://the-social-seen.vercel.app
--
-- ── Extensions ─────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_cron  WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net   WITH SCHEMA extensions;

-- ── Schedule (idempotent: unschedule + reschedule) ─────────────────────────
-- cron.unschedule errors if the job doesn't exist, so guard it.
DO $$
BEGIN
  PERFORM cron.unschedule('daily-notifications');
EXCEPTION WHEN OTHERS THEN
  -- No existing schedule — nothing to do.
  NULL;
END $$;

SELECT cron.schedule(
  'daily-notifications',
  '0 7 * * *',  -- 07:00 UTC daily (= 07:00 London GMT / 08:00 London BST)
  $cron$
  DO $body$
  DECLARE
    v_url  text := current_setting('app.settings.edge_function_url', true);
    v_key  text := current_setting('app.settings.service_role_key',  true);
  BEGIN
    IF v_url IS NULL OR v_url = '' OR v_key IS NULL OR v_key = '' THEN
      RAISE NOTICE 'daily-notifications skipped: app.settings.edge_function_url or app.settings.service_role_key is not set';
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
