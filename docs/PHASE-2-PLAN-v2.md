# Phase 2 Plan — The Social Seen (v2 — Revised)

**Created:** 2026-04-11
**Status:** Draft for sign-off
**Scope:** Critical fixes, core features, growth foundations

---

## Current State

Phase 1 delivered: Supabase schema (16 migrations), marketing pages, event listing/detail, 3-step registration, login, member profile/bookings, admin dashboard, gallery, reviews, dark mode, security hardening. 513 passing tests.

**Capacity race conditions already handled** — `book_event()` RPC uses `SELECT ... FOR UPDATE` row locking (migration 012). No work needed here.

**What's broken:** Auth state in header (can't access profile/admin after login). No password reset. No email verification. No payments. No transactional email. No GDPR compliance.

---

## Platform Decisions (Zero Budget Start)

| Need | Tool | Free Tier | First Real Cost |
|------|------|-----------|----------------|
| Error Reporting | **Sentry** | 5K errors/month | Won't hit for ages |
| Analytics | **PostHog** | 1M events/month | Won't hit for ages |
| Transactional Email | **Resend** | 3,000 emails/month | With 1-2 events/month at 20-40 attendees, you're at ~200-400 emails/month. Free tier lasts well past 1,000 members. |
| Email Marketing | **Brevo (Sendinblue)** | 300/day (9,000/month) | When you want newsletters beyond transactional |
| SMS | **Twilio** | ~$15 trial credit (~150 SMS) | ~$20/month once trial ends. WhatsApp Business API needs Meta verification + per-convo costs — Phase 3. |
| Payments | **Stripe Checkout** (hosted) | No monthly fee, 1.4% + 20p/txn | Only pay when you earn |
| Calendar | **ICS file generation** | Free (code only) | Never |
| Staging | **Vercel Preview + separate Supabase project** | Both free tier | Set up before Sprint 2 |

**On backups:** Supabase free tier includes daily backups retained 7 days. Point-in-time recovery is Pro only. Daily backups are sufficient at this stage — revisit when taking real payments.

**On WhatsApp vs SMS:** Keep WhatsApp for community chat (it's working). Use Twilio SMS for *transactional* messages only (venue reveals, reminders). WhatsApp Business API is a Phase 3 conversation.

---

## Batches — Revised

### P2-0: Observability (DO FIRST — before any code changes)

**Why first:** You want error tracking live *before* you start rewriting auth and registration flows. If something breaks, you'll know immediately.

**Tasks:**
- [ ] Install `@sentry/nextjs`, run wizard, configure DSN
- [ ] Wire into existing `error.tsx` error boundaries
- [ ] Install `posthog-js`, add provider to root layout
- [ ] Track key events: page_view (auto), sign_up, login, event_view, booking_created
- [ ] Env vars: `SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST`

**Estimate:** Half a day.
**Files:** `package.json`, `src/app/layout.tsx`, `sentry.client.config.ts`, `sentry.server.config.ts`, `next.config.ts`

---

### P2-1: Auth Fix + Password Reset (BLOCKER)

**The bugs:**
1. Header shows "Sign In" after login — user can't reach profile or admin
2. No password reset flow — locked-out users have zero recourse

**Auth state root cause:** The Header (`src/components/layout/Header.tsx:62-125`) uses `onAuthStateChange` + pathname-triggered `getSession()`. Likely issue: Supabase SSR cookies aren't being read by the browser client after login redirect, or the session isn't established before the Header mounts.

**Tasks:**
- [ ] Debug cookie flow: login action → session cookie set → redirect → Header reads session
- [ ] Verify middleware (`src/lib/supabase/middleware.ts`) refreshes session on every request
- [ ] Fix Header auth detection — ensure `SIGNED_IN` event fires reliably after redirect
- [ ] Remove debug console.logs (Header lines 102-103, 106)
- [ ] Add `/forgot-password` page — email input → `supabase.auth.resetPasswordForEmail()`
- [ ] Add `/reset-password` page — new password form, handles Supabase recovery link
- [ ] Add "Forgot password?" link to login form
- [ ] Tests: login → avatar shows → profile accessible → admin accessible (admin user) → logout → Sign In returns → password reset email → new password works

**Estimate:** 1.5 days.
**Files:** `Header.tsx`, `middleware.ts`, `login-form.tsx`, new forgot-password and reset-password pages

---

### P2-2: Registration Enhancements

**Tasks:**
- [ ] New migration: add `phone_number text`, `email_consent boolean DEFAULT false`, `email_verified boolean DEFAULT false`, `status user_status DEFAULT 'active'` to profiles
  - `user_status` enum: `active`, `suspended`, `banned` (needed later for P2-7 member management, cheaper to add now)
- [ ] Update `handle_new_user()` trigger to pull phone from `raw_user_meta_data`
- [ ] Add phone number field to Step 1 of JoinForm
  - UK format validation (+44 or 07...)
  - Label: "Phone Number" — helper: "For event reminders and updates"
- [ ] Add email consent checkbox (unchecked by default — GDPR)
  - Label: "Keep me updated with new events and community news"
- [ ] Update `signUp` server action to pass phone + consent to user metadata
- [ ] Tests: registration saves phone + consent to profiles

**Estimate:** 1 day.
**Files:** New migration, `join-form.tsx`, `src/app/(auth)/actions.ts`, `src/types/index.ts`

---

### P2-3: Email Verification (OTP — gates booking, not signup)

**Key decision:** Don't gate registration Step 2 behind email verification. Let users complete the full signup flow (account → interests → welcome). Gate **booking** behind verified email instead. Same security, much better conversion.

**Tasks:**
- [ ] Configure Supabase Auth: enable email OTP, set 10-minute expiry
- [ ] After signup completion (Step 3 "You're In"), show a dismissible banner: "Verify your email to book events — check your inbox for a 6-digit code"
- [ ] Create `/verify` page: 6-digit OTP input, auto-submit on 6th digit, resend button (60s cooldown)
- [ ] Use `supabase.auth.verifyOtp({ email, token, type: 'signup' })` to confirm
- [ ] On success: set `profiles.email_verified = true`, show success toast
- [ ] In booking flow: if `email_verified = false`, show modal: "Verify your email to book this event" with link to `/verify`
- [ ] Add "Verify Email" nudge to profile page when unverified
- [ ] Tests: unverified user can browse events but can't book → verify → booking works

**Estimate:** 2 days.
**Files:** `src/app/(auth)/verify/page.tsx` (new), `join-form.tsx` (banner), booking flow components, profile page

---

### P2-4: Transactional Email (Resend)

**Tasks:**
- [ ] Install `resend` package
- [ ] Create `src/lib/email/resend.ts` — client setup with `RESEND_API_KEY`
- [ ] Create `src/lib/email/send.ts` — typed wrapper functions with error handling + retry (1 retry on failure)
- [ ] Email templates (React Email or plain HTML):
  - `welcome` — sent after registration completion
  - `booking-confirmation` — event details, **venue hidden if `venue_revealed = false`**, calendar attachment (.ics)
  - `venue-reveal` — venue name + address + Google Maps link (sent by scheduled job)
  - `event-reminder` — 2 days before + day of (sent by scheduled job)
  - `review-request` — "How was [event]?" with link to leave review (sent day after event)
- [ ] Wire welcome email into registration completion
- [ ] Wire booking confirmation into booking flow (call after successful `book_event()` RPC)
- [ ] **Failure handling:** Log all email sends to `notifications` table with status (sent/failed/pending). Admin can see failed sends and retry.

**Estimate:** 2.5 days.
**Files:** `package.json`, `src/lib/email/*`, auth actions, booking actions, `notifications` table usage

---

### P2-5: Venue Reveal + Scheduled Jobs

**The feature:** Events hide venue until 1 week before. Booked users get venue reveal via email + SMS.

**Schema (new migration):**
- [ ] Add `venue_revealed boolean DEFAULT true` to events
- [ ] Add `postcode text` to events (nullable — for Google Maps link)

**Frontend:**
- [ ] Event detail page: when `venue_revealed = false`, show "Venue revealed 1 week before the event" instead of address
- [ ] When venue shown: postcode links to Google Maps (`https://www.google.com/maps/search/?api=1&query={encoded_address}+{postcode}`)
- [ ] "Get Directions" button with map pin icon
- [ ] Admin event form: "Hide venue until 1 week before" toggle + postcode field

**Scheduled job (Supabase Edge Function + pg_cron):**
- [ ] Single daily function that handles all scheduled notifications:
  1. **Venue reveals:** events where `venue_revealed = false` AND `date_time - interval '7 days' <= now()` → send venue reveal email/SMS to confirmed attendees → set `venue_revealed = true`
  2. **2-day reminders:** events where `date_time::date = current_date + 2`
  3. **Day-of reminders:** events where `date_time::date = current_date`
  4. **Review requests:** events where `date_time::date = current_date - 1` (day after event)
- [ ] **Failure handling:** Each notification attempt logged to `notifications` table. Failed sends get status `failed`. Admin dashboard shows failed notifications with "Retry" button.
- [ ] **Retry mechanism:** Edge function checks for `failed` notifications less than 3 days old and retries once per run.

**Estimate:** 3 days.
**Files:** New migration, event detail components, admin event form, new Supabase Edge Function, `supabase/functions/daily-notifications/`

---

### P2-6: Calendar Integration + Event Sharing

**Tasks:**
- [ ] Create `src/lib/utils/calendar.ts` — generates ICS content (title, description, start/end, location if revealed, organizer)
- [ ] "Add to Calendar" button on booking confirmation and My Bookings page
  - Downloads `.ics` file — works with Google Calendar, Apple, Outlook
- [ ] "Share this event" button on event detail pages:
  - Copy link
  - Share via WhatsApp (pre-filled message with event title + link)
  - Native Web Share API on mobile (falls back to copy link)
- [ ] Test: ICS opens in calendar apps, share links work on mobile + desktop

**Estimate:** 1 day.
**Files:** `src/lib/utils/calendar.ts` (new), booking confirmation component, event detail component

---

### P2-7: Payments (Stripe Checkout)

**Architecture:** Use Stripe Checkout (hosted page). We don't build a payment form — Stripe handles the entire UI. Our code: create session → redirect → handle webhook.

**Staging requirement:** Set up Vercel Preview environment + separate Supabase project before starting this batch. Test webhooks with Stripe CLI locally and against staging.

**Tasks:**
- [ ] Install `stripe` and `@stripe/stripe-js`
- [ ] Create `src/lib/stripe/server.ts` — Stripe server client
- [ ] Create `src/lib/stripe/client.ts` — Stripe publishable key loader
- [ ] New migration: add `stripe_payment_id text` to bookings, `stripe_customer_id text` to profiles
- [ ] **Booking flow for paid events:**
  1. User clicks "Book" → Server Action calls `book_event()` RPC (status: `pending_payment`, new enum value)
  2. Server Action creates Stripe Checkout Session with booking_id in metadata
  3. Redirect to Stripe hosted checkout
  4. Success URL: `/bookings?success=true&booking_id={id}`
  5. Cancel URL: `/events/{slug}?cancelled=true` — delete the pending booking
- [ ] **Webhook handler** (`src/app/api/stripe/webhook/route.ts`):
  - Verify webhook signature with `STRIPE_WEBHOOK_SECRET` — reject unsigned requests
  - **Idempotency:** Check `bookings.stripe_payment_id` before processing. If already set, return 200 (already processed).
  - `checkout.session.completed` → update booking status to `confirmed`, set `stripe_payment_id`, send confirmation email
  - `charge.refunded` → update booking status to `cancelled`
- [ ] **User cancellation + refunds:**
  - Users can cancel bookings from My Bookings page
  - Free events: cancel immediately, trigger waitlist promotion
  - Paid events: cancel up to 48 hours before event → auto-refund via Stripe API. Within 48 hours → no refund (show policy).
  - Cancellation triggers: update booking status, promote next waitlisted person, send confirmation/waitlist-promotion emails
- [ ] Add `pending_payment` to `booking_status` enum (new migration)
- [ ] Free events: skip Stripe entirely, existing flow unchanged
- [ ] Admin: payment status visible on booking list
- [ ] Tests: free booking works, paid booking → Stripe → webhook → confirmed, duplicate webhook ignored, cancellation + refund, waitlist promotion on cancel

**Estimate:** 3 days.
**Files:** New migrations, `package.json`, `src/lib/stripe/*`, `src/app/api/stripe/webhook/route.ts`, booking components, My Bookings page

---

### P2-8: Member Management + GDPR

**Tasks:**

**Admin: Ban/Suspend**
- [ ] `profiles.status` already added in P2-2 migration (`active`/`suspended`/`banned`)
- [ ] Admin members page: ban/suspend actions with confirmation modal + reason field
- [ ] Middleware check: if `profiles.status = 'banned'`, sign out and show "Account suspended — contact us at [email]"
- [ ] Suspended users: can login, can view events, cannot book
- [ ] Update `book_event()` RPC: reject if user status is not `active`

**GDPR**
- [ ] "Download My Data" on profile page → Server Action exports profile + bookings + reviews + interests as JSON download
- [ ] "Delete My Account" on profile page → confirmation modal → soft-delete (set `deleted_at`) → sign out → admin sees deletion request → hard delete after 30 days (manual for now, automated in Phase 3)
- [ ] Privacy Policy page (`/privacy`)
- [ ] Terms of Service page (`/terms`)
- [ ] Cookie consent banner (required for PostHog analytics cookies)

**No-show tracking**
- [ ] Admin event page (post-event): attendee list with "Mark No-Show" toggle per attendee
- [ ] Clicking toggle sets `bookings.status = 'no_show'`
- [ ] Admin member view: show no-show count badge
- [ ] No automated consequences yet — admin uses judgment for future bookings

**Estimate:** 3 days.
**Files:** Admin members page, admin event attendee page, middleware, `book_event()` RPC update, profile page, new static pages

---

### P2-9: Admin Quality of Life

**Tasks:**
- [ ] **Event duplication:** "Duplicate Event" button on admin event page — copies all fields except date, slug (auto-generates new), and resets to draft
- [ ] **Attendee messaging (simple version):** Admin event page → "Email All Attendees" button → plain text textarea → sends via Resend to all confirmed attendees. No rich text editor, no drag-and-drop groups. Just subject + body + send. Logged to `notifications` table.
- [ ] **Failed notification view:** Admin dashboard section showing failed email/SMS sends with retry button

**Estimate:** 1.5 days.
**Files:** Admin event pages, new message composer (simple textarea form), notification admin view

---

### P2-10: Profile Completion + Post-Event Engagement

**Simplified approach:** No per-event gating toggle. Just visual nudges and a follow-up email.

**Tasks:**
- [ ] Profile completion score (computed in code, not DB):
  - Full name (10%), Avatar (20%), Job title (10%), Company (10%), Industry (10%), Bio (15%), LinkedIn (15%), Phone (10%)
- [ ] Progress bar on profile page with "Complete Your Profile" banner when < 100%
  - Shows which fields are missing, links to edit form
- [ ] Post-signup email (sent 3 days after registration if profile < 50% complete): "Finish setting up your profile"
- [ ] **Post-event review prompt:** Day-after-event email (already in P2-5 scheduled job) with "How was [event]?" + link to review form
- [ ] **Homepage social proof:** Surface top 3-5 reviews (highest rated, most recent) on the landing page. Data already exists — just need the component.
- [ ] **Past events page:** `/events/past` — grid of past events with photos and review snippets. Helps new visitors see what they're signing up for.

**Estimate:** 2 days.
**Files:** Profile page, homepage, events page (past filter), email template, profile completion utility

---

### P2-11: SEO + Discoverability

**Tasks:**
- [ ] `src/app/sitemap.ts` — dynamic sitemap (all published events, static pages)
- [ ] `src/app/robots.ts` — allow all crawlers
- [ ] JSON-LD structured data:
  - Event pages: `Event` schema (name, date, location, price, availability)
  - Home page: `Organization` schema
  - Reviews: `AggregateRating` on event pages
- [ ] `<meta>` descriptions on all pages
- [ ] Canonical URLs on all pages
- [ ] `public/llms.txt` — for AI crawlers (describes the site, event categories, how to join)
- [ ] Semantic HTML audit: heading hierarchy, landmarks, alt text
- [ ] Performance: verify `next/image` usage, lazy loading, no layout shift

**Estimate:** 1.5 days.
**Files:** `src/app/sitemap.ts`, `src/app/robots.ts`, JSON-LD components, page metadata, `public/llms.txt`

---

### P2-12: Contact, Collaboration + Instagram

**Tasks:**
- [ ] `/contact` page — form: name, email, subject dropdown (General / Event Enquiry / Collaboration / Press), message. Sends via Resend to team email.
- [ ] `/collaborate` page — targeted at brands/venues/sponsors. Form: company, contact name, email, collaboration type, message.
- [ ] Instagram embed on gallery page — oEmbed recent posts + "Follow us" button
- [ ] Instagram follow button in footer and post-booking confirmation
- [ ] Add Contact + Collaborate to footer nav

**Why not Instagram API:** Meta is deprecating Basic Display API. The Graph API requires a Facebook Page + app approval. oEmbed is simpler and works without approval.

**Estimate:** 1.5 days.
**Files:** New contact/collaborate pages, gallery page, footer component

---

## What's Cut from Phase 2 (moved to Phase 3)

| Feature | Why Deferred |
|---------|-------------|
| **Referral system** | No value without rewards. Rewards need mature payment infrastructure. Word-of-mouth already working via WhatsApp. |
| **WhatsApp Business API** | Requires Meta business verification + per-conversation costs. Twilio SMS covers transactional needs. |
| **Rich text admin messaging + mini-groups** | Mini-product. Plain text email to attendees covers 90% of need. |
| **Per-event profile gating** | Over-engineers the booking flow. Simple nudges get 80% of the result. |
| **Attendee check-in (QR/scanning)** | No-show toggle is sufficient. Full check-in is a Phase 3 feature. |
| **User-submitted event photos** | Requires moderation queue. Admin-uploaded photos are fine for now. |
| **PWA + Push Notifications** | Nice-to-have. SMS + email cover notification needs. |
| **Multi-ticket bookings (+1)** | Adds complexity to capacity logic and payments. Revisit after core payments are stable. |

---

## Sprint Plan

### Sprint 0 — Foundations (Day 1)
| Batch | Work | Estimate |
|-------|------|----------|
| P2-0 | Sentry + PostHog | 0.5 day |

### Sprint 1 — Make It Usable (Week 1-2)
| Batch | Work | Estimate |
|-------|------|----------|
| P2-1 | Auth fix + password reset | 1.5 days |
| P2-2 | Registration: phone, consent, status enum | 1 day |
| P2-3 | Email verification (OTP, gates booking) | 2 days |
| P2-4 | Transactional email (Resend) | 2.5 days |
| | **Sprint 1 total** | **7.5 days** |

### Sprint 2 — Core Features (Week 3-4)
**Prerequisite:** Staging environment (Vercel Preview + separate Supabase project) set up before starting.

| Batch | Work | Estimate |
|-------|------|----------|
| P2-5 | Venue reveal + scheduled jobs | 3 days |
| P2-6 | Calendar (.ics) + event sharing | 1 day |
| P2-7 | Stripe payments + cancellation + refunds | 3 days |
| P2-8 | GDPR + member management + no-show tracking | 3 days |
| | **Sprint 2 total** | **10 days** |

### Sprint 3 — Engagement + Growth (Week 5-6)
| Batch | Work | Estimate |
|-------|------|----------|
| P2-9 | Admin QoL (duplicate event, simple messaging, failed notifications) | 1.5 days |
| P2-10 | Profile completion + post-event engagement + social proof + past events | 2 days |
| P2-11 | SEO + structured data + llms.txt | 1.5 days |
| P2-12 | Contact + collaborate pages + Instagram | 1.5 days |
| | **Sprint 3 total** | **6.5 days** |

**Phase 2 total: ~25 working days (5 weeks)**

---

## Testing Strategy

Phase 1 ended with 513 passing tests. Phase 2 maintains that discipline:

| Area | Testing Approach |
|------|-----------------|
| Auth fix | Integration tests: login → session → header state → logout |
| Email verification | Unit test OTP flow, integration test booking gate |
| Stripe webhooks | Unit tests with mocked Stripe events, test idempotency (same event twice → no duplicate), test signature rejection |
| Email sending | Mock Resend in tests, verify correct template + data sent |
| Scheduled jobs | Unit test the selection queries (which events need venue reveal today, etc.) |
| GDPR export | Integration test: create user data → export → verify all data included |
| RLS changes | Security tests: banned user can't book, suspended user can't book |
| Booking cancellation | Integration: cancel → refund triggered → waitlist promoted → emails sent |

Every batch includes tests. No batch merges without `pnpm tsc --noEmit && pnpm lint && pnpm test` passing.

---

## Risk Register

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Stripe webhook failures | Booking confirmed but not recorded | Idempotency keys + `notifications` table logging + admin retry view |
| Scheduled job email failures | Users miss venue reveal or reminders | Retry mechanism in edge function + admin failed-notification view |
| Supabase free tier limits | DB or auth limits hit | Monitor usage in PostHog. Supabase free tier: 500MB DB, 50K MAU, 1GB storage — comfortable for 1,000 members |
| Resend deliverability | Emails go to spam | Verify domain with SPF/DKIM/DMARC during Resend setup |
| Migration breaks prod data | Lost bookings/payments | Daily Supabase backups (7-day retention). Test all migrations against staging first. |
| Twilio trial credit runs out | SMS stops working | Budget ~$20/month. Alert when credit is low. Emails always work as fallback. |
