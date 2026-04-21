# Sprint 2 Handover — for Sprint 3 (fresh session)

**Date:** 2026-04-21 (end of Sprint 2)
**Last commit on main:** `ed19815` — feat: Sprint 2 P2-8b — GDPR (export, delete, legal pages, cookie consent) (#24)
**Test baseline:** 919 tests passing
**Branch:** all work on feature branches → squash-merged → branches deleted. Local repo clean on `main`.

Sprint 3 is the **last sprint of Phase 2**. After it, the platform is feature-complete per `docs/PHASE-2-PLAN-v2.md`.

Read this top-to-bottom before starting Sprint 3 in a fresh session — captures the **non-obvious state + decisions** that aren't visible from the code alone. Companion to `docs/SPRINT-1-HANDOVER.md` which still applies for everything pre-Sprint-2.

---

## What was built in Sprint 2 (6 batches + 1 fix, all merged)

### P2-5 — Venue reveal + scheduled jobs (#17)
- `events.venue_revealed` (default true, backwards-compat) + `events.postcode`.
- `notifications.dedupe_key` (partial UNIQUE) + `retried_at` for idempotent cron-driven emails.
- `supabase/functions/daily-notifications/` — Deno edge function scheduled via `pg_cron` at 07:00 UTC. Handles:
  - Venue reveals (events 7 days out, email + flip `venue_revealed=true`)
  - 2-day reminders
  - Day-of reminders
  - Review requests (day after event)
  - Retry of failed email sends
- 3 new email templates: `venue-reveal`, `event-reminder`, `review-request`.
- Admin event form: "Hide venue until 1 week before" toggle + postcode field.

### P2-6 — Calendar ICS + WhatsApp sharing (#18)
- `src/lib/utils/share.ts` — `buildEventShareUrl`, `buildWhatsappShareUrl`, `nativeShareOrCopy`.
- `<ShareActions>` component (WhatsApp + Copy link + native Share) on event detail + My Bookings.
- `BookingWithEvent.event` Pick extended with `short_description` + `venue_address` for better ICS downloads from `/bookings`.

### fix/image-host-fallback (#19)
- `isAllowedImageHost()` in `src/lib/utils/images.ts` — hostname allowlist mirroring `next.config.ts` `images.remotePatterns`. Disallowed hosts → `null` → UI falls back to placeholder instead of crashing. Caught during P2-6 preview verification.

### P2-7a — Stripe Checkout happy path (#20)
- `pending_payment` booking_status enum value; `bookings.stripe_payment_id` + `stripe_checkout_session_id`; `profiles.stripe_customer_id` (anon REVOKEd at creation).
- `book_event_paid()` RPC — mirrors `book_event()` lock/capacity/email-verified semantics, inserts as `pending_payment` for paid events.
- `book_event()` RPC updated to **reject paid events** (defence against accidental free-confirmation).
- `src/lib/stripe/server.ts` + `src/lib/stripe/client.ts` + `src/lib/stripe/checkout.ts` (lazy Customer creation, 30-min session expiry).
- Server Actions: `createPaidCheckout`, `abandonPendingCheckout`.
- Webhook route `/api/stripe/webhook` — signature-verified, idempotent via partial UNIQUE + `.eq('status','pending_payment')` guard. Handles `checkout.session.completed`.
- Success page `/events/[slug]/booking-success` (DB-authoritative, URL session_id is narrowing only).
- `BookingCancelledHandler` — soft-cancels pending_payment on `?cancelled=1`, with `from=claim` hint.
- BookingModal: paid flow flattened to 2 steps (old mocked PaymentStep removed).

### P2-7b — Cancellation + 48h refunds + first-click waitlist (#22)
- `bookings` cancellation audit columns: `cancelled_at`, `cancellation_reason`, `refunded_amount_pence`, `refunded_at`, `stripe_refund_id`.
- CHECK constraint: `refunded_amount_pence = 0 OR (refunded_at AND stripe_refund_id set)`.
- `claim_waitlist_spot()` RPC — atomic capacity check + transition `waitlisted → pending_payment` (paid) or `confirmed` (free). Preserves `waitlist_position` through the paid transition (restored on Stripe failure); webhook nulls it on confirm.
- `cancelBooking` extended with 48h refund policy + Stripe idempotency key (`refund-booking-<id>`). Refund-before-UPDATE: Stripe failure aborts cancel.
- `claimWaitlistSpot` Server Action + waitlist-spot-available email template.
- `charge.refunded` webhook handler (dual-path idempotency: match by refund_id first, payment_intent fallback).
- All post-response side effects migrated to `next/server.after()` — the `void promise` pattern was unreliable on serverless.
- Admin `BookingsTable` gets a Payment column (Paid / Refunded badges).
- **Stripe-subscribed events needed:** `checkout.session.completed` AND `charge.refunded`.

### P2-8a — Admin moderation + no-show + ban enforcement (#23)
- 3 migrations:
  - Booking RPCs now reject non-active callers (`!= 'active'`). Applies to `book_event`, `book_event_paid`, `claim_waitlist_spot`.
  - `profiles.moderation_reason` / `moderation_at` / `moderation_by` (FK). REVOKE SELECT from **both anon and authenticated** (important — moderator identity is PII-adjacent).
  - Follow-up sweep: REVOKE `stripe_customer_id` from authenticated too (P2-7a only revoked from anon).
- Middleware: banned users auto-signed-out + redirected to `/account-suspended` on every request. Suspended users pass through (RPC gates booking).
- Admin Server Actions: `suspendMember`, `banMember`, `reinstateMember` via shared `setMemberStatus` (rejects self-moderation + peer-admin moderation). `setNoShow(id, on)` toggles confirmed↔no_show on past events.
- `<MemberModerationDialog>` in admin members table; `<NoShowButton>` on past-event bookings.
- `/profile` suspension banner.

### P2-8b — GDPR (#24)
- `sanitise_user_notifications(uuid)` RPC — scrubs `body`/`subject`/`recipient_email` on notifications where user was sender.
- Server Actions: `exportMyData` (JSON of profile/bookings/reviews/interests) + `deleteMyAccount` (typed-phrase confirmation → 48h paid-booking guard → cancel active → scrub notifications → delete user_interests → **delete Stripe Customer via `stripe.customers.del`** → anonymise profile incl. `stripe_customer_id` → signout → redirect).
- `/privacy` + `/terms` pages (solicitor review flagged before real launch).
- `src/lib/analytics/consent.ts` + `<CookieConsentBanner>` — localStorage-backed consent. **PostHog never loads pre-consent.** Accept/Decline equal visual weight.
- `PostHogProvider` rewritten: consent-gated `init()`, opt in/out without reload.
- `/admin/deleted-accounts` — read-only queue with 30-day countdown.
- Stabilised pre-existing flaky `join-form.test.tsx` Step 3 assertion (wrapped in `waitFor`).

---

## Critical state that isn't visible in the code

### 1. Operator setup deltas from Sprint 1 handover

**Migrations to apply on staging** (in order — Sprint 1 covered through `20260421000001`; Sprint 2 adds):
```
20260421000002 — notifications retry/dedupe
20260421000003 — events venue_revealed + postcode
20260421000004 — pg_cron schedule for daily-notifications
20260422000001 — stripe_payments_schema (enum + columns + indexes)
20260422000002 — book_event_paid_rpc
20260422000003 — bookings_cancellation_columns
20260422000004 — claim_waitlist_spot_rpc
20260423000001 — booking_rpcs_require_active_status
20260423000002 — profile_moderation_audit
20260423000003 — stripe_customer_id_revoke_authenticated
20260424000001 — user_deletion_helpers
```
Apply with `set -a && source .env.local && set +a && supabase db push`.

**Supabase Edge Function** (P2-5 pg_cron target):
```bash
supabase functions deploy daily-notifications --no-verify-jwt
supabase secrets set \
  RESEND_API_KEY=re_... \
  FROM_ADDRESS='The Social Seen <onboarding@resend.dev>' \
  REPLY_TO_ADDRESS=info@the-social-seen.com \
  SANDBOX_FALLBACK_RECIPIENT=mitesh@skillmeup.co \
  NEXT_PUBLIC_SITE_URL=https://the-social-seen.vercel.app
```
Then in SQL editor (one-time, per environment):
```sql
ALTER DATABASE postgres SET app.settings.edge_function_url =
  'https://<project-ref>.supabase.co/functions/v1/daily-notifications';
ALTER DATABASE postgres SET app.settings.service_role_key = '<service-role-jwt>';
```
If unset, the cron job NOTICEs and exits — safe to apply migrations before this.

**Stripe dashboard** (test mode, Sprint 2):
- Webhook endpoint: `https://<preview-or-prod>/api/stripe/webhook`
- **Subscribe to BOTH events:** `checkout.session.completed` AND `charge.refunded`.
- Copy the signing secret → Vercel env `STRIPE_WEBHOOK_SECRET` (Preview + Production).
- For local dev: `stripe listen --forward-to localhost:6500/api/stripe/webhook` prints a `whsec_...`.
- Restricted key scopes: Checkout Sessions Write, PaymentIntents Read, Refunds Write, Customers Write.

**Vercel env vars added in Sprint 2:**
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`

### 2. Product-level decisions settled in Sprint 2 (avoid re-litigating)

| Decision | Why |
|---|---|
| **Waitlist auto-promote: NO.** Instead, "first-click wins" — cancellation emails every waitlister, the first to pay claims the spot. | User product call during P2-7 planning. Simpler state machine than auto-promote; fairer than SetupIntent. Considered + rejected. See PR #22 commit message. |
| **Paid-waitlist: free upfront (no charge).** Charge only on claim-and-pay. | Rejected charge-and-refund (Stripe fee waste) and SetupIntent (SCA recovery UX is a mini-product). |
| **Ban takes effect on next request** (via middleware), not immediate session revoke. | Acceptable threat model; full session revoke adds complexity for marginal value. |
| **30-day soft-delete for account deletion.** Admin hard-deletes manually for now. | Phase 3 will cron-automate. |
| **Stripe Customer is deleted on account deletion.** | GDPR Article 17 erasure right — can't honour fully if Customer persists. |
| **Moderator identity (`moderation_by`) is not readable by other members.** | GDPR + operational risk. Column REVOKEd from both anon + authenticated. |

### 3. Patterns established in Sprint 2 that future code should follow

**Post-response work:** use `import { after } from 'next/server'`, NOT `void somePromise`. Applied at 4 call sites in Sprint 2 (P2-7b). Vercel's serverless runtime honours `after()`; bare-void promises can be killed when the function returns.

**PII column grants on new `profiles` columns:** default to REVOKE from anon AND authenticated. P2-2 "secure by default" pattern. Admin reads go through `createAdminClient` (service_role) which bypasses column grants. Any new profiles column needs a deliberate decision.

**Stripe idempotency keys:** on every retry-prone Stripe API call, pass `{ idempotencyKey: '<stable-scope>-<entity-id>' }`. P2-7b added this to `stripe.refunds.create`. Future P2-9/P2-10 that touches Stripe should do the same.

**Image hosts:** to add a new remote image host you must update **both** `next.config.ts` `remotePatterns` **and** `ALLOWED_IMAGE_HOSTS` in `src/lib/utils/images.ts`. They must stay in sync (flagged as a follow-up to add a test enforcing this).

**Flaky test fix:** wrap mount-effect assertions in `waitFor(...)`. The `join-form` fix in #24 is the template.

### 4. Architecture notes for Sprint 3

- **Booking state machine is now:** `confirmed`, `cancelled`, `waitlisted`, `no_show`, `pending_payment`. Anything touching bookings should handle all five.
- **Three booking RPCs exist** (`book_event`, `book_event_paid`, `claim_waitlist_spot`) — all three enforce email_verified + active-status gates server-side. Do NOT write direct INSERTs on `bookings` for member-initiated flows; go through an RPC so capacity/race-safety/status-gates are preserved.
- **Webhook is subscribed to 2 event types** (`checkout.session.completed`, `charge.refunded`). New Stripe features must extend the handler; don't create a second webhook endpoint.
- **`after()` is the default** for any non-critical post-mutation work (emails, analytics, cache-warming). Don't use `void`.

### 5. Known follow-ups (live in `docs/FOLLOW-UPS.md`)

At end of Sprint 2: ~25 items across security/UX/testing/analytics/docs. Highlights worth knowing before Sprint 3:

- **Dialog a11y** — 3 dialogs in the codebase (`BookingCancelledHandler` toast, `MemberModerationDialog`, `DataPrivacySection` delete dialog) lack focus trap + Escape-key. Radix Dialog is in deps. Bundle into a focused a11y PR or alongside WCAG AA audit.
- **Middleware DB round-trip per auth request** — reads `profiles.status` on every authenticated request. Phase 3 fix: JWT custom claim via Supabase auth hook.
- **Image-host allowlist sync test** — one-liner test asserting `ALLOWED_IMAGE_HOSTS` matches `next.config.ts`. Prevents drift.
- **`sanitise_user_notifications` recipient gap** — current RPC scrubs rows where user was sender, not recipient. Admin attendee-messaging (P2-9) will introduce recipient rows and needs this fix.
- **Admin retry UI for failed notifications** — P2-5 plan parked this; P2-9 picks it up.
- **WCAG AA audit** — gold on white contrast flagged for small-text cases.

### 6. Unchanged context still relevant (from Sprint 1 handover)

- **Resend sandbox still in effect.** DNS verification on `the-social-seen.com` still pending from cofounder. Until it verifies, all mail routes to `mitesh@skillmeup.co` (the Resend account owner). The `SANDBOX_FALLBACK_RECIPIENT` env auto-disables in production, so prod deployment post-DNS-verify requires no code change.
- **`profiles.email_verified`** is the app-level verification signal, NOT `auth.users.email_confirmed_at` (which is always set because `mailer_autoconfirm: True`).
- **Supabase Auth Management API settings** (`mailer_otp_length: 6`, `mailer_otp_exp: 600`, `mailer_autoconfirm: True`) live on staging but NOT in git. Must be re-applied on a new production project.
- **Migration history is immutable** — never modify a migration that's been pushed; add a follow-up instead.

---

## Credentials & accounts (unchanged from Sprint 1, updated totals)

| Service | Email | Status |
|---|---|---|
| Supabase | mitesh50@hotmail.com | Staging project only. Need separate prod project later. |
| Sentry | (org slug: social-seen-dt) | Error reporting. |
| PostHog | TBC | EU region. Consent-gated as of P2-8b. |
| Resend | mitesh@skillmeup.co | Domain DNS pending. |
| **Stripe** | test mode | Added in Sprint 2. Publishable + secret key in `.env.local` + Vercel. Webhook subscribed to 2 events. |

---

## Sprint 3 plan (last sprint of Phase 2)

Per `docs/PHASE-2-PLAN-v2.md`, four batches, ~6.5 working days. **No external dependencies** — all Stripe/Supabase/Resend work needed for Sprint 3 is done.

### P2-9 — Admin quality-of-life (~1.5 days)
- **Event duplication** — "Duplicate Event" button on admin event page: copies all fields except date, slug (auto-generates new), resets to draft. Straightforward Server Action.
- **Attendee messaging (simple)** — Admin event page → "Email All Attendees" button → plain-text textarea → sends via Resend to all confirmed attendees. No rich text, no groups. Logged to `notifications` table with `recipient_event_id` set (which will let the P3 version of `sanitise_user_notifications` find these rows to scrub).
- **Failed notification admin view** — `/admin/notifications/failed` listing `notifications` where `channel='email' AND status='failed'`. "Retry" button re-fires the send via the stored `body`/`subject`/`recipient_email`.

**Hazard:** the attendee-messaging feature will fire many emails from one admin action. Use `next/server.after()` for the dispatch loop + rate-limit via `sendEmail`'s existing one-retry pattern. Don't block the admin's response.

### P2-10 — Profile completion + post-event engagement (~2 days)
- **Profile completion score** (computed in code, not DB):
  Full name 10% / Avatar 20% / Job title 10% / Company 10% / Industry 10% / Bio 15% / LinkedIn 15% / Phone 10%.
- Progress bar on profile page with "Complete Your Profile" banner when <100%. Shows missing fields, links to edit form. (The existing `ProfileCompletionBanner` already scaffolds this — extend it.)
- **Post-signup nudge email** — sent 3 days after registration if profile <50% complete. Extends the daily edge function (another section alongside venue-reveal/reminders).
- **Past-event review prompt** — already wired in P2-5's daily job; nothing new here.
- **Homepage social proof** — surface top 3-5 reviews (highest rated, most recent) on the landing page. Data exists; just a query + component.
- **Past events page** — `/events/past` — grid of past events with photos + review snippets. Helps new visitors see what they're signing up for.

**Hazard:** the profile completion score matters only for conversion analytics — don't gate bookings on it. The homepage social proof must respect `event_reviews.is_visible`.

### P2-11 — SEO + discoverability (~1.5 days)
- **`src/app/sitemap.ts`** — dynamic sitemap: all published events + static pages.
- **`src/app/robots.ts`** — allow all crawlers; block `/admin`, `/profile`, `/bookings`, `/account-suspended`.
- **JSON-LD structured data**:
  - Event pages: `Event` schema (already partial from P2-5's venue-revealed fallback; extend).
  - Homepage: `Organization` schema.
  - Reviews: `AggregateRating` on event pages.
- **`<meta>` descriptions + canonical URLs** on all pages.
- **`public/llms.txt`** — describe the site, categories, how to join.
- **Semantic HTML audit** — heading hierarchy, landmarks, alt text.
- **Performance** — verify `next/image` usage, no layout shift.

**Hazard:** the P2-5 JSON-LD on event pages hides the venue when `venue_revealed=false` — don't undo that.

### P2-12 — Contact + collaborate + Instagram (~1.5 days)
- **`/contact`** — form (name, email, subject dropdown [General / Event Enquiry / Collaboration / Press], message). Server Action sends via Resend to team email.
- **`/collaborate`** — brand/venue/sponsor pitch form.
- **Instagram embed on `/gallery`** — oEmbed recent posts + "Follow us" button.
- **Instagram follow** in footer + post-booking confirmation.
- Add Contact + Collaborate to footer nav.

**Why not the Instagram Graph API:** Basic Display API is being deprecated; Graph API needs a Facebook Page + app approval. oEmbed works without approval.

---

## Agent workflow (still non-negotiable)

For each batch:
1. Create feature branch from latest `main`.
2. Build in small focused chunks; tests alongside implementation.
3. **Run `/code-reviewer` LOCALLY before `git push`** — this is captured in memory. Review-before-push, not review-after-PR. Stops the "fix findings in a follow-up commit" pattern.
4. Address findings inline; re-run reviewer if substantive.
5. Gates: `pnpm tsc --noEmit && pnpm lint && pnpm test && pnpm build`. All clean before commit.
6. Commit with verbose conventional-commits message (follow Sprint 2 commits for the pattern).
7. Push + open PR with structured body.
8. User says "merge" → squash-merge + delete branch.

**Test baseline at end of Sprint 2: 919.** Each batch should add tests, not remove them.

**Manual E2E:** still no Playwright. Vercel preview deploys remain the catch-all for visual verification. Local preview via `launch.json` dev server works once the seed-data image hosts are in the allowlist (which is now the case).

---

## Fresh-session quick health check

```bash
# Verify state on first load
git status                        # clean on main
git log --oneline -5              # ed19815 P2-8b merge at top

# Pnpm via user-local prefix (established in Sprint 2)
export PATH="$HOME/.local/bin:$PATH"
pnpm tsc --noEmit && pnpm lint && pnpm test && pnpm build
# Expected: all clean, 919 tests passing.

# Verify staging Supabase reachable + latest migrations applied
set -a && source .env.local && set +a
supabase migration list           # last: 20260424000001_user_deletion_helpers

# Stripe webhook subscribed to 2 event types
stripe events list --limit 5      # if stripe-cli installed
```

---

## Things to remember when picking up Sprint 3

1. **Read this file first.** Captures what's not in the code.
2. **`docs/PHASE-2-PLAN-v2.md`** is the overarching plan — Sprint 3 batches P2-9 → P2-12 are detailed there.
3. **`docs/FOLLOW-UPS.md`** is the live backlog. At end of Sprint 2 it has ~25 items. Sprint 3 is the last chance before Phase 2 wraps — pick up anything that's now in scope, or consciously defer to Phase 3.
4. **`docs/SPRINT-1-HANDOVER.md` still relevant** for pre-Sprint-2 context (auth flow, Resend sandbox, profiles RLS model).
5. **CLAUDE.md + social-seen-safety-SKILL.md** define the rules — skills read them directly.
6. **The 4 patterns from §3 above** (after(), PII REVOKE, idempotency keys, image-host dual-update) — apply consistently in P2-9 through P2-12.
7. **Review before push.** Not after.
8. **Stripe + Resend + cron ops setup** listed in §1 must be applied per environment before features actually fire.
9. **This is the final sprint.** After P2-12, Phase 2 is done. Whatever makes it into Sprint 3 ships to the demo; anything deferred goes into Phase 3 backlog.
