# AMENDMENTS.md — Post-Review Changes

> Produced by: CTO review of SYSTEM-DESIGN.md (architect) + UX-REVIEW.md (UX designer)
> Date: 2026-04-02
> Status: **APPROVED** — execution agents must read this alongside batch prompts

This document overrides batch prompt details where conflicts exist. Read CLAUDE.md → SYSTEM-DESIGN.md → UX-REVIEW.md → this file → then the batch prompt.

---

## Global Changes (apply to ALL batches)

### G-01: Font is DM Sans, not Inter
The prototype was built and approved with **DM Sans**. CLAUDE.md originally specified Inter — that was incorrect. DM Sans is now the locked body font. Do NOT switch to Inter.

### G-02: No hardcoded hex values
Every component must use Tailwind theme tokens or CSS variables. `grep -rn "#[0-9a-fA-F]\{3,8\}" src/components/` should return zero results after Batch 1.

### G-03: Prices display as £ to users
Users see £35, never 3500. How prices are stored in the database is a backend implementation detail. The `formatPrice()` utility handles conversion.

### G-04: Admin email for demo
`mitesh50@hotmail.com` — not social seen email addresses.

### G-05: All agents must read SYSTEM-DESIGN.md and UX-REVIEW.md
These are now in the project root alongside CLAUDE.md. They are required reading before every session.

### G-06: Error boundaries in every route group
Add `error.tsx` at: `src/app/error.tsx` (global), `src/app/(member)/error.tsx`, `src/app/(admin)/error.tsx`. Branded error pages, not white screens.

### G-07: Environment variable validation
`src/lib/supabase/client.ts` and `server.ts` must throw clear errors if `NEXT_PUBLIC_SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_ANON_KEY` are missing.

---

## Batch 1 — Foundation

### Amendment 1.1: Font correction
Replace all DM Sans references with DM Sans (no change needed if prototype already uses it). Ensure `next/font/google` imports DM_Sans. Update Tailwind config `fontFamily.sans` to `['DM Sans', ...]`.

### Amendment 1.2: Schema additions from architect
Add to the schema (beyond what the original batch prompt specified):
- `profiles.onboarding_complete` (boolean, default false)
- `profiles.referral_source` (text, nullable)
- `profiles.updated_at` (timestamptz, default now())
- `events.short_description` (text, not null)
- `events.dress_code` (text, nullable)
- `events.is_cancelled` (boolean, default false)
- `events.updated_at` (timestamptz, default now())
- `bookings.price_at_booking` (integer, default 0)
- `bookings.updated_at` (timestamptz, default now())
- `event_reviews.updated_at` (timestamptz, default now())
- `event_inclusions.icon` (text, nullable — Lucide icon name)
- `event_photos.sort_order` (integer, default 0)
- `notifications.recipient_type` (notification_recipient enum)
- `notifications.recipient_event_id` (uuid, nullable FK to events)

### Amendment 1.3: Additional enums
Add `notification_type` and `notification_recipient` enums per SYSTEM-DESIGN.md.

### Amendment 1.4: book_event() RPC function
Create the race-condition-safe booking function per SYSTEM-DESIGN.md Section 1. This replaces application-level check-then-insert for bookings.

### Amendment 1.5: event_with_stats database view
Create the view per SYSTEM-DESIGN.md Section 1. All event listing queries use this view.

### Amendment 1.6: Partial unique index on bookings
`CREATE UNIQUE INDEX idx_bookings_active ON bookings(user_id, event_id) WHERE status != 'cancelled' AND deleted_at IS NULL`

### Amendment 1.7: CHECK constraints
- `events.price >= 0`
- `events.capacity > 0 OR capacity IS NULL`
- `events.end_time > date_time`
- `event_reviews.rating >= 1 AND rating <= 5`
- `bookings.waitlist_position > 0 OR waitlist_position IS NULL`

### Amendment 1.8: 13 separate migration files
Follow the migration plan in SYSTEM-DESIGN.md (001 through 013), not a single monolith migration.

### Amendment 1.9: Error boundaries
Add `error.tsx` files per G-06.

### Amendment 1.10: Env var validation
Add validation per G-07.

---

## Batch 2 — Marketing Pages

### Amendment 2.1: Nav links are routes, not hash anchors
Header links: `/events`, `/gallery`, `/join`, `/login` (or Sign In). NOT `#events`, `#gallery`, etc.

### Amendment 2.2: Remove "About" from header nav
About page still exists at `/about` but is only linked from the footer. Header nav for unauthenticated: `Events | Gallery | Join | Sign In`. Authenticated: `Events | Gallery | My Bookings | [Avatar dropdown]`.

### Amendment 2.3: Hero copy update
- Keep headline: "Where Connections Become Stories"
- Update subtitle to: "Supper clubs. Gallery openings. Rooftop drinks. London's most interesting professionals, one unforgettable evening at a time."
- Primary CTA: "See What's On" (not "Explore Events")
- Secondary CTA: "Become a Member" (not "Join The Social Seen")

### Amendment 2.4: Social proof copy
"Join 1,000+ London professionals" instead of just "1,000+ members". Add sub-stats: events hosted count, average rating.

### Amendment 2.5: Testimonials from real review data
Pull highest-rated reviews from `event_reviews` joined with profiles and events. Display reviewer name, star rating, event name.

---

## Batch 3 — Event Pages

### Amendment 3.1: Use event_with_stats view
Events listing queries `event_with_stats` instead of joining bookings/reviews manually. Client-side filtering for category and price (demo scale is <100 events).

### Amendment 3.2: Sticky mobile booking bar
Add fixed bottom bar on mobile event detail pages (per UX-REVIEW CF-03). Shows price + spots + CTA. Appears when desktop sidebar scrolls out of view (IntersectionObserver). Include `safe-area-inset-bottom` padding.

### Amendment 3.3: Waitlist messaging is positive
- Card badge: gold "Join Waitlist" (not red "Waitlist")
- Detail page: "This event is fully booked — join the waitlist"
- Subtext: "Most waitlisted members get a spot — we'll let you know the moment one opens"
- Waitlist CTA button uses gold (primary style), not muted/dark

### Amendment 3.4: Date format standardisation
Three tiers per UX-REVIEW RC-06:
- Card: `Sat 14 Mar`
- Modal: `Saturday 14 March, 7:00 PM`
- Full detail: `Saturday 14 March 2026`

### Amendment 3.5: Event detail page queries
Follow the query map in SYSTEM-DESIGN.md Section 2. Use `Promise.all()` for parallel fetching.

---

## Batch 4 — Auth

### Amendment 4.1: Registration shortened to 3 steps (CRITICAL)
This is the most important change from the UX review.

| Step | Content | Fields |
|------|---------|--------|
| 1 — Account | "Create Your Account" | Full name, email, password. Optional "How did you hear about us?" dropdown. Disabled "Continue with Google" button with "Coming soon" tooltip. |
| 2 — Interests | "What interests you?" | Visual interest tag grid. At least 1 required. |
| 3 — Welcome | "You're In" | Styled welcome card, CTAs to "Complete Your Profile" and "See What's On" |

**Removed from registration:** Job title, company, industry, LinkedIn, bio, photo upload. These move to the profile page as a "Complete Your Profile" prompt.

### Amendment 4.2: onboarding_complete flag
Set `onboarding_complete = true` after Step 3 (Welcome). The member layout checks this flag — if false, redirect to `/join?step=2`.

### Amendment 4.3: Profile completion prompt
After first login, if `onboarding_complete = true` but `job_title IS NULL`, show a "Complete Your Profile" banner at the top of the profile page: "Profiles with a photo get noticed more. Add your details →"

### Amendment 4.4: Error messages
Use UX-REVIEW RC-04 copy:
- Name: "We'll need your name to get started"
- Email: "Enter your email to create your account"
- Password: "Choose a password (at least 8 characters)"
- Interests: "Pick at least one — we'll use this to show you events you'll love"
- Email exists: "Looks like you're already a member — sign in instead?"

### Amendment 4.5: Login redirect preservation
On redirect to /login from a protected route, preserve the original URL: `/login?redirect=/events/wine-and-wisdom`. After login, redirect back.

### Amendment 4.6: Email verification disabled for demo
Supabase Auth email confirmation = OFF. Users sign up and are immediately active. No OTP, no confirmation link, no email check. Production will add inline OTP during Step 1 — but that's a post-demo task.

---

## Batch 5 — Member Pages

### Amendment 5.1: "Complete Your Profile" banner
Build a dismissible banner/card at the top of the profile page for users with incomplete profiles (no job title, no photo, etc.). "Profiles with a photo get noticed more. Complete yours →"

### Amendment 5.2: Empty state copy (from UX-REVIEW)
- Upcoming bookings empty: "Your next event awaits. Browse what's coming up this month →"
- Past bookings empty: "Once you've attended your first event, it'll appear here — along with photos and reviews from the evening."
- Waitlisted empty: "Nothing on the waitlist right now. Popular events fill fast — bookmark ones you're interested in."

### Amendment 5.3: Event reminder highlight
For events within 48 hours, show a gold border glow and "Tomorrow at 7 PM — see you there!" microcopy. (Can defer to Batch 9 if time-constrained.)

---

## Batch 6 — Booking Flow

### Amendment 6.1: Free events = 2 steps (CRITICAL)
| Step | Content |
|------|---------|
| 1 — Confirm | Event summary, optional "Special requirements" (collapsed), "Reserve My Spot" button. "Bringing a guest? Add spots" link. |
| 2 — Success | Styled ticket card (see Amendment 6.3), Add to Calendar, Share, Close |

### Amendment 6.2: Paid events = 3 steps
| Step | Content |
|------|---------|
| 1 — Confirm | Event summary, spot selection if group, "Continue to Payment" |
| 2 — Payment | Mock Stripe form with DISABLED INPUTS (not divs). Pre-filled test data. "Demo mode — no real charges" banner. Stripe lock icon + "Powered by Stripe" footer. |
| 3 — Success | Same ticket card as free events |

### Amendment 6.3: Confirmation is a ticket card, not confetti
Replace confetti with a styled confirmation card designed to be screenshot-worthy:
```
┌─────────────────────────────────────────┐
│  THE SOCIAL SEEN                        │
│                                         │
│  Wine & Wisdom at Borough Market        │
│  Saturday 14 March, 7:00 PM             │
│  The Vinopolis Wine Cellar              │
│                                         │
│  1 spot confirmed                       │
│  [User Name]                            │
│                                         │
│  Dress code: Smart Casual               │
│  Arrive by: 6:45 PM                     │
│                                         │
│  [Add to Calendar]   [Share]            │
└─────────────────────────────────────────┘
```
Subtle gold shimmer animation on card appearance. Heading: "See You There" (not "You're going!").

### Amendment 6.4: Booking uses book_event() RPC
Server Action calls `supabase.rpc('book_event', { p_user_id, p_event_id })` instead of direct insert. The RPC handles race conditions with row locking.

### Amendment 6.5: Mobile booking modal = bottom sheet
On mobile (<768px), modal renders as bottom sheet (slides up from bottom, rounded top corners, drag handle). On desktop, centered card as before.

---

## Batch 7 — Reviews & Gallery

### Amendment 7.1: ReviewForm must be built (CRITICAL)
The review form does not exist yet. Build it with:
- Star rating selector (tappable, gold fill on select)
- Optional text field ("What made this event special?")
- 500 character limit with counter (not 300 — 300 feels restrictive)
- Submit via Server Action that validates: auth, confirmed booking, past event, no existing review

### Amendment 7.2: Review discovery
After attending an event, show a toast/banner on next site visit: "How was [Event Name]? Share your experience →"

### Amendment 7.3: Gallery lightbox keyboard + swipe
Arrow keys for desktop navigation. Escape to close. Mobile swipe gestures for next/prev.

---

## Batch 8 — Admin

### Amendment 8.1: Admin email
Use `mitesh50@hotmail.com` for the demo admin account.

### Amendment 8.2: Waitlist management prominence
One-click "Promote" button next to each waitlisted member on the event bookings view.

### Amendment 8.3: Event form slug preview
Show live preview: "thesocialseen.com/events/[slug]" as admin types the title.

---

## Batch 9 — Polish

### Amendment 9.1: Gold/cream skeleton shimmer
Skeleton loading states use the brand palette with a slow shimmer (2s cycle), not grey boxes with rapid pulse.

### Amendment 9.2: Touch target audit
All interactive elements minimum 44×44px. Known issues from UX review: hamburger icon, theme toggle, modal close buttons.

### Amendment 9.3: Safe area insets
All fixed-bottom elements include `pb-[env(safe-area-inset-bottom)]`.

### Amendment 9.4: Attendee avatars on event cards (stretch)
If time allows: overlapping avatar circles with "+12 going" on event cards and detail pages.

### Amendment 9.5: Dark mode defaults to light
Light (cream) is the default. Dark mode available via toggle. Respect `prefers-color-scheme` on first visit.

---

## Decision Log

| # | Decision | Source | Rationale |
|---|----------|--------|-----------|
| 1 | DM Sans, not Inter | CTO override | Prototype was approved with DM Sans |
| 2 | Registration 3 steps, not 5 | UX-REVIEW CF-02 | Charlotte bounces at mandatory professional details |
| 3 | Ticket card, not confetti | UX-REVIEW RC-02 | Screenshot-worthy = organic marketing |
| 4 | book_event() RPC | SYSTEM-DESIGN ADR-03 | Race condition prevention |
| 5 | event_with_stats view | SYSTEM-DESIGN ADR-04 | Centralised aggregation logic |
| 6 | Positive waitlist messaging | UX-REVIEW RC-05 | Gold not red, "most get a spot" |
| 7 | No "About" in header nav | UX-REVIEW CF-06 | Wasted nav real estate |
| 8 | Google OAuth deferred | CTO decision | Include disabled button, build post-demo |
| 9 | Admin email mitesh50@hotmail.com | CTO decision | No social seen emails yet |
| 10 | Past events accordion on /events | Deferred to UX designer | UX question, not architecture |
| 11 | 500 char review limit, not 300 | UX-REVIEW CF-05 | 300 feels restrictive |
| 12 | Error boundaries in Batch 1 | SYSTEM-DESIGN OQ-07 | Cheap insurance |
| 13 | Env var validation in Batch 1 | SYSTEM-DESIGN OQ-08 | Prevents confusing runtime errors |
| 14 | Email verification disabled for demo | SYSTEM-DESIGN ADR-12 + UX-REVIEW Q9 | Demo friction. Production: inline OTP during Step 1, not deferred link |
| 15 | Passwords retained (not passwordless) | UX-REVIEW Q9 | Weekly-use platform — password managers auto-fill on return visits. Passwordless saves 3s at signup, costs 20s on every returning login |
