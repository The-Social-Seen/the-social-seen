# Sprint 1 Handover — for Sprint 2 (fresh session)

**Date:** 2026-04-21 (end of Sprint 1)
**Last commit on main:** `1de5a4a` — feat: Sprint 1 P2-4 — transactional email via Resend (#15)
**Test baseline:** 809 tests passing
**Branch:** all work on feature branches → squash-merged → branches deleted. Local repo clean on `main`.

This doc exists because the Sprint 1 build session is running out of context. Read this top-to-bottom before starting Sprint 2 in a fresh session — it captures the **non-obvious state** that isn't visible from reading code alone.

---

## What was built in Sprint 1 (4 batches, all merged)

### P2-1 — Auth state fix + password reset (#12)
- Fixed Header bug where users saw "Sign In" after logging in. Root cause: `createBrowserClient()` was being called multiple times across components, fragmenting auth state. Made `src/lib/supabase/client.ts` a **singleton**.
- Built `/forgot-password` and `/reset-password` pages with the same auth-page design language.
- Server Actions: `requestPasswordReset()` (no account enumeration), `updatePassword()`.
- Email currently goes through Supabase's built-in mailer; will move to Resend later (in FOLLOW-UPS).

### P2-2 — Registration enhancements (#13)
- New columns on `profiles`: `phone_number`, `email_consent`, `email_verified`, `status`. Plus `user_status` enum.
- `signUp()` Server Action signature: now requires `phoneNumber: string` and `emailConsent: boolean`.
- Phone field + GDPR consent checkbox added to Step 1 of `/join`.
- **Critical follow-up that landed:** column-level GRANT/REVOKE on `profiles` so anon REST callers can no longer read `phone_number`, `email_consent`, `email_verified`. Migration `20260420000003`.
- See "Profiles RLS — secure by default" below for the model going forward.

### P2-3 — Email verification via OTP (#14)
- 6-digit OTP gates **booking, not signup**. Users can complete signup and browse without verifying.
- New `/verify` page using extracted `<OtpDigits>` component. Auto-send on mount, 60s resend countdown, paste-to-fill, backspace nav.
- `<UnverifiedBanner>` on member pages + event detail. `<VerifyPromptModal>` intercepts booking attempts by unverified users.
- **Server-side enforcement:** `book_event()` RPC migration `20260420000004` rejects unverified callers with "Verify your email before booking".
- Supabase Auth config tweaked via Management API: `mailer_otp_length: 6` (was 8), `mailer_otp_exp: 600` (was 3600). `mailer_autoconfirm: True` **unchanged — this is deliberate**.
- New shared util: `src/lib/utils/redirect.ts` `sanitizeRedirectPath()`. Used by login + verify forms; replaces inline open-redirect logic.

### P2-4 — Transactional email via Resend (#15)
- Resend account live, API key in `.env.local`. **Domain not yet verified** — see "Resend sandbox status" below.
- New module `src/lib/email/`:
  - `config.ts` — `FROM_ADDRESS`, `REPLY_TO_ADDRESS`, `SANDBOX_FALLBACK_RECIPIENT` (env-gated)
  - `resend.ts` — singleton client
  - `send.ts` — typed `sendEmail()` wrapper: sandbox redirect, retry-once, audit logging via admin client. Never throws.
  - `templates/_shared.ts` — render helpers + `htmlToText` + escape utilities. **Hardcoded brand hex values here are a deliberate exception** (email clients don't support CSS variables). Documented in CLAUDE.md.
  - `templates/welcome.ts`, `booking-confirmation.ts`, `otp-verification.ts` (built but not yet wired to Supabase OTP — in FOLLOW-UPS).
- Migration `20260421000001` extends `notifications` table for email audit logging. New columns: `channel`, `status`, `recipient_email`, `provider_message_id`, `error_message`, `template_name`. `sent_by` made nullable for system emails.
- Wired into `completeOnboarding()` (welcome) and `createBooking()` (confirmation).
- New `vitest.setup.ts` globally mocks `server-only` so test files don't need per-file mocks. **Trade-off documented in the file** — Client Component tests that accidentally import server-only modules won't fail in vitest, only at Next.js build.

---

## Critical state that isn't visible in the code

### 1. Resend sandbox status (BLOCKING for demo)

**Current state:**
- API key works, account email is `mitesh@skillmeup.co`.
- Sandbox mode = **Resend rejects sends to ANY recipient other than `mitesh@skillmeup.co`** with HTTP 403 `validation_error`. Not a per-account allowlist — literally only the account owner.
- All sends are auto-redirected to `mitesh@skillmeup.co` via `SANDBOX_FALLBACK_RECIPIENT` in `config.ts`. Subject is prefixed `[→ original@example.com]` so we can see who it would have gone to in prod.
- Sandbox FROM is `onboarding@resend.dev`.

**Pending action (cofounder):** add 3 DNS records (SPF, DKIM, DMARC) to `the-social-seen.com`. Resend dashboard has the exact records.

**When DNS verifies, two single-line changes:**
```diff
// src/lib/email/config.ts
- export const FROM_ADDRESS = 'The Social Seen <onboarding@resend.dev>'
+ export const FROM_ADDRESS = 'The Social Seen <hello@the-social-seen.com>'
```

`SANDBOX_FALLBACK_RECIPIENT` is already gated to `undefined` when `NODE_ENV === 'production'`, so prod automatically routes to real recipients once domain is verified — no code change needed for that.

### 2. Profiles RLS — "secure by default" model

After P2-2 + the GDPR follow-up, `public.profiles` has an unusual access pattern:

- **Row-level RLS:** `USING (true)` for SELECT — anyone (even anon) can SELECT rows.
- **Column-level GRANT to anon:** only safe non-PII columns (`id, email, full_name, avatar_url, job_title, company, industry, bio, linkedin_url, role, onboarding_complete, referral_source, status, created_at, updated_at, deleted_at`). PII columns (`phone_number, email_consent, email_verified`) are REVOKEd.
- **Column-level GRANT to authenticated:** ALL columns.

**Implication for future migrations:** when adding a column to `profiles`, **decide explicitly whether anon should see it**. The default is "no" (column won't be in the GRANT list, anon callers get HTTP 401 if they request it). Document the decision in the migration header.

CLAUDE.md should be updated with a checklist line about this — currently in `docs/FOLLOW-UPS.md` as a pending action.

### 3. Supabase Auth Management API config

These settings are live on staging but **not represented in git**. Will need to re-apply when you create the production Supabase project:

```
mailer_otp_length: 6
mailer_otp_exp: 600
mailer_autoconfirm: True  (deliberate — users get usable session at signup, OTP gates booking only)
```

Apply via:
```bash
curl -s -X PATCH "https://api.supabase.com/v1/projects/<project-ref>/config/auth" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"mailer_otp_length": 6, "mailer_otp_exp": 600}'
```

Captured in `docs/FOLLOW-UPS.md` — recommend creating a `docs/SUPABASE-CONFIG.md` runbook eventually.

### 4. Auth & email_verified mental model

- `auth.users.email_confirmed_at` is **always set** because `mailer_autoconfirm: True`. **Don't use it** as the verification signal — it's useless for our purposes.
- `profiles.email_verified` is the **app-level signal**, set to `true` only by `verifyEmailOtp()` after a successful 6-digit OTP check.
- `book_event()` RPC checks `email_verified` server-side. Client-side gate (`<VerifyPromptModal>`) is for UX; the server-side check is the authoritative enforcement.

### 5. Migration history quirk

Migration `20260420000002` contains both a trigger fix (which works) AND a column-level REVOKE (which was a no-op due to Postgres semantics — table-level GRANTs subsume narrower REVOKEs). The follow-up `20260420000003` does the access control fix correctly with broad-revoke + narrow-grant.

If you read `20260420000002` standalone you'll be confused. The header of `20260420000003` explains the sequence. Don't try to "fix" `20260420000002` — modifying applied migrations is forbidden.

---

## Credentials & accounts

All keys live in `.env.local` (gitignored). `.env.example` documents the shape. **Account ownership matters because some services tie features to the account email.**

| Service | Account email | What we use it for | Notes |
|---------|---------------|-------------------|-------|
| Supabase | mitesh50@hotmail.com (admin user); project owner is the same account | Database, auth, storage | One project so far (staging). Need a separate production project later. |
| Sentry | TBC (just `social-seen-dt` org) | Error reporting | Org slug `social-seen-dt`. |
| PostHog | TBC | Analytics | EU region. |
| Resend | **mitesh@skillmeup.co** | Transactional email | This is the sandbox-allowed recipient — important to know. Domain pending DNS verify. |

**Active env vars** (all in `.env.local` and `.env.example`):
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`
- `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST`
- `SUPABASE_ACCESS_TOKEN` (CLI only, for migrations)
- `RESEND_API_KEY`

---

## Vercel + Sentry/PostHog setup state

**Vercel project:** linked. Auto-deploys main → production, all PRs get preview deploys.

**Env vars on Vercel:** the user added Sentry + PostHog vars early in Sprint 0. Status as of end of Sprint 1:
- ✅ Sentry, PostHog (added)
- ❌ `SUPABASE_ACCESS_TOKEN` (not needed at runtime, only for CLI migrations)
- ❌ `RESEND_API_KEY` — **needs adding to Vercel preview + production** before email sending works on the deployed site

---

## Migration history (live on staging)

```
20260402000001 — create enums
20260402000002 — create profiles + handle_new_user trigger + RLS
20260402000003 — create events
20260402000004 — create event_hosts
20260402000005 — create event_inclusions
20260402000006 — create bookings + race-safe RLS
20260402000007 — create event_reviews
20260402000008 — create event_photos
20260402000009 — create user_interests
20260402000010 — create notifications (admin in-app announcements)
20260402000011 — create views (event_with_stats, etc.)
20260402000012 — create book_event() RPC + recompute_waitlist_positions()
20260402000013 — create storage buckets (avatars, event-photos)
20260402000014 — create recompute_waitlist trigger
20260406000001 — add 'activity' enum value to event_category
20260411000001 — fix events RLS to respect deleted_at

# Sprint 1 (P2-2):
20260420000001 — add profile registration fields (phone, email_consent, email_verified, status, user_status enum)
20260420000002 — harden profiles PII access (trigger fix correct; column REVOKE was a no-op — see follow-up)
20260420000003 — harden profiles PII access fix (the real fix: broad REVOKE + narrow GRANT)

# Sprint 1 (P2-3):
20260420000004 — book_event require verified email

# Sprint 1 (P2-4):
20260421000001 — extend notifications for email
```

Apply any new migration with:
```bash
set -a && source .env.local && set +a && supabase db push
```

The repo is already linked to the staging project via `.supabase/project-ref` (do NOT commit that file — it's gitignored by Supabase CLI default).

---

## The agent workflow (established pattern, follow it)

For each batch:

1. **Create feature branch** from latest `main`: `feat/<batch-name>` (e.g. `feat/p2-5-venue-reveal`).
2. **Decompose work**:
   - Schema/Server-Action changes → deploy `backend-developer` skill via prompt.
   - UI/component changes → deploy `frontend-developer` skill via prompt.
   - Both → backend first, frontend second (frontend depends on the contract).
3. **Code review BEFORE commit:** deploy `code-reviewer` skill. Don't skip — every batch has caught real issues. P2-2 caught a GDPR leak. P2-4 caught an XSS gap.
4. **If reviewer flags issues:** address inline if quick (we've done this every batch). Add larger items to `docs/FOLLOW-UPS.md`. Then re-run `code-reviewer` if the changes were substantial.
5. **Commit** with a verbose conventional-commits message (see Sprint 1 commit messages for the pattern — context, behaviour, test count delta, follow-ups).
6. **Push + open PR** with a structured body (Summary, Behaviour, Test Plan with checkboxes for manual verification).
7. **Wait for CI** (lint + typecheck + tests + Vercel build + Vercel preview).
8. **User says "merge"** → squash-merge with branch deletion. Sync local main. Delete local feature branches.

**Test discipline:** `pnpm tsc --noEmit && pnpm lint && pnpm test && pnpm build` must all be clean before commit. **Test count baseline at end of Sprint 1: 809.** Each batch should add tests, not remove them.

**Manual E2E:** the project has no Playwright yet. Manual verification on the Vercel preview is the catch-all.

---

## Outstanding follow-ups

`docs/FOLLOW-UPS.md` is the single source of truth. As of end of Sprint 1 it has ~14 items across:

- 🔴 Security: tighten anon profiles GRANT further (drop `email`/internal-state cols), document migration "anon visibility" decision
- 🟡 UX/polish: phone input maxLength, helper-text consistency, checkbox class duplication, OtpDigits countdown test (deferred from P2-3), etc.
- 📈 Analytics: track `email_consent` rate, source attribution on `email_verification_requested` (currently always 'direct')
- 🧪 Testing: server-side `book_event()` integration tests (Playwright), browser singleton test isolation
- 📝 Docs: SUPABASE-CONFIG.md runbook, migration checklist for new profiles columns
- 📧 Email-specific (P2-4): wire Supabase OTP through Resend, admin retry view for failed notifications, React Email migration, unsubscribe page, PII purge cascade for audit log, Sentry tagging on audit-log soft-fail, getSiteUrl production warning
- 🚀 Phase 3 ideas: ban-bypass mitigation, per-owner column grants on phone_number, email as hidden anon column

Re-read at the start of each sprint and pick anything that's now in scope.

---

## Sprint 2 plan (next, in order)

| Batch | What | Estimate | Pre-req |
|-------|------|----------|---------|
| **P2-5 — Venue reveal + scheduled jobs** | New columns: `events.venue_revealed`, `events.postcode`. Hide venue until 1 week before. Daily Supabase Edge Function fires venue-reveal emails + 2-day reminders + day-of reminders + post-event review requests via the Resend wrapper. Failure handling + admin retry path. | 3 days | None (Resend wrapper exists) |
| **P2-6 — Calendar (.ics) + event sharing** | "Add to Calendar" button generates ICS file (works for Google/Apple/Outlook). "Share this event" buttons (WhatsApp, copy link, Web Share API on mobile). | 1 day | None |
| **P2-7 — Stripe payments + cancellation/refunds** | Stripe Checkout (hosted), `bookings.stripe_payment_id` migration, webhook handler with idempotency + signature verification, user cancellation flow (refund within 48h, no refund within 48h), waitlist auto-promotion on cancel. | 3 days | Stripe account + API keys + webhook secret |
| **P2-8 — GDPR + member management + no-show tracking** | Admin ban/suspend (uses the `status` enum from P2-2). "Download My Data" + "Delete My Account" with 30-day soft-delete + the PII purge cascade. No-show toggle on event attendee page. Privacy Policy + Terms pages. Cookie consent banner. | 3 days | None |

**Sprint 2 total: ~10 working days for Claude Code (1-2× longer for human review/testing).**

**Pre-Sprint-2 setup needed:**
1. **DNS verification on `the-social-seen.com`** — cofounder. Unblocks real email recipients.
2. **`RESEND_API_KEY` to Vercel** — preview + production environments.
3. **Stripe account** — sign up at stripe.com (free, no business verification needed for test mode). Generate API keys: `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`. After webhook is deployed, get the `STRIPE_WEBHOOK_SECRET` from the webhook dashboard.

If any of these aren't ready when Sprint 2 starts, **P2-5 and P2-6 can run without them**. Only P2-7 strictly requires Stripe credentials.

---

## Things to remember when picking up in a new session

1. **Read this file first.** It captures decisions you'd otherwise have to re-discover.
2. **`docs/PHASE-2-PLAN-v2.md`** is the overarching plan. Re-read it for Sprint 2 batch detail.
3. **`docs/FOLLOW-UPS.md`** is the live backlog of small things. Update at the end of each batch.
4. **CLAUDE.md** + **social-seen-safety-SKILL.md** define the rules. The skills (`backend-developer`, `frontend-developer`, `code-reviewer`) read these — you don't need to summarise them in skill prompts.
5. **The agent workflow above is non-negotiable.** Skipping the code review costs more than it saves — every batch has caught real issues.
6. **All work goes on feature branches → squash-merge.** Never commit to main directly.
7. **Migrations are immutable once applied.** Modify nothing in `supabase/migrations/` that's already been pushed. Add a follow-up migration instead.
8. **The user is collaborative, not micromanaging.** They'll tell you when to push back, when to skip ceremony, when to ask. Default to clear plans + check-in before big actions; default to autonomous execution for routine work (auto mode is on).
9. **Email recipient sandbox restriction means manual E2E verification of email features = sign up as `mitesh@skillmeup.co`.** No way around this until DNS verifies.
10. **The Resend test-send script we wrote in P2-4 prep was deleted** — but the pattern (curl with the API key) still works for any quick API verification.

---

## Quick health check commands for fresh sessions

```bash
# Verify state on first load
git status                        # should be clean
git log --oneline -5              # most recent commit should be the P2-4 merge
pnpm test 2>&1 | tail -5          # should show 809/809 passing
pnpm tsc --noEmit && pnpm lint    # both clean

# Verify staging Supabase is reachable
set -a && source .env.local && set +a
supabase migration list           # last applied: 20260421000001

# Verify Resend works (sends to account-owner email only in sandbox)
curl -s -X POST "https://api.resend.com/emails" \
  -H "Authorization: Bearer $RESEND_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"from":"The Social Seen <onboarding@resend.dev>","to":["mitesh@skillmeup.co"],"subject":"Health check","text":"Sprint 1 wrap-up health check."}'
```
