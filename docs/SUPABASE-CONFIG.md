# Supabase Configuration Runbook

Non-default settings applied to the staging Supabase project via the
Management API. **These live outside git** — re-apply them when creating
the production project or restoring from a backup, otherwise core flows
(OTP, cron-driven emails, SMS) break or behave inconsistently.

Last reviewed: 2026-04-22.

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

```bash
# Log in to the CLI first (one-time, stores a token in your home dir):
supabase login

# Link the project (one-time per workstation):
supabase link --project-ref "$SUPABASE_PROJECT_REF"

# STAGING template — includes SANDBOX_FALLBACK_RECIPIENT. Remove the
# SANDBOX_* lines for production.
supabase secrets set \
  RESEND_API_KEY='re_...' \
  FROM_ADDRESS='The Social Seen <onboarding@resend.dev>' \
  REPLY_TO_ADDRESS='info@the-social-seen.com' \
  SANDBOX_FALLBACK_RECIPIENT='mitesh@skillmeup.co' \
  NEXT_PUBLIC_SITE_URL='https://the-social-seen.com' \
  UNSUBSCRIBE_TOKEN_SECRET='<32+ random bytes, base64 or hex>' \
  TWILIO_ACCOUNT_SID='AC...' \
  TWILIO_AUTH_TOKEN='...' \
  TWILIO_SENDER_ID='SocialSeen'
```

Verify via a manual invocation:

```bash
curl -s -X POST \
  "https://$SUPABASE_PROJECT_REF.supabase.co/functions/v1/daily-notifications" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  | jq '.'
```

Expect `{ "ok": true, "counts": { ... } }`.

---

## 3. pg_cron — daily schedule for the edge function

Configured once per environment via SQL editor (not the Management
API — it's regular postgres). Runs at 07:00 UTC every day.

```sql
-- Enable the extension (idempotent).
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Store the function URL + service-role JWT at the DB level so the
-- cron job can invoke the edge function without secrets leaking into
-- the job definition.
ALTER DATABASE postgres SET app.settings.edge_function_url =
  'https://<REF>.supabase.co/functions/v1/daily-notifications';
ALTER DATABASE postgres SET app.settings.service_role_key = '<service-role-jwt>';

-- The schedule itself lives in a migration (see
-- 20260421000004_schedule_daily_notifications.sql). Running the
-- migration creates / re-creates the job named 'daily-notifications'.
```

List scheduled jobs:

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

## 5. Resend domain verification (Sprint 1, P2-4)

Resend dashboard → Domains → add `the-social-seen.com` → copy the
three DNS records (SPF, DKIM, DMARC) to the domain registrar.
Verification typically takes 5 min – 48 h.

While unverified, Resend only sends to the account-owner address
(`mitesh@skillmeup.co`) and the codebase's `SANDBOX_FALLBACK_RECIPIENT`
auto-redirects all sends there.

Post-verification, update the FROM address:

```diff
// src/lib/email/config.ts
- export const FROM_ADDRESS = 'The Social Seen <onboarding@resend.dev>'
+ export const FROM_ADDRESS = 'The Social Seen <hello@the-social-seen.com>'
```

Also update `FROM_ADDRESS` in Supabase secrets (§2 above) so the
edge function uses the verified domain.

---

## 6. Twilio alphanumeric sender registration (optional — Phase 2.5 Batch 5)

Alphanumeric sender IDs work on-the-fly for UK without pre-registration,
but registered IDs get better deliverability on some UK carriers.

Twilio Console → Messaging → Senders → Alphanumeric Sender IDs → New.
Enter `SocialSeen`. Approval typically takes ~1 business day.

No env-var change on approval — the code already uses `SocialSeen`.

---

## Restoring to a fresh Supabase project

Sequence to re-apply all settings from scratch:

1. Create the new project via the Supabase dashboard.
2. Set `SUPABASE_PROJECT_REF` to the new project's ref.
3. Run §1 (auth config) via `curl`.
4. Apply migrations with `supabase db push`.
5. Deploy the edge function: `supabase functions deploy daily-notifications --no-verify-jwt`.
6. Run §2 (edge function secrets) with production values.
7. Run §3 (pg_cron SQL) in the SQL editor.
8. Point Stripe webhook (§4) at the new project's production domain.
9. Update Vercel envs: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
10. Verify end-to-end: sign up, verify email, book a test event, check
    Twilio + Resend logs, manually trigger daily-notifications.

Any step skipped will surface as "email didn't arrive" / "cron didn't
fire" / "webhook not received" later. Faster to re-apply front-to-back
than chase a single-symptom debug.
