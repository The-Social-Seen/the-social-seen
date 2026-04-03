# UX-REVIEW.md — The Social Seen

> **Produced by:** UX Designer agent (Phase 2 review)
> **Date:** 2026-04-02
> **Status:** AWAITING APPROVAL — review recommendations before executing changes
> **Tested against:** Charlotte (34, mobile-first), James (41, desktop evaluator), Sophia (38, admin)

---

## Table of Contents

1. [Flow Scores](#1-flow-scores)
2. [Critical Fixes](#2-critical-fixes--must-fix-before-demo)
3. [Recommended Changes](#3-recommended-changes)
4. [Nice-to-Haves](#4-nice-to-haves)
5. [Mobile-Specific Recommendations](#5-mobile-specific-recommendations)
6. [Copy Recommendations](#6-copy-recommendations)
7. [Amendments to Batch Prompts](#7-amendments-to-batch-prompts)

---

## 1. Flow Scores

Each flow is rated 1–5 across three dimensions. 5 = excellent, 1 = broken.

| Flow | Friction | Clarity | Delight | Weakest Point |
|------|----------|---------|---------|---------------|
| **1. First Visit → Browse** | 4 | 3 | 5 | Hero tagline is abstract; nav links are hash anchors that break on non-landing pages |
| **2. Browse → Decide** | 4 | 4 | 4 | Event cards are well-designed; filter UX needs mobile validation |
| **3. Registration** | 2 | 3 | 4 | **WEAKEST FLOW.** 5 steps with mandatory professional details before a single event is booked. Charlotte bounces at Step 2. |
| **4. Book Free Event** | 3 | 4 | 4 | Booking modal has unnecessary "How many spots?" step for solo attendees; no mobile sticky CTA |
| **5. Book Paid Event** | 3 | 3 | 3 | Mock Stripe form uses non-interactive divs — James the fintech founder notices immediately |
| **6. Post-Event Review** | 2 | 2 | 2 | No review submission form exists. Button on profile says "Leave a Review" but there's no form built. Discovery path is passive. |
| **7. Gallery Browse** | 4 | 3 | 4 | Lightbox has no keyboard navigation (arrow keys) or mobile swipe |
| **8. Admin Event Creation** | 3 | 3 | 3 | Not fully reviewed — admin sub-routes are listed as missing in SYSTEM-DESIGN.md |

**Overall weakest flow: Registration (Flow 3).** This is also the highest-risk flow — it's the gate between browsing and booking. Every improvement here has outsized impact on conversion.

---

## 2. Critical Fixes — Must Fix Before Demo

These are issues that would cause Charlotte to bounce, James to question the product, or Sophia to doubt the engineering quality.

### CF-01: Navigation Links Are Hash Anchors, Not Routes

**Problem:** The Header component uses `#events`, `#gallery`, `#about`, `#join` as nav hrefs. These are section anchors that only work on the landing page. Navigate to `/events` or `/profile`, click "Events" in the header, and nothing happens — or the page scrolls to a non-existent element.

**Impact:** Charlotte can't get back to events from any interior page using the nav. This is a broken navigation system.

**Fix:** Change nav links to actual page routes:
- `#events` → `/events`
- `#gallery` → `/gallery`
- `#about` → remove from main nav (move to footer — see CF-06)
- `#join` → `/join`

Add a "Sign In" link to the header nav for unauthenticated users. When authenticated, show "Profile" or the user's avatar instead.

### CF-02: Registration Is Too Long — Shorten to 3 Steps

**Problem:** The 5-step registration wizard requires:
- Step 1: Name, email, password (reasonable)
- Step 2: Job title, company, industry — **all required** (too much, too soon)
- Step 3: Interests — **at least 1 required** (acceptable)
- Step 4: "How did you hear about us?" — **required** (business data, not user value)
- Step 5: Welcome confetti

Charlotte's 3-minute budget won't survive Steps 2 and 4. She hasn't attended a single event and you're asking for her employer and LinkedIn. Eventbrite asks for email + name. Soho House has the brand equity to ask for more — The Social Seen doesn't yet.

**Fix:** Restructure to 3 steps:

| Step | Fields | Required? |
|------|--------|-----------|
| 1 — Account | Full name, email, password | All required |
| 2 — Interests | Visual interest tag grid | At least 1 |
| 3 — Welcome | Confetti, CTAs to profile & events | N/A |

Move to the profile page (prompted on first visit):
- Job title, company, industry, LinkedIn → optional "Complete Your Profile" prompt
- "How did you hear about us?" → single dropdown embedded in Step 1 (optional), or on profile page
- Bio, photo → profile page with a gentle nudge: "Profiles with a photo get 3x more event invites"

**Validation change:** Step 2 (About You) currently validates `jobTitle`, `company`, and `industry` as required. Remove these validations from the registration flow.

### CF-03: No Sticky Mobile Booking Bar on Event Detail

**Problem:** On mobile (375px), the two-column event detail layout stacks vertically. The booking card (price + "Book Now" button) falls below the entire event description, host section, and potentially reviews and gallery. Charlotte must scroll past 5–8 screen heights to find the booking action.

**Impact:** Mobile conversion killer. Charlotte sees an interesting event, can't find how to book, bounces.

**Fix:** Add a fixed bottom bar on mobile, visible whenever the desktop sidebar booking card is out of viewport:

```
┌─────────────────────────────────────────┐
│  £35 per person       [  Book Now  ]    │
│  8 spots left                           │
└─────────────────────────────────────────┘
```

Pattern reference: Airbnb listing page mobile bar. The bar should:
- Show price (or "Free")
- Show spots remaining (if < 10)
- Primary CTA: "Book Now" / "RSVP Now" / "Join Waitlist"
- Use `position: fixed; bottom: 0` with `safe-area-inset-bottom` padding for iPhone notch
- Appear only on mobile (hidden on `lg:` and above)
- Only appear when the main booking card is scrolled out of view (use IntersectionObserver)

### CF-04: Mock Stripe Payment Form Is Non-Interactive

**Problem:** The payment step in the booking modal uses `<div>` elements with placeholder text instead of actual `<input>` fields. The card number field displays "4242 4242 4242 4242" as a static `<span>`. Expiry shows "MM / YY" as text, not an input.

**Impact:** James (fintech founder) will immediately notice this isn't a real form. It undermines trust in the entire demo. If the payment form looks fake, the rest of the product feels fake too.

**Fix:** Replace static divs with actual disabled input fields pre-filled with test data:
- Card: `<input disabled value="4242 4242 4242 4242" />` (editable-looking but pre-filled)
- Expiry: `<input disabled value="12/28" />`
- CVC: `<input disabled value="123" />`

Better yet: add a subtle banner above the form: "Demo mode — no real charges" in a soft info blue. This signals intentionality rather than incompetence.

Add a Stripe-style lock icon and "Powered by Stripe" footer (even though it's mocked) to further establish legitimacy.

### CF-05: Review Submission Flow Does Not Exist

**Problem:** The profile page has a "Leave a Review" button on past event cards, but clicking it shows a toast ("Coming soon"). There is no `ReviewForm` component. The review flow from the prompt spec (star rating + text) has not been built.

**Impact:** Sophia can't test the review moderation flow. James can't see authentic reviews being generated. The review system — a key social proof driver — is a dead end.

**Fix:** Build a review submission modal/form that:
- Opens from the "Leave a Review" button on the profile page past events tab
- Shows: event name + date (context), star rating selector (tappable stars), optional text field (placeholder: "What made this event special?"), submit button
- On submit: shows success state with the review rendered as it would appear to others
- Text field should be optional (stars-only reviews reduce friction)
- Character limit: 500 chars with counter, not 300 (300 feels restrictive)

### CF-06: "About" Should Not Be in Main Navigation

**Problem:** The header nav shows Events, Gallery, About, Join. "About" competes with high-intent links. Charlotte doesn't care about "About" — she cares about events. James might read "About" but only after he's explored events.

**Impact:** Wasted nav real estate. "About" pushes higher-value links further right on desktop and adds a scroll-worthy item on mobile.

**Fix:** Remove "About" from header nav. Move to footer. Replace with "Login" / "Sign In" for unauthenticated users, or "Profile" (with avatar) for authenticated users.

New header nav for unauthenticated: `Events | Gallery | Join | Sign In`
New header nav for authenticated: `Events | Gallery | My Bookings | [Avatar]`

---

## 3. Recommended Changes

These meaningfully improve the experience but aren't demo-blocking.

### RC-01: Simplify Booking Modal for Free Events to 2 Steps

**Current:** Free events go through 3 steps: Select Spots → Confirm Details → Confirmation.

**Problem:** For a free event, "Select Spots" is unnecessary friction when Charlotte is booking for herself. Most attendees at networking events come solo. The "Confirm Details" step adds a special requirements textarea that most people won't use.

**Recommended flow for free events:**

| Step | Content |
|------|---------|
| 1 — Confirm | Event summary (name, date, venue), optional "Special requirements" as a collapsible section, "Confirm RSVP" button |
| 2 — Success | "You're going!" + Add to Calendar + Share + Done |

**For paid events, keep 3 steps:** Confirm Details → Payment → Success.

The "How many spots?" step should only appear when explicitly triggered. Add a "Bringing a guest? Add spots" link on the confirm step instead of making it the default first action.

### RC-02: Rethink the Confirmation Celebration

**Current:** Both registration (Step 5) and booking confirmation use confetti animations. The booking confirmation says "You're going!" with a green checkmark and confetti.

**Problem:**
1. Confetti is used twice in the same session for Charlotte (register → book). By the second time, it's no longer delightful — it's repetitive.
2. "You're going!" with confetti feels like every B2C startup. Charlotte has seen this exact pattern on Eventbrite, Luma, and every event platform since 2019.

**Recommendation:**
- **Registration:** Keep the celebration but make it editorial, not explosive. Replace confetti with a slow gold shimmer/glow effect. Show the user's initials in a large serif avatar. Make it feel like an invitation has been accepted, not a prize wheel has been spun.
- **Booking:** Replace confetti with a styled confirmation card that's screenshot-worthy. Design it like an event ticket:

```
┌─────────────────────────────────────────┐
│  THE SOCIAL SEEN                        │
│                                         │
│  Wine & Wisdom at Borough Market        │
│  Saturday 14 March, 7:00 PM             │
│  Borough Market, Southwark              │
│                                         │
│  1 spot confirmed                       │
│  Charlotte Moreau                       │
│                                         │
│  [Add to Calendar]   [Share]            │
└─────────────────────────────────────────┘
```

Charlotte screenshots this and sends it to a friend. That's organic marketing. Confetti can't be shared.

### RC-03: Add Social Proof to Event Cards — Attendee Avatars

**Current:** Event cards show title, date, venue, price, and spots left. No indication of WHO is attending.

**Problem:** James needs to see "his crowd." A card that says "8 spots left" tells him about scarcity but not quality. Showing 3-4 overlapping attendee avatars (like GitHub contributor avatars) with "+12 going" signals both popularity and peer presence.

**Recommendation:** On the event detail page and optionally on cards, show a row of attendee avatar circles:

```
[👤][👤][👤][👤] +12 going
```

For the demo, use seed data avatars. For production, respect privacy settings — only show avatars of users who opt in (default: opt-in for members, visible to other members only).

### RC-04: Improve Error Messages

**Current:** All validation errors are generic:
- "This field is required"
- "Please select an option"
- "Please select at least one interest"

**Problem:** These are developer messages, not brand-appropriate copy. Charlotte expects the same UX quality as Soho House.

**Recommended error messages:**

| Field | Current | Recommended |
|-------|---------|-------------|
| Full Name | "This field is required" | "We'll need your name to get started" |
| Email | "This field is required" | "Enter your email to create your account" |
| Password | "This field is required" | "Choose a password (at least 8 characters)" |
| Interests (none selected) | "Please select at least one interest" | "Pick at least one — we'll use this to show you events you'll love" |
| Email already registered | (not handled) | "Looks like you're already a member — sign in instead?" with a link |

### RC-05: Waitlist Messaging Should Be Positive

**Current:** When an event is sold out, the card shows a red "Waitlist" badge. The detail page says "This event is sold out" in a red box, with "Join Waitlist" in a dark button and "You'll be notified when a spot opens up."

**Problem:** Red badges and "sold out" language frame the waitlist as a failure state. Charlotte sees "Waitlist" and thinks "I can't go" — she moves on.

**Recommendation:**
- Card badge: Change from red "Waitlist" to gold-tinted "Join Waitlist" (uses the gold accent, not danger red)
- Detail page: Replace "This event is sold out" with:
  - "This event is fully booked — join the waitlist"
  - Below the button: "Most waitlisted members get a spot. We'll email you the moment one opens."
- Change the button style from dark/black to gold (consistent with primary CTA treatment) — the waitlist join IS the primary action for sold-out events.

### RC-06: Date Format Consistency

**Current:** Multiple date formats across the site:
- Event card: `EEE, d MMM` → "Sat, 14 Mar"
- Booking modal detail: `EEE d MMM, h:mm a` → "Sat 14 Mar, 7:00 PM"
- Booking confirmation: `EEEE d MMMM, h:mm a` → "Saturday 14 March, 7:00 PM"
- Event detail sidebar: `EEEE d MMMM yyyy` → "Saturday 14 March 2026"
- Event detail quick info: `EEE d MMM yyyy` → "Sat 14 Mar 2026"

**Problem:** Inconsistency feels unpolished to detail-oriented professionals.

**Recommendation:** Standardise to three tiers:

| Context | Format | Example |
|---------|--------|---------|
| Card / compact | `EEE d MMM` | Sat 14 Mar |
| Modal / mid-detail | `EEEE d MMMM, h:mm a` | Saturday 14 March, 7:00 PM |
| Full detail (sidebar, confirmation) | `EEEE d MMMM yyyy` | Saturday 14 March 2026 |

Always include time as `h:mm a` when showing event timing. Never abbreviate with commas inconsistently.

### RC-07: Dark Mode Breaks With Hardcoded Hex Values

**Current:** The BookingModal, EventDetailClient, and several components use hardcoded hex values: `bg-[#FAF7F2]`, `text-[#1C1C1E]`, `border-[#E8D5C4]`, `bg-[#C9A96E]`. These bypass the CSS variable / Tailwind theme system.

**Impact:** When dark mode is toggled, these components remain in light mode. The booking modal — one of the most critical conversion points — won't respect dark mode. Sophia toggling dark mode and seeing half the site break looks amateurish.

**Fix:** Replace all hardcoded hex values with semantic Tailwind tokens (as already flagged in SYSTEM-DESIGN.md ADR-06). This is both a UX fix and a technical hygiene issue.

### RC-08: Google OAuth Should Be Considered for Demo Scope

**Current:** Social login is marked "DEFERRED — Post-demo."

**Argument for promotion:** Google OAuth approximately halves registration friction. Charlotte, browsing on her iPhone, can create an account with a single tap instead of typing name + email + password. The Supabase Auth integration for Google is straightforward. The risk of not including it: Charlotte bounces at the password field because she doesn't want yet another password.

**Recommendation:** If a single day of engineering effort is available, add "Continue with Google" to Step 1 of registration. It's the single highest-ROI feature for signup conversion. If not feasible for demo, at least include a disabled/greyed-out "Continue with Google" button with tooltip "Coming soon" so Sophia sees it's planned.

### RC-09: Disable Email Confirmation for Demo, Use Inline OTP for Production

**Current:** ADR-12 in SYSTEM-DESIGN.md recommends disabling email confirmation for the demo. This is correct.

**Demo recommendation:** Disable entirely. Charlotte's 3-minute budget cannot absorb any verification step mid-registration, especially when emails are mocked. Remove all copy implying a confirmation email was sent.

**Production recommendation:** Use **inline OTP verification** within Step 1 of registration. After entering email + password, show a 6-digit code input on the same screen. iOS auto-fills from the notification banner — adds ~15 seconds, not 60–90 seconds like a confirmation link. Charlotte stays in the flow, Sophia gets verified emails from day one, no deferred nag banners needed. Full spec, copy, and passwordless-vs-password analysis in Q9 of Specific UX Questions.

---

## 4. Nice-to-Haves

Polish ideas for after the core flows are solid.

### NH-01: Skeleton Loading States

The current implementation has no skeleton screens visible in the codebase. When Supabase is integrated and there's real network latency, users will see blank pages for 200-500ms. Add SkeletonCard components for event grids and a skeleton state for the event detail page.

For a luxury feel: ensure skeletons use the gold/cream palette with a subtle shimmer animation, not grey boxes. The shimmer should move slowly (2s cycle) — not the rapid pulse common in startup UIs.

### NH-02: Prefetch Event Detail Pages

When Charlotte hovers over (desktop) or the viewport intersects (mobile) an event card, prefetch that event's detail page data. This makes the transition feel instant, which reinforces the premium feel. Next.js `<Link prefetch>` handles this for static pages; for Supabase data, consider `router.prefetch()` alongside a SWR/React Query cache.

### NH-03: "What Happens Next" Post-Booking

After booking, the confirmation step shows "Add to Calendar" and "Share." Consider also showing:
- "You'll receive a confirmation email" (even if mocked — set expectation)
- "Arrive by 6:45 PM" (15 min before event start — practical value)
- "Dress code: Smart Casual" (if applicable, right there in the confirmation)

### NH-04: Gallery "Photo of the Month" Feature

The gallery page should have a featured/hero image at the top — the best photo from recent events. This adds editorial curation to what would otherwise be a flat grid. For the demo, hand-pick the best seed image.

### NH-05: Animated Counters in Social Proof Section

The landing page social proof section shows member count and event count. Animating these from 0 to their values on scroll-into-view (using a count-up animation) adds subtle delight without feeling gimmicky.

### NH-06: Event Reminder Nudge for Booked Events

On the profile page, for events happening within the next 48 hours, show a gentle highlight:
- Gold border glow on the event card
- "Tomorrow at 7 PM — see you there!" microcopy

---

## 5. Mobile-Specific Recommendations

### MS-01: Sticky Mobile Booking Bar (Critical — see CF-03)

Already detailed above. This is the single most important mobile fix.

### MS-02: Bottom Sheet Modals Instead of Centered Cards

**Current:** The BookingModal renders as a centered floating card on all screen sizes.

**Recommendation:** On mobile (< 768px), render as a bottom sheet that slides up from the bottom of the screen. This pattern is used by Apple Maps, Google Maps, Uber, and every premium mobile app. It's more thumb-friendly and feels native.

Implementation: Detect viewport width. On mobile, change the modal's position to `fixed bottom-0 left-0 right-0` with `rounded-t-3xl` (top corners only). Add a drag handle at the top. Use a spring animation for the slide-up.

### MS-03: Interest Tags on Mobile — Ensure Visibility

**Current:** The interest tag grid in registration uses `flex-wrap`. On a 375px screen, depending on tag text length, Charlotte may see only 4-6 tags above the fold.

**Recommendation:** Ensure the tag grid is immediately scannable:
- Cap tag labels to ~15 characters so they display consistently
- Consider a 2-column grid layout on mobile (instead of wrap) for more predictable layout
- Show the total count: "Select from 12 interests" so Charlotte knows the full scope

### MS-04: Mobile Filter Pills Should Scroll Horizontally

**Current:** The events listing filter categories need verification on mobile. With 8 categories (drinks, dining, cultural, wellness, sport, workshops, music, networking) plus an "All" filter = 9 pills.

**Recommendation:** At 375px, only ~3 pills are visible at once. Ensure the filter row is:
- `overflow-x-auto` with `flex-nowrap`
- No visible scrollbar (use `-webkit-scrollbar: none`)
- Optionally: add a subtle gradient fade on the right edge to signal more content
- "All" should always be the first pill and always visible

### MS-05: Touch Targets Audit

Verify all interactive elements meet 44x44px minimum touch target:
- Booking modal +/- spot buttons: currently `h-12 w-12` (48px) — good
- Star rating for review submission: ensure stars are at least 44px tap areas with adequate spacing
- Header hamburger: `h-9 w-9` (36px) — **too small.** Increase to `h-10 w-10` (40px) minimum, ideally `h-11 w-11` (44px)
- Theme toggle: same issue at `h-9 w-9`
- Close buttons on modals: `p-2` with a 16px icon — total is ~32px. **Too small.** Increase to `p-3`

### MS-06: Safe Area Insets

Any fixed-position element at the bottom of the screen (sticky booking bar, bottom sheet modals) must account for the iPhone home indicator:
- Add `pb-[env(safe-area-inset-bottom)]` or use the Tailwind `pb-safe` utility
- Test on iPhone 14/15 (notch + home indicator) and iPhone SE (no notch)

---

## 6. Copy Recommendations

### Hero Section

| Current | Recommended | Rationale |
|---------|-------------|-----------|
| Tagline: "London's Premier Social Community" | "London's Most Curated Social Calendar" | "Premier" is generic. "Curated" signals quality. "Calendar" signals events — not a content platform. |
| Headline: "Where Connections Become Stories" | Keep, but add a concrete subline | The headline is evocative but abstract. Charlotte might not immediately understand this is about real-world events. |
| Subtitle: "A curated community of London professionals who believe the best things in life are experienced together." | "Supper clubs. Gallery openings. Rooftop drinks. London's most interesting professionals, one unforgettable evening at a time." | Be specific. List event types. Paint a picture. Let Charlotte see herself at one of these events. |
| Primary CTA: "Explore Events" | "See What's On" | More casual, more browsable. "Explore Events" sounds like a button on a corporate events platform. |
| Secondary CTA: "Join The Social Seen" | "Become a Member" | Shorter. "Join The Social Seen" is 4 words and sounds like a sales pitch. "Become a Member" positions it as an invitation. |

### Social Proof Section

| Current | Recommended | Rationale |
|---------|-------------|-----------|
| "1,000+ members" (if used) | "Join 1,000+ London professionals" | Tells Charlotte WHO, not just how many. |

Add a sub-stat row: "200+ events hosted | 4.8 average rating | 12 events this month" — concrete numbers that answer James's due-diligence questions.

### Registration Flow

| Step | Current Heading | Recommended | Rationale |
|------|----------------|-------------|-----------|
| 1 | "Let's Get Started" | "Create Your Account" | Direct. Charlotte knows what she's doing. Don't be cutesy. |
| 2 (now interests) | "What Are You Into?" | "What interests you?" | Slightly more sophisticated for the audience. |
| 3 (welcome) | "Welcome to The Social Seen" | "You're In" | Shorter, punchier, more exclusive. |

### Booking Modal

| Element | Current | Recommended |
|---------|---------|-------------|
| Step 1 heading | "How many spots?" | "Reserve Your Spot" (single-person default, "Add a guest" link for +1) |
| Confirmation heading | "You're going!" | "See You There" (warmer, more editorial, less startup-y) |
| Waitlist button subtext | "You'll be notified when a spot opens up" | "Most waitlisted members get a spot — we'll let you know the moment one opens" |

### Empty States

| Page | State | Recommended Copy |
|------|-------|-----------------|
| Profile — Upcoming bookings | No bookings | "Your next event awaits. Browse what's coming up this month →" |
| Profile — Past bookings | No past events | "Once you've attended your first event, it'll appear here — along with photos and reviews from the evening." |
| Profile — Waitlisted | No waitlist | "Nothing on the waitlist right now. Popular events fill fast — bookmark ones you're interested in." |
| Events listing — No matches | Empty filter result | "No [category] events coming up right now. Check back soon or browse all events →" |

### Button Labels

| Current | Recommended | Rationale |
|---------|-------------|-----------|
| "Continue" (registration) | "Next" or "Continue →" | Add arrow for momentum |
| "Complete Sign Up" (registration step 4) | "Create Account" | More standard, less wordy |
| "Done" (booking confirmation) | "Close" | "Done" is ambiguous — close the modal |
| "Go to Your Profile" (registration welcome) | "Complete Your Profile" | Sets expectation that there's more to do |
| "RSVP Now" | "Reserve My Spot" | First-person feels more personal |

### Microcopy

- **Password field placeholder:** Change from "At least 8 characters" to showing actual password requirements. Add a helper text line below the field: "Minimum 8 characters"
- **LinkedIn URL field:** Change label from "LinkedIn URL (optional)" to "LinkedIn (optional)" — the URL format is implied. Add placeholder: "linkedin.com/in/yourname"
- **Bio field:** Change placeholder from "Tell us a bit about yourself..." to "What do you do outside of work? Two sentences is perfect."

---

## 7. Amendments to Batch Prompts

> Note: No `prompts/` directory or batch prompt files were found in the repository. These amendments are written against the batch structure described in CLAUDE.md. When batch prompts are created, incorporate these changes.

### Batch 1 — Foundation

- **Add task:** Replace DM Sans font with Inter across the codebase (as flagged in SYSTEM-DESIGN.md ADR-05).
- **Add task:** Replace all hardcoded hex values with Tailwind theme tokens (ADR-06). This affects BookingModal, EventDetailClient, and several landing page components.

### Batch 2 — Marketing Pages

- **Amend hero copy:** Update HeroSection.tsx with revised tagline, subtitle, and CTA labels per Section 6 above.
- **Amend nav links:** Change Header.tsx nav from hash anchors to actual page routes (`/events`, `/gallery`, `/join`). Add conditional auth state: show "Sign In" for unauthenticated users, avatar/profile link for authenticated.
- **Remove "About" from header nav.** Keep it in the footer only.
- **Add task:** Update SocialProofSection copy to "Join 1,000+ London professionals" and add stat row (events hosted, average rating).

### Batch 3 — Event Pages

- **Add task:** Build mobile sticky booking bar for event detail page (CF-03). Use IntersectionObserver on the desktop sidebar card to toggle visibility.
- **Amend EventCard:** Consider adding attendee avatar row to event cards (RC-03 — can be deferred to Batch 9 if time-constrained).
- **Amend date formats:** Standardise to the three-tier system in RC-06.

### Batch 4 — Auth

- **Critical change:** Shorten registration wizard from 5 steps to 3 steps (CF-02). Steps: Account → Interests → Welcome. Remove Step 2 (About You) and Step 4 (Referral/Bio) from the wizard entirely.
- **Add task:** Build a "Complete Your Profile" prompt that appears on the profile page after first login if `onboarding_complete = true` but `job_title` is null. This collects the professional details that were removed from registration.
- **Amend validation:** Remove required validation for jobTitle, company, industry from the registration flow.
- **If feasible, add task:** Implement Google OAuth ("Continue with Google") on Step 1 (RC-08).
- **Amend error messages:** Replace generic "This field is required" with contextual copy per RC-04.

### Batch 5 — Member

- **Add task:** Build a "Complete Your Profile" banner/card at the top of the profile page for users who haven't filled in professional details.
- **Amend empty states:** Use the copy from Section 6 empty states table. Include CTAs in every empty state.

### Batch 6 — Booking

- **Amend free event booking flow:** Simplify to 2 steps (Confirm → Success) per RC-01. Make spot quantity selection an expandable option rather than a mandatory first step.
- **Amend paid event booking flow:** Keep 3 steps but fix the mock Stripe form (CF-04). Use disabled inputs instead of divs. Add "Demo mode" banner.
- **Amend booking confirmation:** Replace confetti with a styled event ticket card (RC-02). Make it screenshot-worthy. Include "Arrive by [time]" and dress code if applicable.
- **Add task:** Build mobile bottom-sheet variant of the BookingModal (MS-02).

### Batch 7 — Social (Reviews + Gallery)

- **Critical addition:** Build the ReviewForm component (CF-05). Include star rating selector, optional text field, 500-char limit.
- **Add task:** Implement review submission modal that opens from the profile page past events tab.
- **Add task:** Add review prompt discovery — show a toast/banner on next site visit after attending an event: "How was [Event Name]? Share your experience →"
- **Amend gallery lightbox:** Add keyboard navigation (left/right arrow keys, Escape to close). Add mobile swipe gestures.

### Batch 8 — Admin

- **Add task:** Ensure waitlist management is prominent — Sophia needs one-click promote-from-waitlist on the event detail admin view.
- **Add task:** Admin event form should show URL slug preview: "thesocialseen.com/events/[slug]"
- **Add task:** Admin dashboard empty state should never show all zeros. Pre-populate with seed data or show "Getting started" guidance.

### Batch 9 — Polish

- **Add task:** Implement skeleton loading states with gold/cream shimmer for event grids and detail pages (NH-01).
- **Add task:** Audit all touch targets for 44px minimum (MS-05). Fix header buttons, modal close buttons.
- **Add task:** Add `safe-area-inset-bottom` padding to all fixed-bottom elements (MS-06).
- **Add task:** Verify dark mode renders correctly across all components (depends on hex value cleanup from Batch 1).
- **Add task:** Test horizontal scroll of filter pills on mobile 375px (MS-04).

---

## Specific UX Questions — Answers

### Q1: Mobile booking card position?
**Answer:** Yes. Add a sticky "Book Now" bar at the bottom of the mobile screen (see CF-03). This is non-negotiable for mobile conversion.

### Q2: Should registration be shortened?
**Answer:** Yes. From 5 steps to 3 steps. Account → Interests → Welcome. Professional details move to profile page. See CF-02 for full rationale.

### Q3: Is Google OAuth worth demo scope?
**Answer:** If engineering time allows, yes. It's the single highest-ROI signup improvement. If not, include a disabled "Continue with Google" button to show Sophia it's planned. See RC-08.

### Q4: Navigation hierarchy?
**Answer:** Remove "About" from header. New order: `Events | Gallery | Join | Sign In` (unauthenticated) or `Events | Gallery | My Bookings | [Avatar]` (authenticated). See CF-06.

### Q5: Empty states?
**Answer:** Every empty state must include motivating copy AND a CTA. Never show a blank area. See Section 6 empty states table.

### Q6: Date formats?
**Answer:** Three tiers. Card: `Sat 14 Mar`. Modal: `Saturday 14 March, 7:00 PM`. Full detail: `Saturday 14 March 2026`. See RC-06.

### Q7: Skeleton screens?
**Answer:** Yes, but use gold/cream palette with slow shimmer (2s cycle), not grey boxes with rapid pulse. Prioritise the event grid and detail page. The luxury feel comes from the transition being so fast that skeletons barely appear — aggressive prefetching is the first line of defence, skeletons are the fallback.

### Q8: Dark mode default?
**Answer:** Default to light (cream/editorial). The brand identity is built around the warm cream palette. Dark mode should be available as a toggle but not the default. Reasoning: event photography looks better on a light background; the gold accent pops more against cream than against dark surfaces; the editorial/magazine aesthetic that differentiates The Social Seen from nightlife apps reads better in light mode.

### Q9: Should email confirmation be disabled for the demo? What about production?

**Context:** The architect recommends disabling Supabase Auth email confirmation for the demo (SYSTEM-DESIGN.md ADR-12). This means users sign up and land immediately in an active session — no "check your inbox" step.

#### Demo: Disable email confirmation. Strongly agree.

This is the right call for three reasons:

1. **Charlotte's 3-minute budget is already spent.** With the shortened 3-step registration (CF-02), Charlotte's flow is: Account → Interests → Welcome → browse events → book. If you insert "now check your email, find the confirmation link, click it, get redirected back" between Step 1 and Step 2, you've added 60–90 seconds of dead time where she's alt-tabbing to Mail, searching for an email, possibly waiting for delivery, dealing with spam filters — and doing all of this on an iPhone during a commute. She will not come back.

2. **Sophia is testing the demo live.** She'll create test accounts, invite co-founders to try it, demo it in person. Email confirmation turns a 30-second "look how easy it is to sign up" into an awkward "wait, let me check my inbox... hold on, it might be in spam." That pause kills the demo's credibility.

3. **The demo has no real email service.** Emails are mocked (toast + console.log per CLAUDE.md). A confirmation email that never arrives is worse than no confirmation at all.

**Copy note:** With confirmation disabled, remove any copy that implies an email was sent during signup. The welcome screen (Step 3) should say "You're In" — not "Check your email to confirm."

#### Production: OTP inline verification during signup. Best of both worlds.

Three verification options were evaluated for the production signup flow:

| Option | UX Cost | Data Quality | Mobile Experience |
|--------|---------|-------------|-------------------|
| **A. Confirmation link** (traditional) | High — leaves the app, searches inbox, clicks link, redirected back. 60–90s added. | Immediate — email verified before account is usable | Terrible on mobile. Tab-switching, Mail app, possible spam folder hunt. Charlotte bounces. |
| **B. Deferred verification** (verify later) | Zero at signup — nag banner appears after 24h | Delayed — unverified accounts exist for hours/days. Sophia sees dirty data. Risk of fake bookings. | Great at signup. Nag banners later feel like tech debt. |
| **C. OTP code inline** (enter 6-digit code during signup) | Low — 15–20s added. User stays in the same screen. | Immediate — email verified before proceeding | **Excellent on mobile.** iOS auto-fills the code from the notification banner. Charlotte barely notices the step. |

**Recommendation: Option C — OTP inline verification.**

OTP beats the confirmation link on every dimension that matters for Charlotte:

1. **She stays in the flow.** No app-switching. The registration page shows an inline code input below the email field (or as a brief sub-step within Step 1). On iOS 16+, the 6-digit code appears in the keyboard suggestion bar within seconds of the SMS/email arriving. One tap to auto-fill, then she's through.

2. **It adds 15–20 seconds, not 60–90.** The code arrives while she's still looking at the screen. Compare this to a confirmation link where she has to: notice the email → open Mail → find it (spam?) → tap the link → wait for redirect → possibly re-authenticate. That's an entirely different cognitive task. OTP is a micro-interaction within the same task.

3. **Sophia gets verified emails from day one.** No deferred verification logic to build, no nag banners, no "unverified" admin flags, no risk of fake accounts booking real event spots. The data is clean from signup.

4. **It signals quality.** Soho House, DICE, and other premium platforms use OTP or similar verification. It feels secure without feeling bureaucratic. Charlotte expects it.

**How it fits into the shortened registration flow:**

```
Step 1 — Account
  ├── Enter: Full name, email, password
  ├── Tap "Continue"
  ├── Inline: "We've sent a 6-digit code to [email]"
  │           [ _ _ _ _ _ _ ]  ← auto-fills on iOS
  │           "Didn't receive it? [Resend]"
  ├── Code entered → email verified, account created
  └── Proceed to Step 2

Step 2 — Interests
Step 3 — Welcome ("You're In")
```

The OTP entry is a **sub-step within Step 1**, not a separate wizard step. The progress indicator still shows 3 steps. Charlotte sees it as one continuous action: "enter my details → enter the code → pick interests → done."

**Critical implementation details (for backend-developer):**

- Use Supabase Auth's built-in OTP flow (`supabase.auth.signInWithOtp()`) or email-based OTP verification
- Code expiry: 10 minutes (generous enough for email delivery delays)
- Max attempts: 3 before requiring a resend
- The code input field should be a single `<input>` with `inputMode="numeric"` and `autocomplete="one-time-code"` — this triggers iOS/Android auto-fill from notification
- Show a 60-second cooldown timer on the "Resend" link to prevent spam

**Copy for the OTP step:**

| Element | Copy |
|---------|------|
| Heading (after email entered) | "Check your email" |
| Body | "We've sent a 6-digit code to **charlotte@ogilvy.com**" |
| Helper text | "Enter the code to verify your email" |
| Input placeholder | "000000" (light grey, evenly spaced) |
| Resend link | "Didn't receive it? [Resend code]" (disabled for 60s after send, show countdown) |
| Resend cooldown | "Resend in 47s" |
| Error — wrong code | "That code doesn't match. Check and try again." |
| Error — expired code | "That code has expired. [Send a new code]" |
| Error — too many attempts | "Too many attempts. [Send a new code] or [try a different email]." |
| Success (auto-transition) | No message needed — auto-proceed to Step 2 after valid code. A subtle checkmark animation on the input field (green check, 0.3s) confirms success before the slide transition. |

**What about passwordless OTP as the login method?**

This was also considered — removing passwords entirely and using email OTP for every login (like DICE or some banking apps).

| Pro | Con |
|-----|-----|
| No password to remember or create | Every login requires email access — bad for James switching between desktop and phone |
| Faster signup (one fewer field) | Returning users are slower (check email every time vs. saved password / biometric autofill) |
| Eliminates password-related support (reset, too weak, etc.) | Supabase session tokens handle persistence, but if the session expires, James is back to email |
| Feels modern and secure | Charlotte's password manager (1Password, iCloud Keychain) already auto-fills — the "friction" of a password field is near-zero for this audience |

**Verdict: Not recommended for The Social Seen.**

This audience uses password managers. Charlotte has iCloud Keychain, James has 1Password. The password field auto-fills on return visits. Removing it saves ~3 seconds at signup but costs ~20 seconds on every subsequent login when a session expires. The math doesn't work for a platform that wants returning members.

Passwordless OTP works for transactional apps (food delivery, ride-hailing) where sessions rarely expire. The Social Seen wants Charlotte logging in weekly to check upcoming events — she needs frictionless return access, which means password + biometric autofill.

**Final recommendation summary:**

| Scope | Auth Method | Email Verification |
|-------|-------------|-------------------|
| **Demo** | Email + password | Disabled entirely (no OTP, no link, no verification) |
| **Production** | Email + password (+ Google OAuth if RC-08 is implemented) | OTP inline during signup — 6-digit code within Step 1 |

**Batch prompt amendment:** In Batch 4 (Auth), add a note: "Email confirmation is OFF for demo. Do not include any copy about checking email during signup. For production, implement inline OTP verification within Step 1 of registration per UX-REVIEW.md Q9. Use `autocomplete='one-time-code'` on the input for mobile auto-fill."

---

## HANDOVER

- **Agent:** ux-designer
- **Task:** Phase 2 UX review for target audience — produced UX-REVIEW.md
- **Files changed:** `UX-REVIEW.md` (created)
- **Migrations planned:** none (design phase)
- **Tests added:** none (design phase)
- **Next agent:** Human review → then batch prompt authors should incorporate amendments from Section 7
- **Risks / open questions:**
  - Registration shortening (CF-02) changes the auth flow described in SYSTEM-DESIGN.md — the `onboarding_complete` flag logic needs updating to reflect the 3-step flow
  - Google OAuth (RC-08) requires Supabase project configuration and Google Cloud Console setup — may not be feasible for demo timeline
  - Sticky mobile booking bar (CF-03) requires IntersectionObserver logic — straightforward but needs testing across iOS Safari versions
  - ReviewForm (CF-05) is a new component not in any existing batch — must be added to Batch 7
  - Hardcoded hex value cleanup (RC-07) is a prerequisite for dark mode to work — must be in Batch 1 or 2
