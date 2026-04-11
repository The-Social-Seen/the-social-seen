# Batch 6 — Booking Flow

## Context

Member pages work (Batch 5). Users can view profiles and bookings. Now wire up the actual booking flow — the modal that appears when someone clicks "RSVP Now" or "Book Now" on an event detail page.

Reference the booking modal prototype screenshot: 3-step progress bar (gold=complete, charcoal=current, grey=future), "Confirm Details" heading, event summary card, special requirements field, "Confirm RSVP" gold CTA.

**IMPORTANT:** Paid events use a MOCKED Stripe flow for the demo. Free events are fully functional. Booking writes must go through Server Actions that enforce RLS.

---

## Tasks

### Task 1: Booking Modal (`src/components/events/BookingModal.tsx`)

Client Component. Triggered from BookingSidebar "RSVP Now" / "Book Now" / "Join Waitlist" button.

**Modal structure:**
- Overlay with backdrop blur
- White rounded-2xl panel, max-w-lg
- Close X button top-right
- 3-step progress bar at top (gold segments for complete, charcoal for current, grey for remaining)

**Step 1 — Select:**
- Event summary: title, date, venue
- Spot selector: "1 spot" (fixed for MVP — group booking is a stretch goal)
- Price line: "1 spot × £35" → "£35" (or "1 spot × Free" → "Free")
- "Continue" gold CTA

**Step 2 — Confirm Details:**
- Full event summary card (cream bg): title, date, time, venue
- Price summary line
- "Special requirements" textarea (optional): placeholder "Dietary needs, accessibility, etc."
- "Back" secondary button + "Confirm RSVP" / "Confirm Booking" gold CTA
- Match prototype screenshot exactly

**Step 3 — For paid events only (MOCKED):**
- Simulated Stripe checkout appearance
- "Pay £35" button → immediately succeeds (no real payment)
- Brief loading animation then proceed to confirmation

**Confirmation screen (replaces modal content):**
- Checkmark animation (subtle, on-brand)
- "You're In!" heading in Playfair Display
- Event name, date, venue
- "Add to Calendar" button → generates .ics file download
- "Share with Friends" button → Web Share API or copy link
- "View My Bookings" link → /bookings
- Confetti animation (subtle gold particles, 2 seconds, then stops)

### Task 2: Booking Server Actions (`src/app/(events)/events/[slug]/actions.ts`)

```typescript
'use server'

// createBooking(eventId: string, specialRequirements?: string)
// 1. Verify user is authenticated
// 2. Check no existing active booking (confirmed/waitlisted) for this user + event
// 3. Check event exists and is published
// 4. Check event hasn't passed
// 5. Count confirmed bookings
// 6. If capacity is null OR confirmed < capacity:
//    → Insert with status 'confirmed'
// 7. If confirmed >= capacity:
//    → Insert with status 'waitlisted'
//    → Set waitlist_position = max existing position + 1
// 8. Return { status, waitlistPosition? }
```

### Task 3: Waitlist Join from Event Page

When event is at capacity:
- BookingSidebar shows "Join Waitlist" button (outlined gold, not filled)
- Below button: "You'll be added to the waitlist"
- After joining: show "You're #7 on the waitlist" with position
- "Leave Waitlist" option (reuse action from Batch 5)

### Task 4: Calendar (.ics) Generation

`src/lib/utils/calendar.ts`:
- Generate .ics file content for event
- Include: event title, start/end time (UTC), location, description
- Trigger browser download of .ics file
- Timezone: convert from Europe/London to UTC for .ics

### Task 5: Real-time Attendee Count (Stretch)

Use Supabase Realtime to update attendee count on the event detail page:
- `src/hooks/use-realtime-count.ts`
- Subscribe to bookings table changes for the current event
- Update confirmed count without page refresh
- If this adds complexity, skip and use optimistic UI instead (increment count locally on successful booking)

### Task 6: Update BookingSidebar

Wire up the BookingSidebar from Batch 3:
- If user is logged out → "Sign in to book" link
- If user is logged in + no booking → show Book/RSVP/Waitlist button → opens BookingModal
- If user already has confirmed booking → show "You're going! ✓" with cancel option
- If user is on waitlist → show "You're #N on the waitlist" with leave option
- Fetch user's booking status for this event in the Server Component

---

## Verification Checklist

```
[ ] pnpm tsc --noEmit — zero errors
[ ] pnpm build — succeeds
[ ] Free event: can complete full RSVP flow (click → modal → confirm → success)
[ ] Paid event: mock payment flow works (click → modal → confirm → fake pay → success)
[ ] Full event: waitlist join works, shows position
[ ] Booking creates correct row in Supabase (check via Supabase dashboard)
[ ] Duplicate booking prevented (can't book same event twice)
[ ] Past event: booking button is disabled/hidden
[ ] .ics calendar download works, opens in calendar app
[ ] Confetti animation fires on confirmation, stops after 2 seconds
[ ] BookingSidebar updates correctly per user state (logged out / no booking / booked / waitlisted)
[ ] Optimistic UI: count updates immediately on booking
[ ] Modal closes on X, on overlay click, and on Escape key
[ ] Mobile: modal is full-screen on small viewports
[ ] Committed to branch: feat/booking-flow
```
