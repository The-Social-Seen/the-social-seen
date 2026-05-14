# Supabase Configuration Runbook

Non-default settings applied to the staging Supabase project via the
Management API. **These live outside git** — re-apply them when creating
the production project or restoring from a backup, otherwise core flows
(OTP, cron-driven emails, SMS) break or behave inconsistently.

Last reviewed: 2026-05-14.

---

## Prerequisites

```bash
# From .env.local — account-owner token for the Management API.
# Paste the value into a shell var for the commands below.
export SUPABASE_ACCESS_TOKEN='...'

# The project ref is in your Supabase dashboard URL:
#   https://supabase.com/dashboard/project/<REF>
export SUPABASE_PROJECT_REF='<REF>'
```

---

## 1. Auth — OTP + autoconfirm settings (Sprint 1, P2-3)

Shorter 6-digit OTP (was 8) with a 10-minute expiry (was 60 minutes).
Autoconfirm stays `true` — the app-level verification flag lives on
`profiles.email_verified`, gated at the `book_event()` RPC.

```bash
curl -s -X PATCH "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/config/auth" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "mailer_otp_length": 6,
    "mailer_otp_exp": 600,
    "mailer_autoconfirm": true
  }'
```

Verify:

```bash
curl -s "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/config/auth" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  | jq '{mailer_otp_length, mailer_otp_exp, mailer_autoconfirm}'
```

Expect:

```json
{
  "mailer_otp_length": 6,
  "mailer_otp_exp": 600,
  "mailer_autoconfirm": true
}
```

---

## 2. Edge Function secrets (Sprint 2, P2-5 + Phase 2.5 Batch 5)

Secrets required by the `daily-notifications` edge function. Must be
set before the pg_cron schedule fires, otherwise the function logs
NOTICE and exits.

> ⚠️ **DO NOT set `SANDBOX_FALLBACK_RECIPIENT` (or `SMS_SANDBOX_FALLBACK_RECIPIENT`)
> in PRODUCTION.** Those env vars silently reroute every email / SMS
> to the listed address. Staging only. Drop the SANDBOX_* lines from
> the block below before running against production secrets.

> ⚠️ **`CRON_AUTH_TOKEN` is required.** It's the only auth path that
> works for the pg_cron caller on Supabase projects with the new API
> key system. See §3 below for the full explanation; for now, just
> remember it must be set, and it must be a legacy-JWT-format value
> (a long `eyJ…` string, not `sb_secret_…`). The legacy service-role
> JWT from `supabase projects api-keys --project-ref <ref>` is the
> conventional value.

```bash
# Log in to the CLI first (one-time, stores a token in your home dir):
supabase login

# Link the project (one-time per workstation):
supabase link --project-ref "$SUPABASE_PROJECT_REF"

# STAGING template — includes SANDBOX_FALLBACK_RECIPIENT. Remove the
# SANDBOX_* lines for production.
supabase secrets set \
  RESEND_API_KEY='re_...' \
  FROM_ADDRESS='The Social Seen <hello@the-social-seen.com>' \
  REPLY_TO_ADDRESS='info@the-social-seen.com' \
  SANDBOX_FALLBACK_RECIPIENT='mitesh@skillmeup.co' \
  NEXT_PUBLIC_SITE_URL='https://the-social-seen.com' \
  UNSUBSCRIBE_TOKEN_SECRET='<32+ random bytes, base64 or hex>' \
  CRON_AUTH_TOKEN='<legacy-service-role-JWT, eyJ...>' \
  TWILIO_ACCOUNT_SID='AC...' \
  TWILIO_AUTH_TOKEN='...' \
  TWILIO_SENDER_ID='SocialSeen'
```

Verify via a manual invocation. `Authorization: Bearer` accepts either
the auto-injected `SUPABASE_SERVICE_ROLE_KEY` (Dashboard / direct curl)
or the explicit `CRON_AUTH_TOKEN` set above (used by pg_cron):

```bash
curl -s -X POST \
  "https://$SUPABASE_PROJECT_REF.supabase.co/functions/v1/daily-notifications" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  | jq '.'
```

Expect `{ "ok": true, "counts": { ... } }`.

If the response is `{"code":"UNAUTHORIZED_INVALID_JWT_FORMAT","message":"Invalid JWT"}`
the gateway rejected your key format before the function ran — try
the legacy JWT from `supabase projects api-keys` instead of an
`sb_secret_*` value. If it's `{"error":"unauthorized"}` the function
received the request but the token didn't match either env var.

---

## 3. pg_cron — daily schedule for the edge function

The cron schedule itself lives in a migration —
`supabase/migrations/20260514070757_supersede_daily_notifications_schedule_with_vault_pattern.sql`
(which supersedes the original `20260421000004_schedule_daily_notifications.sql`).
Running migrations creates the job named `daily-notifications`.

The job's command body reads both the function URL and the auth token
from `vault.decrypted_secrets` at fire time. Two vault entries must
exist (alongside the `CRON_AUTH_TOKEN` env var from §2) for the cron
to actually invoke the function. Without them the job still runs daily
but no-ops with a `RAISE NOTICE`.

> ℹ️ **Why not `ALTER DATABASE SET app.settings.*`?**
> The original migration used database-level settings. On current
> Supabase cloud, `ALTER DATABASE postgres SET <parameter>` is blocked
> with `42501: permission denied to set parameter` for every role
> available to operators (`postgres`, `is_superuser=off`) — including
> via the Dashboard SQL editor and the Management API. Vault is the
> supported alternative; `vault.decrypted_secrets` is readable by the
> postgres role.

> ℹ️ **Why `CRON_AUTH_TOKEN` instead of just using `SUPABASE_SERVICE_ROLE_KEY`?**
> On projects with the new API key system, `SUPABASE_SERVICE_ROLE_KEY`
> is auto-injected in `sb_secret_*` format, which the Supabase gateway
> rejects before the function runs (`UNAUTHORIZED_INVALID_JWT_FORMAT`)
> — even though the function was deployed with `--no-verify-jwt`. `SUPABASE_*`
> env names are reserved by Supabase and can't be overridden, so a
> separate `CRON_AUTH_TOKEN` is the only way to give the function a
> JWT-format auth value that the gateway will let through. The
> function accepts either token; pg_cron uses the JWT-format one.
> See `project_supabase_gateway_key_format_inconsistency.md` for the
> full diagnostic trail (PR #105).

### One-time setup (per environment)

Run these in the Supabase SQL editor:

```sql
-- 1. Enable extensions (idempotent — migration also does this).
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS supabase_vault;

-- 2. Store the function URL in vault.
--    Replace <REF> with the project ref from the dashboard URL.
SELECT vault.create_secret(
  'https://<REF>.supabase.co/functions/v1/daily-notifications',
  'cron_edge_function_url',
  'URL of the daily-notifications Edge Function.'
);

-- 3. Store the auth token in vault. Use the SAME legacy-JWT value
--    you set as CRON_AUTH_TOKEN in §2 above.
SELECT vault.create_secret(
  '<legacy-service-role-JWT, eyJ...>',
  'cron_service_role_key',
  'Service role JWT used by daily-notifications cron.'
);
```

Then apply migrations (`supabase db push --include-all --linked`) so
the schedule itself lands.

### Post-setup verification

Trigger the function manually first, to prove the function + secrets
end-to-end:

```bash
curl -s -X POST \
  "https://$SUPABASE_PROJECT_REF.supabase.co/functions/v1/daily-notifications" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  | jq '.'
```

Then trigger the cron job's own command body once to prove that path
(reads from vault, sends auth token, function accepts). The least
invasive way is to temporarily change the schedule to "every minute",
wait for one run, then restore it:

```sql
-- Temporarily fire every minute:
SELECT cron.alter_job(
  job_id := (SELECT jobid FROM cron.job WHERE jobname = 'daily-notifications'),
  schedule := '* * * * *'
);
-- Wait ~60s, then check the most recent run:
SELECT status, return_message, start_time
FROM cron.job_run_details
WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'daily-notifications')
ORDER BY start_time DESC LIMIT 1;
-- Restore the daily schedule:
SELECT cron.alter_job(
  job_id := (SELECT jobid FROM cron.job WHERE jobname = 'daily-notifications'),
  schedule := '0 7 * * *'
);
```

Check the HTTP response that pg_net captured:

```sql
SELECT id, status_code, substring(content::text, 1, 200) AS body, created
FROM net._http_response ORDER BY created DESC LIMIT 5;
```

Expected status_code = 200. Then check that notifications rows actually
landed (will be zero unless you have a real event in the relevant
time window; the response code is the more reliable signal):

```sql
SELECT template_name, COUNT(*)
FROM public.notifications
WHERE created_at > now() - interval '5 minutes'
GROUP BY 1;
```

### Inspect the schedule

```sql
SELECT jobname, schedule, active FROM cron.job;
```

---

## 4. Stripe webhook subscription (Sprint 2, P2-7)

Stripe test-mode dashboard → Developers → Webhooks → **Add endpoint**.

- URL: `https://<preview-or-prod>/api/stripe/webhook`
- Events: **`checkout.session.completed`** AND **`charge.refunded`**
  (both required — missing either breaks paid-booking confirmation
  or refund reconciliation).
- Copy the signing secret → Vercel env `STRIPE_WEBHOOK_SECRET`
  (Preview + Production).

For local dev:
```bash
stripe listen --forward-to localhost:6500/api/stripe/webhook
# prints a whsec_... — paste into .env.local for the session
```

Restricted key scopes (if using rotating restricted keys):
Checkout Sessions Write, PaymentIntents Read, Refunds Write,
Customers Write.

---

## 5. Email FROM_ADDRESS — current state + rotation runbook

**Status (2026-04-28):** Domain `the-social-seen.com` is verified at
Resend (SPF / DKIM / DMARC / MX records at the domain registrar).
FROM_ADDRESS is `'The Social Seen <hello@the-social-seen.com>'` in
both code paths:

- Next.js app — `src/lib/email/config.ts:27` (constant; pinned by
  Vitest regression test at `src/lib/email/__tests__/config.test.ts`)
- Supabase Edge Function — `supabase/functions/daily-notifications/index.ts`
  fallback (overridden by the `FROM_ADDRESS` supabase secret when set;
  setting the secret takes precedence)

**Supabase Auth SMTP** is also routed through Resend (verified by
checking the `From` header on a signup-verification email — reads
`hello@the-social-seen.com`, not the Supabase default
`noreply@mail.app.supabase.io`). Configured in Supabase dashboard →
Authentication → SMTP Settings (host `smtp.resend.com`, port 465,
username `resend`, password = a Resend API key).

### Rotation runbook (Resend account swap, key rotation, fresh project)

When you rotate the Resend API key, swap to a new Resend account, or
spin up a fresh Supabase project, run these steps in order:

```bash
# 1. Verify the current state of supabase secrets:
supabase secrets list --project-ref "$SUPABASE_PROJECT_REF"
# Look for FROM_ADDRESS. The env var takes precedence over the in-code
# fallback when set; if it's set to anything @resend.dev or unset,
# step 2 is required.

# 2. Set FROM_ADDRESS to the verified-domain sender:
supabase secrets set \
  "FROM_ADDRESS=The Social Seen <hello@the-social-seen.com>" \
  --project-ref "$SUPABASE_PROJECT_REF"

# 3. Re-deploy the edge function so the in-code fallback is current
#    AND the env var change takes effect on next invocation:
supabase functions deploy daily-notifications --project-ref "$SUPABASE_PROJECT_REF"

# 4. Verify both code paths actually deliver in production (the canary
#    is the only thing that proves rotation worked end-to-end —
#    unit tests pin format, not delivery):
#    Path A — Next.js webhook side (booking confirmation):
#      Sign up as a non-account-owner inbox → book a free event →
#      check inbox + Resend → Logs status='delivered'
#    Path B — Edge Function side (cron / manual invoke):
#      Supabase dashboard → Functions → daily-notifications → Invoke
#      with `{}` payload → check Resend → Logs status='delivered'

# 5. Also re-paste the Resend API key into Supabase Auth SMTP settings
#    if it was rotated — that's a separate password field in the
#    dashboard, not part of `supabase secrets`.
```

### Why this exists

The 2026-04-28 incident silently broke transactional email for ~24h
because `FROM_ADDRESS` was hardcoded to `onboarding@resend.dev`
(Resend's sandbox sender — only delivers to the account owner).
Anyone rotating Stripe / Resend / any other third-party account
should walk the broader rotation checklist in
`memory/project_account_rotation_cascade_pattern.md` (item #3 covers
Auth SMTP specifically).

### Adding a fresh sending domain (one-time per project)

For a brand-new Supabase / Resend project:

1. Resend dashboard → Domains → add `the-social-seen.com` → copy the
   SPF, DKIM, DMARC, and MX records to the domain registrar.
2. Wait for all four checks to go green (typically 5 min – 48 h).
3. Run the rotation runbook above with the new project ref.
4. Update the `FROM_ADDRESS` constant in `src/lib/email/config.ts`
   AND the Edge Function fallback in
   `supabase/functions/daily-notifications/index.ts` if the verified
   domain differs from `the-social-seen.com`. The Vitest config-shape
   regression test will fail otherwise.

---

## 6. Twilio alphanumeric sender registration (optional — Phase 2.5 Batch 5)

Alphanumeric sender IDs work on-the-fly for UK without pre-registration,
but registered IDs get better deliverability on some UK carriers.

Twilio Console → Messaging → Senders → Alphanumeric Sender IDs → New.
Enter `SocialSeen`. Approval typically takes ~1 business day.

No env-var change on approval — the code already uses `SocialSeen`.

---

## 7. Migration authoring caveats

### `ALTER TYPE … ADD VALUE` is unsafe inside `supabase db push` migrations

Postgres rule: `ALTER TYPE <enum> ADD VALUE …` cannot run inside a transaction in older PG versions, and even on PG 15+ the new value is not visible inside the same transaction it was added. `supabase db push` wraps each migration in an implicit `BEGIN … COMMIT`, so this DDL can be silently swallowed: the migration is recorded in `schema_migrations` as applied, but the enum value never actually lands.

**Symptom seen on this project (2026-04-26):** `20260406000001_add_activity_category.sql` applied cleanly on local + CI, was recorded in `schema_migrations` on hosted, but `pg_enum` on hosted only showed 8 values for `event_category`. Surfaced months later when a downstream trigger function cast a string to `'activity'::event_category` and got `22P02 invalid input value`. Fixed via a manual `ALTER TYPE … ADD VALUE` in the SQL editor + a forward-fix migration `20260505000001_repair_activity_category_enum.sql`.

**How to author safely from now on:**

- **Don't put `ALTER TYPE … ADD VALUE` in a regular migration.** It works often enough to not look broken, but you can't trust the apply.
- **Instead, add the new enum value via the Supabase SQL editor** (a single statement, not wrapped in any transaction) when shipping the change. Document the manual step in the relevant runbook / batch handover.
- **In the migration that depends on the new value**, add a defensive `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE …) THEN RAISE EXCEPTION …; END IF; END $$;` block at the top so a future fresh apply against an environment missing the value fails loudly instead of silently corrupting.
- **For the durable forward-fix that protects future fresh applies** (CI on a clean DB, restored backup, brand-new staging project), include the `ALTER TYPE … ADD VALUE IF NOT EXISTS` in a follow-up migration anyway. It will be a no-op where the value is already present, and the rare case where it isn't (e.g. backup-restore that predates the manual fix) is the exact case it's there for.

### Verifying enum changes actually committed

After any migration that adds an enum value, run this in the SQL editor and confirm the new value appears:

```sql
SELECT enumlabel FROM pg_enum
WHERE enumtypid = '<schema>.<enum_type>'::regtype
ORDER BY enumsortorder;
```

If it doesn't, follow the pattern above (manual `ALTER TYPE` in SQL editor + forward-fix migration) before any code referencing the new value ships.

### Other authoring gotchas (additive — extend as discovered)

- **Triggers that reference enum values cast at runtime** install successfully even if the enum value doesn't exist (PL/pgSQL is lazy-compiled). The error only surfaces when the trigger fires. Combine with the verification step above to catch this at apply-time, not under live traffic.

---

## Restoring to a fresh Supabase project

Sequence to re-apply all settings from scratch:

1. Create the new project via the Supabase dashboard.
2. Set `SUPABASE_PROJECT_REF` to the new project's ref.
3. Run §1 (auth config) via `curl`.
4. Deploy the edge function: `supabase functions deploy daily-notifications --no-verify-jwt`.
5. Run §2 (edge function secrets) with production values — **including
   `CRON_AUTH_TOKEN`**.
6. Run §3's one-time setup (the two `vault.create_secret` calls) in the
   SQL editor. Use the SAME JWT value for `cron_service_role_key` that
   you set as `CRON_AUTH_TOKEN` in step 5.
7. Apply migrations with `supabase db push --include-all --linked`.
   This installs the cron schedule. Steps 5 + 6 must already be in
   place or the cron fires daily and no-ops with a NOTICE.
8. Point Stripe webhook (§4) at the new project's production domain.
9. Update Vercel envs: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
10. Verify end-to-end: sign up, verify email, book a test event, check
    Twilio + Resend logs, manually trigger daily-notifications (§3's
    "Post-setup verification" block).

Any step skipped will surface as "email didn't arrive" / "cron didn't
fire" / "webhook not received" later. Faster to re-apply front-to-back
than chase a single-symptom debug.
