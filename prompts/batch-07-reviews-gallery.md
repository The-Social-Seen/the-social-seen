# Batch 7 — Reviews & Gallery

## Context

Booking flow works (Batch 6). Users can register, browse, and book events. Now add the social layer: reviews for past events and the photo gallery. These features create the FOMO and social proof that make the platform sticky.

**IMPORTANT:** Only verified attendees (users with a confirmed booking for a past event) can leave reviews. This is enforced by RLS — do not add client-side-only checks.

---

## Tasks

### Task 1: Review System

**Review Form (`src/components/reviews/ReviewForm.tsx` — Client Component):**
- Appears on past event detail pages for verified attendees who haven't reviewed yet
- Also appears on profile's Past Events tab as "Leave a Review" button per event
- Star selector: 5 interactive stars (gold on hover/select, border when empty)
- Review text: textarea, max 300 chars, with character counter
- "Submit Review" gold CTA
- Submits via Server Action

**Review Server Action (`src/app/(events)/events/[slug]/actions.ts`):**
```typescript
'use server'
// createReview(eventId: string, rating: number, reviewText?: string)
// 1. Verify user is authenticated
// 2. Verify user has a confirmed booking for this event (RLS handles this but double-check)
// 3. Verify event date is in the past
// 4. Verify user hasn't already reviewed this event
// 5. Insert into event_reviews (is_visible = true by default)
// 6. Return success
```

**Review display on event detail pages:**
- Section heading: "What People Said" (Playfair Display)
- Average rating: large "4.7" with star icon + "(23 reviews)"
- List of ReviewCard components (already created in Batch 3, now wire with real data)
- Sort by most recent first
- If no reviews: "No reviews yet" empty state

**Review display on event cards (past events):**
- On EventCard for past events: show "★ 4.7 (23)" in the spots-remaining position
- Update EventCard to conditionally show rating for past events

### Task 2: Gallery Page (`src/app/gallery/page.tsx`)

**Page header:**
- "Gallery" heading in Playfair Display
- "Moments from our favourite evenings" subtitle

**Filter bar:**
- Horizontal pill selector to filter by event
- "All Events" (default) + one pill per past event that has photos
- Client-side filtering (or URL params)

**Photo grid** (`src/components/gallery/MasonryGrid.tsx`):
- Masonry-style layout (not uniform grid — varying heights for visual interest)
- Use CSS columns or a lightweight masonry implementation
- Each photo: subtle rounded corners, hover zoom effect (scale 1.02), slight shadow on hover
- Caption overlay on hover (bottom, fade-in, semi-transparent dark bg)

**Lightbox** (`src/components/gallery/Lightbox.tsx` — Client Component):
- Click photo → full-screen lightbox overlay
- Left/right navigation arrows
- Close on X, overlay click, Escape key
- Caption + event name displayed below image
- Swipe support on mobile (stretch)
- Keyboard navigation (left/right arrows)

**Per-event gallery section:**
- On event detail pages for past events: add a "Photos" section
- Show 4–6 photos in a horizontal scroll row
- "View all photos" link → /gallery?event=[slug]

### Task 3: "Photo of the Month" Feature

At the top of the gallery page:
- Featured photo displayed large (full-width, max-height 500px)
- "Photo of the Month" label in gold
- Caption and event attribution
- Use the most recent photo or seed a specific one as featured
- Store featured status as a boolean on event_photos (add via migration if needed — be careful, state this change)

### Task 4: Landing Page Update

Update the landing page (Batch 2) to pull real review data:
- Replace placeholder testimonials in the social proof section with actual highest-rated reviews
- Show reviewer name, star rating, and event name
- If "What Our Members Say" section doesn't exist yet, add it between social proof and gallery preview

---

## Verification Checklist

```
[ ] pnpm tsc --noEmit — zero errors
[ ] pnpm build — succeeds
[ ] Review form: star selector works (hover + click)
[ ] Review form: character counter shows remaining out of 300
[ ] Review form: submission creates row in event_reviews
[ ] Review form: only appears for verified attendees of past events
[ ] Review form: prevents duplicate reviews
[ ] Event detail: past events show reviews section with real data
[ ] Event cards: past events show average rating badge
[ ] Gallery page: masonry grid loads photos from seed data
[ ] Gallery page: event filter pills work
[ ] Gallery page: lightbox opens, navigates, closes correctly
[ ] Gallery page: "Photo of the Month" featured section at top
[ ] Event detail: past events show photos section
[ ] Landing page: testimonials pull real review data
[ ] Mobile: gallery is 2-column masonry, lightbox is full-screen
[ ] Committed to branch: feat/reviews-gallery
```
