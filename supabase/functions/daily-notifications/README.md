# daily-notifications

Supabase Edge Function that sends venue-reveal, reminder, and review-request emails to event attendees. Triggered daily by a `pg_cron` job (see migration `20260421000004_schedule_daily_notifications.sql`).

## What it does (per run)

1. **Venue reveals** — events with `venue_revealed = false` whose `date_time` is within the next 7 days: email every confirmed attendee with the venue + Google Maps link, then flip `venue_revealed = true`.
2. **2-day reminders** — events whose London-local date is today + 2.
3. **Day-of reminders** — events whose London-local date is today.
4. **Review requests** — events whose London-local date is today − 1.
5. **Retry** — re-sends `notifications` rows with `channel='email'`, `status='failed'`, `created_at > now() - interval '3 days'`, `retried_at` null or older than 12 hours.

Idempotency: every attempted send reserves a `notifications` row with a `dedupe_key` backed by a partial `UNIQUE` index. Re-runs on the same day no-op.

## Deploy

```bash
set -a && source .env.local && set +a
supabase functions deploy daily-notifications --no-verify-jwt
```

`--no-verify-jwt` because the function does its own service-role check in `index.ts` (Supabase's default JWT verification would reject the Postgres-cron caller).

## Secrets

```bash
supabase secrets set \
  RESEND_API_KEY=re_... \
  FROM_ADDRESS='The Social Seen <onboarding@resend.dev>' \
  REPLY_TO_ADDRESS=info@the-social-seen.com \
  SANDBOX_FALLBACK_RECIPIENT=mitesh@skillmeup.co \
  NEXT_PUBLIC_SITE_URL=https://the-social-seen.vercel.app
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected by the Supabase runtime automatically.

In production, leave `SANDBOX_FALLBACK_RECIPIENT` unset (or set to empty string) so mail flows to real recipients.

## pg_cron wiring

After deploying the function, set the two Postgres settings the cron job reads (one-time per project):

```sql
ALTER DATABASE postgres SET app.settings.edge_function_url =
  'https://<project-ref>.supabase.co/functions/v1/daily-notifications';

ALTER DATABASE postgres SET app.settings.service_role_key =
  '<service-role-jwt>';
```

If these aren't set, the cron job RAISES a NOTICE and exits without calling the function — safe to apply the migration on a fresh project before setup is finished.

## Manual invocation (backfill or test)

```bash
curl -X POST "$NEXT_PUBLIC_SUPABASE_URL/functions/v1/daily-notifications" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"source":"manual"}'
```

Response:
```json
{
  "ok": true,
  "counts": {
    "venue_reveals": 0,
    "reminders_2day": 3,
    "reminders_today": 12,
    "review_requests": 8,
    "retries": 0
  }
}
```

## Template parity

The function has its own copy of the email templates in `templates.ts` (Deno-side). These mirror `src/lib/email/templates/{venue-reveal,event-reminder,review-request}.ts`. The Node versions are the ones the Vitest suite exercises — if you change rendering, update both. (Unit tests on the Node side catch rendering regressions since output is structurally identical.)
