# Phase 2 Plan — The Social Seen

**Created:** 2026-04-11
**Status:** Draft for review
**Scope:** Bugs, missing features, integrations, and platform decisions

---

## Current State Summary

Phase 1 delivered: project setup, Supabase schema (16 migrations), marketing pages, event listing/detail, 3-step registration, login, member profile/bookings, admin dashboard, gallery, reviews, dark mode, and security hardening.

**What's working:** Schema, RLS policies, event CRUD, booking flow (free events), profile editing, admin pages, auth signup/login.

**What's broken/missing:** Auth state in header (critical), no email verification, no payments, no email/SMS notifications, no GDPR compliance, no phone collection, no venue reveal logic, no referrals, no contact page, limited SEO.

---

## Platform & Tooling Decisions (Zero Budget)

| Need | Recommendation | Free Tier | Notes |
|------|---------------|-----------|-------|
| **Transactional Email** | **Resend** | 3,000 emails/month | Welcome emails, booking confirmations, venue reveals, reminders. Already in CLAUDE.md as planned. |
| **Email Marketing** | **Resend Audiences** or **Brevo (Sendinblue)** | Resend: same 3k limit; Brevo: 300 emails/day | For newsletters and marketing blasts. Brevo has better free tier for marketing (9,000/month). Start with Resend for transactional, add Brevo later if needed. |
| **SMS/WhatsApp** | **Twilio** (traditional SMS) | Free trial ~$15 credit | WhatsApp Business API requires Meta business verification + approved message templates. Not free. **Recommendation:** Start with Twilio SMS for transactional (event reminders, venue reveals). WhatsApp is Phase 3 — requires business verification and has per-conversation costs (~£0.03/conversation). For now, keep your existing WhatsApp group for community chat. |
| **Payments** | **Stripe** | No monthly fee, 1.4% + 20p per UK card | Already planned. Only pay per transaction. No upfront cost. |
| **Analytics** | **PostHog** | 1M events/month free | Already have PostHog MCP connected. Add the JS snippet. |
| **Error Reporting** | **Sentry** | 5K errors/month free | Add `@sentry/nextjs` SDK. |
| **Calendar Integration** | **ICS file generation** | Free (code only) | Generate `.ics` files for "Add to Calendar" — works with Google, Apple, Outlook. No API needed. |
| **Instagram** | **Instagram Basic Display API** or **embed** | Free | Pull recent posts via API, or use Instagram's oEmbed for simpler integration. |

---

## Phase 2 Batches

### Batch P2-1: Critical Auth Fix + Header State (Priority: BLOCKER)

**The Bug:** After login, the Header still shows "Sign In" instead of the user's avatar/name. This blocks access to Profile and Admin pages.

**Root Cause Analysis:** The Header component (`src/components/layout/Header.tsx:62-125`) uses both `onAuthStateChange` and a pathname-triggered `getSession()` check. The issue is likely that:
1. Supabase SSR cookies aren't being read correctly by the browser client
2. The `getSession()` call on line 104 may be returning null because the session cookie hasn't been set yet after redirect
3. The middleware (`src/lib/supabase/middleware.ts`) may not be refreshing the session properly

**Tasks:**
- [ ] Debug and fix auth session detection in Header — verify cookie flow from login → redirect → Header mount
- [ ] Ensure `onAuthStateChange` fires on the `SIGNED_IN` event after login redirect
- [ ] Remove console.log debug statements (lines 102-103, 106) once fixed
- [ ] Test: login → header shows avatar dropdown with Profile + Dashboard (admin) links
- [ ] Test: logout → header reverts to "Sign In" button
- [ ] Test: page refresh maintains auth state
- [ ] Test: admin user sees "Dashboard" link in dropdown

**Files:** `src/components/layout/Header.tsx`, `src/lib/supabase/client.ts`, `src/lib/supabase/middleware.ts`, `src/app/(auth)/login/login-form.tsx`

---

### Batch P2-2: Registration Enhancements

**Tasks:**
- [ ] Add `phone_number` column to `profiles` table (new migration) — text, nullable
- [ ] Add `email_consent` column to `profiles` table — boolean, default false
- [ ] Add `email_verified` column to `profiles` table — boolean, default false
- [ ] Update `handle_new_user()` trigger to accept phone from `raw_user_meta_data`
- [ ] Add phone number field to Step 1 of JoinForm (`src/app/(auth)/join/join-form.tsx`)
  - UK format validation (+44 or 07...)
  - Label: "Phone Number" with helper text "We'll send you event reminders via SMS"
- [ ] Add email marketing consent checkbox to Step 1
  - Label: "Keep me updated with new events and offers"
  - Must be unchecked by default (GDPR)
  - Store in `profiles.email_consent`
- [ ] Update `signUp` server action to pass phone + consent to Supabase user metadata
- [ ] Test: registration captures phone and consent, stored in profiles

**Files:** New migration, `join-form.tsx`, `src/app/(auth)/actions.ts`, `src/types/index.ts`

---

### Batch P2-3: Email Verification (OTP)

**Tasks:**
- [ ] Integrate Supabase Auth email OTP — use `supabase.auth.signUp()` with `emailRedirectTo` disabled, then prompt for OTP
- [ ] Add Step 1.5 to registration: after account creation, show a 6-digit OTP input screen
  - "We've sent a code to [email]. Enter it below."
  - Resend code button (60s cooldown)
  - Auto-submit on 6th digit
- [ ] Use `supabase.auth.verifyOtp({ email, token, type: 'signup' })` to confirm
- [ ] Set `profiles.email_verified = true` on successful verification
- [ ] Gate interest selection (Step 2) behind verified email
- [ ] Add verification check to login flow — if unverified, redirect to verify screen
- [ ] Test: signup → OTP sent → correct code proceeds → wrong code shows error → resend works

**Supabase config:** Enable email OTP in Supabase Auth settings (Dashboard → Authentication → Email → Enable OTP). Set OTP expiry to 10 minutes.

**Files:** New OTP step component, `join-form.tsx`, `src/app/(auth)/actions.ts`, `src/app/(auth)/verify/page.tsx` (new)

---

### Batch P2-4: Transactional Email (Resend)

**Tasks:**
- [ ] Install `resend` package
- [ ] Create `src/lib/email/resend.ts` — Resend client setup
- [ ] Create `src/lib/email/templates/` directory with React Email templates:
  - `welcome.tsx` — sent on registration completion
  - `booking-confirmation.tsx` — sent when user books an event (includes event details, but **not** venue if venue is hidden)
  - `venue-reveal.tsx` — sent 7 days before event with venue name + address + Google Maps link
  - `event-reminder.tsx` — sent 2 days before + day of event
- [ ] Create `src/lib/email/send.ts` — wrapper functions: `sendWelcomeEmail()`, `sendBookingConfirmation()`, `sendVenueReveal()`, `sendReminder()`
- [ ] Wire welcome email into registration completion (after OTP verify)
- [ ] Wire booking confirmation into booking flow
- [ ] For venue reveal + reminders: these need **scheduled jobs** (see Batch P2-5)

**Resend setup:** Create account at resend.com, verify your domain, get API key → `RESEND_API_KEY` in `.env.local`

**Files:** `package.json`, `src/lib/email/*`, integration points in auth actions and booking actions

---

### Batch P2-5: Venue Reveal + Scheduled Notifications

**The Feature:** Events often don't share venue until 1 week before. Users who book get the venue revealed via email/SMS at the right time.

**Schema changes (new migration):**
- [ ] Add `venue_revealed` boolean to `events` table (default `true`)
  - When `false`: event detail page shows "Venue revealed 1 week before" instead of address
  - Admin can toggle this when creating/editing events
- [ ] Add `postcode` column to `events` table (text, nullable) — for Google Maps link
- [ ] Add `venue_reveal_date` computed or admin-set field (default: `date_time - 7 days`)

**Frontend:**
- [ ] Event detail page: conditionally show venue or "Venue TBA — revealed 1 week before the event"
- [ ] When venue is shown: display postcode as a Google Maps link (`https://www.google.com/maps/search/?api=1&query={postcode}`)
- [ ] Admin event form: add "Hide venue until 1 week before" toggle

**Scheduled jobs (options):**
1. **Supabase Edge Functions + pg_cron** (free) — Run a daily cron that:
   - Finds events where `venue_revealed = false` AND `date_time - 7 days <= now()`
   - Sends venue reveal emails to all confirmed attendees
   - Sets `venue_revealed = true`
   - Sends 2-day reminders for events where `date_time - 2 days <= now()`
   - Sends day-of reminders for events where `date_time::date = current_date`
2. **Alternative:** Vercel Cron (free tier: 1 cron job) — hit an API route daily

**Recommendation:** Use **Supabase Edge Functions + pg_cron** — it's free and keeps everything in one platform. Create a single daily edge function that handles all scheduled notifications.

**Files:** New migration, `src/app/events/[slug]/page.tsx`, `src/components/events/EventDetailClient.tsx`, admin event form, new Supabase Edge Function

---

### Batch P2-6: Calendar Integration + Google Maps

**Tasks:**
- [ ] Create `src/lib/utils/calendar.ts` — generates ICS file content for an event
  - Include: title, description, start/end time, location (if revealed), organizer
- [ ] Add "Add to Calendar" button on booking confirmation / ticket card
  - Downloads `.ics` file (works with Google Calendar, Apple Calendar, Outlook)
- [ ] Add Google Maps link on event detail page when venue is revealed
  - Use postcode: `https://www.google.com/maps/search/?api=1&query={encoded_address}+{postcode}`
  - Show as button: "Get Directions" with map pin icon
- [ ] Test: ICS file opens correctly in calendar apps, Maps link opens correct location

**Files:** `src/lib/utils/calendar.ts` (new), booking confirmation component, event detail component

---

### Batch P2-7: Payments (Stripe)

**Tasks:**
- [ ] Install `stripe` and `@stripe/stripe-js` packages
- [ ] Create `src/lib/stripe/server.ts` — Stripe server client
- [ ] Create `src/lib/stripe/client.ts` — Stripe client for checkout
- [ ] Create Stripe Checkout Session flow:
  - User clicks "Book" on paid event → Server Action creates Checkout Session → redirect to Stripe hosted page → success/cancel redirect back
  - On success webhook: update booking status to `confirmed`, store Stripe payment ID
- [ ] Add `stripe_payment_id` column to `bookings` table (new migration)
- [ ] Add `stripe_customer_id` column to `profiles` table (new migration)
- [ ] Create webhook handler: `src/app/api/stripe/webhook/route.ts`
  - Handle `checkout.session.completed` → confirm booking
  - Handle `charge.refunded` → cancel booking
- [ ] Update booking flow: free events skip Stripe, paid events go through Stripe Checkout
- [ ] Admin: display payment status on booking list

**Stripe setup:** Create Stripe account (free), get keys → `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` in `.env.local`

**Files:** New migration, `package.json`, `src/lib/stripe/*`, `src/app/api/stripe/webhook/route.ts`, booking components

---

### Batch P2-8: Member Management + GDPR

**Tasks:**

**Admin: Ban/Suspend Members**
- [ ] Add `status` column to `profiles` — enum: `active`, `suspended`, `banned` (new migration, default `active`)
- [ ] Admin members page: add ban/suspend actions with confirmation modal
- [ ] Banned users: block login (check in middleware), show "Account suspended" message
- [ ] Suspended users: block booking but allow login + viewing events
- [ ] Update RLS: banned users can't insert bookings

**GDPR Compliance**
- [ ] "Download My Data" button on profile page
  - Server Action that exports: profile data, bookings, reviews, interests as JSON
  - Delivered as downloadable `.json` file
- [ ] "Delete My Account" button on profile page
  - Confirmation modal: "This will permanently remove your data within 30 days"
  - Soft-delete immediately (set `deleted_at`), schedule hard delete after 30 days
  - Sign out user after deletion request
  - Admin sees deletion requests in dashboard
- [ ] Privacy policy page (`/privacy`) — required for GDPR
- [ ] Cookie consent banner (if using PostHog/analytics cookies)

**LinkedIn URL**
- [ ] Currently stored but not used. Add to profile card display:
  - Show LinkedIn icon + link on member's public profile
  - On event attendee list (admin view): show LinkedIn links for networking facilitation
  - Future: could be used for member directory

**Files:** New migration, `src/app/(member)/profile/page.tsx`, `src/app/(admin)/admin/members/page.tsx`, new Server Actions, new privacy page

---

### Batch P2-9: Profile Completion + Incentives

**The Challenge:** Getting users to complete their profile. Some events cost you money (crazy golf), some don't (drinks).

**Tasks:**
- [ ] Create `profile_completion_score` computed function or column:
  - Full name: 10%, Avatar: 20%, Job title: 10%, Company: 10%, Industry: 10%, Bio: 15%, LinkedIn: 15%, Phone: 10%
  - Display as progress bar on profile page
- [ ] "Complete Your Profile" banner on member pages when score < 100%
  - Shows which fields are missing
  - Gold progress bar with percentage
- [ ] **Profile-gated free events:**
  - Add `requires_complete_profile` boolean to `events` table (default false)
  - Admin can mark certain free events (the ones that cost you money, like crazy golf) as requiring complete profile
  - When user tries to book: if profile incomplete, show modal: "Complete your profile to unlock this free event"
  - Low-cost events (drinks at a bar) don't require complete profile — admin decides per event
- [ ] Test: incomplete profile user blocked from profile-gated events, can book unrestricted events

**Files:** New migration, profile page, booking flow, admin event form

---

### Batch P2-10: Referral System

**Tasks:**
- [ ] Create `referrals` table:
  ```
  referrals (
    id uuid PK,
    referrer_id uuid FK → profiles,
    referred_email text,
    referred_id uuid FK → profiles (nullable, set when they sign up),
    referral_code text unique,
    status: pending/completed/rewarded,
    created_at, updated_at
  )
  ```
- [ ] Generate unique referral code per user (e.g., `SEEN-{first_name}-{4_random_chars}`)
- [ ] Add referral code display + share button on profile page
  - "Invite friends" section with shareable link: `thesocialseen.com/join?ref=SEEN-MITESH-X7K2`
  - Copy link, share via WhatsApp, share via email
- [ ] On registration: detect `ref` query param, store in referral record
- [ ] When referred user completes registration: mark referral as `completed`
- [ ] **Rewards (Phase 2 scope: tracking only)**
  - Display referral count on profile: "You've invited 3 friends"
  - Admin dashboard: referral leaderboard
  - Actual reward mechanics (free tickets, discounts) → Phase 3 when Stripe is mature

**Files:** New migration + RLS, `src/app/(member)/profile/page.tsx`, `src/app/(auth)/join/join-form.tsx`, new Server Actions

---

### Batch P2-11: Bespoke Event Messaging (Admin Comms)

**The Problem:** You need to send custom messages to event attendees — guest lists, mini-group assignments, special instructions. Currently done via WhatsApp.

**Tasks:**
- [ ] Admin event page: "Message Attendees" section
  - Compose a custom message (rich text editor)
  - Send to: all attendees, specific attendees (checkbox selection), or mini-groups
- [ ] **Mini-groups feature:**
  - Admin can create named groups from event attendees (e.g., "Table 1", "Team A")
  - Drag-and-drop or checkbox assignment
  - Send group-specific messages: "You're on Guest List A — arrive at 7pm"
- [ ] Messages delivered via email (Resend) — SMS optional if Twilio is set up
- [ ] Message history: log all sent messages per event (use existing `notifications` table)
- [ ] Attendee view: notification inbox or email-only

**Recommendation for now:** Keep WhatsApp for real-time community chat. Use the in-app messaging for **structured notifications** (guest lists, logistics). This gives you a paper trail and doesn't require attendees to be in your WhatsApp group.

**Files:** `src/app/(admin)/admin/events/[id]/page.tsx`, new message composer component, email templates, notifications table usage

---

### Batch P2-12: Contact + Collaboration Pages

**Tasks:**
- [ ] Create `/contact` page
  - Contact form: name, email, subject (dropdown: General, Event Enquiry, Collaboration, Press), message
  - Sends email to your team via Resend
  - Success message: "We'll get back to you within 48 hours"
- [ ] Create `/collaborate` page
  - For brands, venues, sponsors wanting to partner
  - Form: company name, contact name, email, type of collaboration, message
  - Sends to team email
- [ ] Add both pages to footer navigation

**Files:** `src/app/contact/page.tsx` (new), `src/app/collaborate/page.tsx` (new), footer component, Resend integration

---

### Batch P2-13: SEO + AI Discoverability

**Tasks:**
- [ ] `src/app/sitemap.ts` — dynamic sitemap (events, static pages)
- [ ] `src/app/robots.ts` — robots.txt allowing crawlers
- [ ] Structured data (JSON-LD) on:
  - Event pages: `Event` schema (name, date, location, price, availability)
  - Home page: `Organization` schema
  - Reviews: `AggregateRating` schema
- [ ] Open Graph images for all pages (currently only events have them)
- [ ] `<meta>` descriptions on all pages
- [ ] Semantic HTML audit: ensure proper heading hierarchy, landmarks, alt text
- [ ] `llms.txt` file in `/public` — for AI crawlers (describes what the site is, what events are available)
- [ ] Canonical URLs on all pages
- [ ] Performance: ensure images use `next/image` with proper sizing, lazy loading

**Files:** `src/app/sitemap.ts`, `src/app/robots.ts`, JSON-LD components, page metadata updates, `public/llms.txt`

---

### Batch P2-14: Instagram Integration

**Tasks:**
- [ ] **Option A (Simple — recommended for now):** Instagram embed feed
  - Use Instagram's oEmbed API to display recent posts
  - Add Instagram feed section to gallery page or homepage
  - "Follow us on Instagram" button with direct link to profile
- [ ] **Option B (Advanced — Phase 3):** Instagram Basic Display API
  - Pull actual photos from your Instagram account
  - Display in gallery grid
  - Requires Facebook Developer App approval
- [ ] Add Instagram follow button to:
  - Footer (already have social links?)
  - Gallery page header
  - Post-booking confirmation ("Follow us for behind-the-scenes")

**Recommendation:** Start with Option A (embed + follow link). The Basic Display API is being deprecated by Meta in favor of the Instagram Graph API, which requires a Facebook Page. Not worth the hassle for Phase 2.

**Files:** Gallery page, footer, new Instagram embed component

---

### Batch P2-15: User Photos + Avatar Upload

**Tasks:**
- [ ] Profile page: avatar upload with crop/resize
  - Upload to Supabase Storage `avatars` bucket
  - Max 2MB, JPEG/PNG only
  - Update `profiles.avatar_url`
- [ ] Optional: let users submit event photos
  - After attending an event, show "Share your photos" prompt
  - Upload to `event-photos` bucket
  - Admin moderation queue before public display
- [ ] Gallery page: mix admin-uploaded + user-submitted (moderated) photos

**Files:** Profile page, photo upload component, Supabase Storage policies, admin moderation

---

### Batch P2-16: Analytics + Error Reporting

**Tasks:**
- [ ] **PostHog:**
  - Install `posthog-js`
  - Add PostHog provider to `layout.tsx`
  - Track key events: page views (automatic), sign up, login, event view, booking, profile completion
  - Env var: `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST`
- [ ] **Sentry:**
  - Install `@sentry/nextjs`
  - Run `npx @sentry/wizard@latest -i nextjs`
  - Configure error boundaries (already have `error.tsx` files)
  - Env var: `SENTRY_DSN`, `SENTRY_AUTH_TOKEN`

**Files:** `package.json`, `layout.tsx`, `sentry.client.config.ts`, `sentry.server.config.ts`, `next.config.ts`

---

## Batch Priority Order

| Priority | Batch | Why |
|----------|-------|-----|
| **P0 — BLOCKER** | P2-1: Auth Fix | Site is unusable without this |
| **P0 — BLOCKER** | P2-2: Registration Enhancements | Need phone numbers for SMS |
| **P1 — Core** | P2-3: Email Verification | Security + spam prevention |
| **P1 — Core** | P2-4: Transactional Email | Welcome + booking confirmations |
| **P1 — Core** | P2-7: Payments | Can't charge for events without this |
| **P1 — Core** | P2-8: GDPR + Member Mgmt | Legal requirement + admin needs |
| **P2 — Important** | P2-5: Venue Reveal + Scheduling | Key differentiator for your model |
| **P2 — Important** | P2-6: Calendar + Maps | Quick wins, big UX improvement |
| **P2 — Important** | P2-9: Profile Completion | Drive engagement |
| **P2 — Important** | P2-11: Bespoke Messaging | Replace WhatsApp for logistics |
| **P3 — Growth** | P2-10: Referrals | Growth mechanism |
| **P3 — Growth** | P2-12: Contact + Collab | Business development |
| **P3 — Growth** | P2-13: SEO + AI | Discoverability |
| **P3 — Growth** | P2-14: Instagram | Social proof |
| **P3 — Growth** | P2-15: User Photos | Community engagement |
| **P4 — Ops** | P2-16: Analytics + Errors | Monitoring (do early but low code effort) |

---

## Things You Didn't Mention (But Should Consider)

1. **Password Reset Flow** — No "Forgot Password" link exists. Users who forget their password are locked out. Supabase Auth supports this natively; we just need the UI.

2. **Rate Limiting on Auth** — Currently no protection against brute-force login attempts. Add rate limiting via Supabase or middleware.

3. **Email Change Flow** — If a user wants to change their email, Supabase requires re-verification. Need UI for this.

4. **Event Cancellation by Admin** — Schema has `is_cancelled` but no UI or notification flow. When admin cancels an event, all attendees should be notified and offered refunds.

5. **Waitlist Auto-Promotion** — Currently mocked. When someone cancels a booking, the next waitlisted person should be auto-promoted and notified. This should be a Supabase function triggered by booking cancellation.

6. **Terms of Service Page** — Required alongside Privacy Policy, especially if collecting payments.

7. **Accessibility Audit** — The site should meet WCAG 2.1 AA. Focus areas: color contrast on gold text, keyboard navigation, screen reader labels.

8. **Mobile App / PWA** — Your members are on WhatsApp = mobile-first. Consider making this a PWA (Progressive Web App) so users can "install" it on their phone. Free, just needs a manifest + service worker.

9. **Push Notifications** — Alternative to SMS that's completely free. PWA + Web Push API lets you send notifications to users who opt in. Works on Android and desktop (iOS Safari has limited support).

10. **Event Waitlist Deposits** — For high-demand events, consider a refundable deposit to hold waitlist position. Reduces no-shows.

11. **No-Show Tracking** — You have `no_show` booking status but no way to mark it. Admin should be able to mark attendees as no-shows post-event. Repeat no-shows could affect future booking priority.

12. **Multi-Ticket Bookings** — Currently one booking per user per event. Some users might want to bring a +1. Consider adding a `quantity` field to bookings.

13. **Cookie Policy/Banner** — Required in the UK if using PostHog or any analytics cookies.

14. **Supabase Realtime** — Already have `use-realtime-count.ts` hook planned. Use it for live "spots left" updates on popular events.

---

## Recommended Implementation Order (Sprints)

**Sprint 1 (Week 1-2): Make It Usable**
- P2-1: Auth Fix (1 day)
- P2-2: Registration Enhancements (1 day)
- P2-3: Email Verification (2 days)
- P2-16: Analytics + Errors (0.5 day — do early to catch issues)
- Password Reset Flow (0.5 day)

**Sprint 2 (Week 3-4): Core Features**
- P2-4: Transactional Email (2 days)
- P2-7: Payments (3 days)
- P2-6: Calendar + Maps (1 day)
- P2-8: GDPR + Member Management (2 days)

**Sprint 3 (Week 5-6): Engagement**
- P2-5: Venue Reveal + Scheduling (2 days)
- P2-9: Profile Completion (2 days)
- P2-11: Bespoke Messaging (2 days)
- P2-12: Contact + Collab pages (1 day)

**Sprint 4 (Week 7-8): Growth**
- P2-10: Referrals (2 days)
- P2-13: SEO + AI (2 days)
- P2-14: Instagram (1 day)
- P2-15: User Photos (1 day)
- Terms of Service + Privacy Policy pages (0.5 day)
- PWA setup (0.5 day)

---

## Cost Summary at Scale

| Service | Free Tier | When You'll Outgrow It |
|---------|-----------|----------------------|
| Supabase | 500MB DB, 1GB storage, 50K auth users | ~5,000 members |
| Resend | 3,000 emails/month | ~500 active members with booking confirmations + reminders |
| Stripe | No limit (pay per transaction) | Never — scales with revenue |
| Twilio SMS | ~$15 trial credit (~150 SMS) | Immediately — budget ~£20/month for ~500 SMS |
| PostHog | 1M events/month | ~10,000 monthly active users |
| Sentry | 5K errors/month | Unlikely to hit unless major bugs |
| Vercel | 100GB bandwidth, 1000 builds/month | ~50,000 monthly visitors |

**First real cost:** Twilio SMS (~£20/month) once trial credit runs out. Everything else stays free well past your initial 1,000 members.
