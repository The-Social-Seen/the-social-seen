# SYSTEM-DESIGN.md — The Social Seen

> Produced by: Architect agent (Phase 1 review)
> Date: 2026-04-02
> Status: **AWAITING APPROVAL** — do not begin execution until approved

This document supplements CLAUDE.md. Where they conflict, raise it in Open Questions (Section 7). Execution agents must read both files before starting any batch.

---

## Table of Contents

1. [Data Model Diagram](#1-data-model-diagram)
2. [Query Map](#2-query-map)
3. [Auth Flow](#3-auth-flow)
4. [Booking State Machine](#4-booking-state-machine)
5. [Edge Cases Register](#5-edge-cases-register)
6. [Architecture Decisions Refined](#6-architecture-decisions-refined)
7. [Open Questions](#7-open-questions)

---

## Current State Assessment

Before the design, a summary of where the codebase stands today:

| Area | Status |
|------|--------|
| Pages | Landing, events listing, event detail, login, join, gallery, profile, admin — all built with **mock data** |
| Data layer | `src/data/events.ts` and `src/data/members.ts` — hardcoded arrays |
| Supabase | Not integrated. No migrations, no client files, no `.env.local` |
| Auth | Forms exist but submit to nowhere (client-side only) |
| Route groups | Not used — flat structure at `src/app/` instead of `(marketing)`, `(events)`, etc. |
| Types | `src/types/index.ts` — flat/denormalized, designed for mock consumption |
| Design tokens | CSS variables defined in `globals.css`, but many components use hardcoded hex values |
| Font | **DM Sans** used instead of **Inter** (deviation from CLAUDE.md) |
| Missing pages | `/about`, `/bookings`, admin sub-routes (`/admin/events`, `/admin/members`, etc.) |
| Missing types | `no_show` absent from `BookingStatus`; category enum is Title Case in TS vs lowercase in DB |

---

## 1. Data Model Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                          auth.users                                  │
│  (Supabase-managed — DO NOT modify directly)                         │
│  id (uuid, PK)                                                       │
│  email, encrypted_password, raw_user_meta_data, ...                  │
└──────────────────────────────┬────────────────────────────────────────┘
                               │ id = id (ON DELETE CASCADE)
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│                           profiles                                    │
│  id             uuid PK (= auth.users.id)                            │
│  email          text NOT NULL                                        │
│  full_name      text NOT NULL                                        │
│  avatar_url     text                                                 │
│  job_title      text                                                 │
│  company        text                                                 │
│  industry       text                                                 │
│  bio            text                                                 │
│  linkedin_url   text                                                 │
│  role           user_role DEFAULT 'member'                           │
│  onboarding_complete  boolean DEFAULT false                          │
│  created_at     timestamptz DEFAULT now()                            │
│  updated_at     timestamptz DEFAULT now()                            │
│  deleted_at     timestamptz                                          │
│                                                                      │
│  INDEXES: idx_profiles_role (role)                                   │
│  RLS: ON                                                             │
└───────┬──────────────┬───────────┬───────────┬───────────────────────┘
        │              │           │           │
        │              │           │           │
        ▼              ▼           ▼           ▼
   bookings    event_reviews  user_interests  event_hosts
                                              (join → events)


┌──────────────────────────────────────────────────────────────────────┐
│                            events                                     │
│  id               uuid PK DEFAULT gen_random_uuid()                  │
│  slug             text UNIQUE NOT NULL                               │
│  title            text NOT NULL                                      │
│  description      text NOT NULL                                      │
│  short_description text NOT NULL                                     │
│  date_time        timestamptz NOT NULL                               │
│  end_time         timestamptz NOT NULL                               │
│  venue_name       text NOT NULL                                      │
│  venue_address    text NOT NULL                                      │
│  category         event_category NOT NULL                            │
│  price            integer DEFAULT 0  (pence, £35 = 3500)            │
│  capacity         integer  (NULL = unlimited)                        │
│  image_url        text                                               │
│  dress_code       text                                               │
│  is_published     boolean DEFAULT false                              │
│  is_cancelled     boolean DEFAULT false                              │
│  created_at       timestamptz DEFAULT now()                          │
│  updated_at       timestamptz DEFAULT now()                          │
│  deleted_at       timestamptz                                        │
│                                                                      │
│  CHECK: price >= 0                                                   │
│  CHECK: capacity > 0 OR capacity IS NULL                             │
│  CHECK: end_time > date_time                                         │
│  INDEXES: idx_events_slug (slug), idx_events_category (category),    │
│           idx_events_date (date_time), idx_events_published           │
│  RLS: ON                                                             │
└──────┬──────────┬───────────┬────────────┬───────────────────────────┘
       │          │           │            │
       ▼          ▼           ▼            ▼
  event_hosts  event_inclusions  bookings  event_photos
                                           event_reviews


┌──────────────────────────────────────────────────────────────────────┐
│                         event_hosts                                   │
│  id             uuid PK DEFAULT gen_random_uuid()                    │
│  event_id       uuid NOT NULL → events(id) ON DELETE CASCADE         │
│  profile_id     uuid NOT NULL → profiles(id) ON DELETE CASCADE       │
│  role_label     text DEFAULT 'Host'  (e.g. "Host", "Co-Host")       │
│  sort_order     integer DEFAULT 0                                    │
│  created_at     timestamptz DEFAULT now()                            │
│                                                                      │
│  UNIQUE: (event_id, profile_id)                                      │
│  RLS: ON (inherits event visibility)                                 │
└──────────────────────────────────────────────────────────────────────┘


┌──────────────────────────────────────────────────────────────────────┐
│                      event_inclusions                                 │
│  id             uuid PK DEFAULT gen_random_uuid()                    │
│  event_id       uuid NOT NULL → events(id) ON DELETE CASCADE         │
│  label          text NOT NULL  (e.g. "6 wine tastings")             │
│  icon           text  (optional Lucide icon name)                    │
│  sort_order     integer DEFAULT 0                                    │
│  created_at     timestamptz DEFAULT now()                            │
│                                                                      │
│  RLS: ON (inherits event visibility)                                 │
└──────────────────────────────────────────────────────────────────────┘


┌──────────────────────────────────────────────────────────────────────┐
│                          bookings                                     │
│  id                uuid PK DEFAULT gen_random_uuid()                 │
│  user_id           uuid NOT NULL → profiles(id) ON DELETE CASCADE    │
│  event_id          uuid NOT NULL → events(id) ON DELETE RESTRICT     │
│  status            booking_status NOT NULL DEFAULT 'confirmed'       │
│  waitlist_position integer                                           │
│  price_at_booking  integer DEFAULT 0  (snapshot of event price)      │
│  booked_at         timestamptz DEFAULT now()                         │
│  created_at        timestamptz DEFAULT now()                         │
│  updated_at        timestamptz DEFAULT now()                         │
│  deleted_at        timestamptz                                       │
│                                                                      │
│  CHECK: waitlist_position > 0 OR waitlist_position IS NULL           │
│  PARTIAL UNIQUE: (user_id, event_id) WHERE status != 'cancelled'    │
│  INDEXES: idx_bookings_event (event_id),                             │
│           idx_bookings_user (user_id),                               │
│           idx_bookings_status (status)                               │
│  RLS: ON                                                             │
└──────────────────────────────────────────────────────────────────────┘

  Note on ON DELETE for event_id: RESTRICT prevents deleting events
  that have bookings. Use soft-delete (deleted_at) on events instead.


┌──────────────────────────────────────────────────────────────────────┐
│                       event_reviews                                   │
│  id             uuid PK DEFAULT gen_random_uuid()                    │
│  user_id        uuid NOT NULL → profiles(id) ON DELETE CASCADE       │
│  event_id       uuid NOT NULL → events(id) ON DELETE CASCADE         │
│  rating         integer NOT NULL                                     │
│  review_text    text                                                 │
│  is_visible     boolean DEFAULT true                                 │
│  created_at     timestamptz DEFAULT now()                            │
│  updated_at     timestamptz DEFAULT now()                            │
│                                                                      │
│  CHECK: rating >= 1 AND rating <= 5                                  │
│  UNIQUE: (user_id, event_id)  — one review per user per event       │
│  RLS: ON                                                             │
└──────────────────────────────────────────────────────────────────────┘


┌──────────────────────────────────────────────────────────────────────┐
│                       event_photos                                    │
│  id             uuid PK DEFAULT gen_random_uuid()                    │
│  event_id       uuid NOT NULL → events(id) ON DELETE CASCADE         │
│  image_url      text NOT NULL                                        │
│  caption        text                                                 │
│  sort_order     integer DEFAULT 0                                    │
│  created_at     timestamptz DEFAULT now()                            │
│                                                                      │
│  RLS: ON                                                             │
└──────────────────────────────────────────────────────────────────────┘


┌──────────────────────────────────────────────────────────────────────┐
│                      user_interests                                   │
│  id             uuid PK DEFAULT gen_random_uuid()                    │
│  user_id        uuid NOT NULL → profiles(id) ON DELETE CASCADE       │
│  interest       text NOT NULL                                        │
│  created_at     timestamptz DEFAULT now()                            │
│                                                                      │
│  UNIQUE: (user_id, interest)                                         │
│  RLS: ON                                                             │
└──────────────────────────────────────────────────────────────────────┘


┌──────────────────────────────────────────────────────────────────────┐
│                       notifications                                   │
│  id                uuid PK DEFAULT gen_random_uuid()                 │
│  sent_by           uuid NOT NULL → profiles(id) ON DELETE CASCADE    │
│  recipient_type    notification_recipient DEFAULT 'all'              │
│  recipient_event_id uuid → events(id) ON DELETE SET NULL             │
│  type              notification_type NOT NULL                        │
│  subject           text NOT NULL                                     │
│  body              text NOT NULL                                     │
│  sent_at           timestamptz DEFAULT now()                         │
│  created_at        timestamptz DEFAULT now()                         │
│                                                                      │
│  RLS: ON (admin read/write only)                                     │
└──────────────────────────────────────────────────────────────────────┘
```

### Enums

```sql
CREATE TYPE user_role AS ENUM ('member', 'admin');

CREATE TYPE event_category AS ENUM (
  'drinks', 'dining', 'cultural', 'wellness',
  'sport', 'workshops', 'music', 'networking'
);

CREATE TYPE booking_status AS ENUM (
  'confirmed', 'cancelled', 'waitlisted', 'no_show'
);

CREATE TYPE notification_type AS ENUM (
  'reminder', 'announcement', 'waitlist', 'event_update'
);

CREATE TYPE notification_recipient AS ENUM (
  'all', 'event_attendees', 'waitlisted', 'custom'
);
```

### Database Trigger

```sql
-- Auto-create profile on auth signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', '')
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Log but don't fail signup — profile can be created on first visit
  RAISE WARNING 'Failed to create profile for user %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
```

### Booking RPC Function (Race-Condition Safe)

```sql
-- Atomic booking function to prevent overbooking
CREATE OR REPLACE FUNCTION public.book_event(
  p_user_id uuid,
  p_event_id uuid
)
RETURNS jsonb AS $$
DECLARE
  v_capacity integer;
  v_confirmed_count integer;
  v_price integer;
  v_event_date timestamptz;
  v_is_cancelled boolean;
  v_existing_booking uuid;
  v_status booking_status;
  v_waitlist_pos integer;
  v_booking_id uuid;
BEGIN
  -- Lock the event row to prevent concurrent bookings
  SELECT capacity, price, date_time, is_cancelled
  INTO v_capacity, v_price, v_event_date, v_is_cancelled
  FROM events
  WHERE id = p_event_id AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Event not found');
  END IF;

  IF v_is_cancelled THEN
    RETURN jsonb_build_object('error', 'Event is cancelled');
  END IF;

  IF v_event_date < now() THEN
    RETURN jsonb_build_object('error', 'Event has already passed');
  END IF;

  -- Check for existing active booking
  SELECT id INTO v_existing_booking
  FROM bookings
  WHERE user_id = p_user_id
    AND event_id = p_event_id
    AND status != 'cancelled'
    AND deleted_at IS NULL;

  IF FOUND THEN
    RETURN jsonb_build_object('error', 'Already booked for this event');
  END IF;

  -- Count confirmed bookings
  SELECT COUNT(*) INTO v_confirmed_count
  FROM bookings
  WHERE event_id = p_event_id
    AND status = 'confirmed'
    AND deleted_at IS NULL;

  -- Determine status
  IF v_capacity IS NULL OR v_confirmed_count < v_capacity THEN
    v_status := 'confirmed';
    v_waitlist_pos := NULL;
  ELSE
    v_status := 'waitlisted';
    SELECT COALESCE(MAX(waitlist_position), 0) + 1
    INTO v_waitlist_pos
    FROM bookings
    WHERE event_id = p_event_id
      AND status = 'waitlisted'
      AND deleted_at IS NULL;
  END IF;

  -- Insert booking
  INSERT INTO bookings (user_id, event_id, status, waitlist_position, price_at_booking)
  VALUES (p_user_id, p_event_id, v_status, v_waitlist_pos, v_price)
  RETURNING id INTO v_booking_id;

  RETURN jsonb_build_object(
    'booking_id', v_booking_id,
    'status', v_status,
    'waitlist_position', v_waitlist_pos
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### Database View (Event Stats)

```sql
-- Materialised stats for event listing and cards
CREATE OR REPLACE VIEW event_with_stats AS
SELECT
  e.*,
  COALESCE(bc.confirmed_count, 0) AS confirmed_count,
  COALESCE(rc.avg_rating, 0) AS avg_rating,
  COALESCE(rc.review_count, 0) AS review_count,
  CASE
    WHEN e.capacity IS NULL THEN NULL
    ELSE GREATEST(e.capacity - COALESCE(bc.confirmed_count, 0), 0)
  END AS spots_left
FROM events e
LEFT JOIN (
  SELECT event_id, COUNT(*) AS confirmed_count
  FROM bookings
  WHERE status = 'confirmed' AND deleted_at IS NULL
  GROUP BY event_id
) bc ON bc.event_id = e.id
LEFT JOIN (
  SELECT event_id,
         AVG(rating)::numeric(3,2) AS avg_rating,
         COUNT(*) AS review_count
  FROM event_reviews
  WHERE is_visible = true
  GROUP BY event_id
) rc ON rc.event_id = e.id
WHERE e.deleted_at IS NULL;
```

---

## 2. Query Map

### Landing Page (`/`)

| Section | Query | Estimated Cost |
|---------|-------|----------------|
| Hero | Static content — no query | 0 |
| Upcoming events (3) | `event_with_stats WHERE is_published AND NOT is_cancelled AND date_time > now() ORDER BY date_time LIMIT 3` | 1 query |
| Social proof stats | 3 parallel counts: `COUNT(profiles)`, `COUNT(events WHERE is_published)`, `AVG(event_reviews.rating WHERE is_visible)` | 3 queries (parallel) |
| Testimonials | `event_reviews WHERE is_visible ORDER BY rating DESC, created_at DESC LIMIT 3` + nested select profiles(full_name, avatar_url), events(title) | 1 query |
| Gallery preview | `event_photos ORDER BY created_at DESC LIMIT 6` + nested select events(title, slug) | 1 query |
| CTA | Static content — no query | 0 |

**Total: 6 queries, all parallelisable via `Promise.all()` in a Server Component.**
**Caching: ISR with `revalidate = 60` (1 minute). Acceptable staleness for a demo.**

### Events Listing (`/events`)

| Data | Query |
|------|-------|
| All published events | `event_with_stats WHERE is_published AND NOT is_cancelled ORDER BY date_time` |

**Total: 1 query** (the view handles joins and aggregations).

Client-side splitting into upcoming/past based on `date_time > now()`. Filtering by category and price is also client-side since the total event count is small (<100 for demo).

### Event Detail (`/events/[slug]`)

| Data | Query |
|------|-------|
| Event + hosts + inclusions | `events WHERE slug = :slug` + nested: `event_hosts(profiles(*))`, `event_inclusions(*)` |
| Booking count | `bookings WHERE event_id AND status = 'confirmed' AND NOT deleted_at` → COUNT |
| User's booking (if auth) | `bookings WHERE event_id AND user_id = auth.uid() AND status != 'cancelled'` |
| Reviews (if past) | `event_reviews WHERE event_id AND is_visible` + nested: `profiles(full_name, avatar_url)` |
| Photos (if past) | `event_photos WHERE event_id ORDER BY sort_order` |
| Related events | `event_with_stats WHERE category = :cat AND id != :id AND is_published LIMIT 3` |

**Total: 4-6 queries** depending on past/upcoming and auth state.
- Queries 1-3 always fire (3 queries)
- Queries 4-5 only for past events (+2)
- Query 6 always fires (+1)
- Use `Promise.all()` for parallel execution.

### Gallery (`/gallery`)

| Data | Query |
|------|-------|
| All photos | `event_photos ORDER BY created_at DESC` + nested: `events(title, slug)` |

**Total: 1 query.** Filtering by event is client-side.

### Login (`/login`)

No Supabase data queries. Calls `supabase.auth.signInWithPassword()` on submit.

### Join (`/join`)

| Step | Action |
|------|--------|
| Step 1 (Account) | `supabase.auth.signUp()` — creates auth.users + trigger creates profile |
| Step 2-4 (Profile) | Server Action: `UPDATE profiles SET ... WHERE id = auth.uid()` |
| Step 5 (Welcome) | Server Action: `UPDATE profiles SET onboarding_complete = true WHERE id = auth.uid()` |

**Total: 1 auth call + 2-3 Server Action mutations.**

### Profile (`/profile`)

| Data | Query |
|------|-------|
| User profile | `profiles WHERE id = auth.uid()` + nested: `user_interests(interest)` |
| Upcoming bookings | `bookings WHERE user_id = auth.uid() AND status = 'confirmed'` + nested: `events(*)` + filter `date_time > now()` |
| Past bookings | Same query, filter `date_time <= now()` |
| Waitlisted | `bookings WHERE user_id = auth.uid() AND status = 'waitlisted'` + nested: `events(*)` |

**Total: 2-3 queries** (profile + bookings, split client-side or via 2 queries with date filter).

### Bookings (`/bookings`) — New page

Same queries as profile bookings section, but displayed full-page with more detail.

### Admin Dashboard (`/admin`)

| Section | Query |
|---------|-------|
| KPI: Total members | `COUNT(profiles WHERE deleted_at IS NULL)` |
| KPI: Total events | `COUNT(events WHERE is_published AND deleted_at IS NULL)` |
| KPI: Total bookings (or revenue) | `COUNT(bookings WHERE status = 'confirmed')` or `SUM(price_at_booking)` |
| KPI: Avg rating | `AVG(event_reviews.rating WHERE is_visible)` |
| Monthly bookings chart | `bookings GROUP BY date_trunc('month', booked_at) WHERE status = 'confirmed'` |
| Recent activity | 3 queries: latest bookings (5), latest signups (5), latest reviews (5) — each with profile/event joins |

**Total: 7-8 queries (parallel).**

### Admin Sub-Routes

| Route | Primary Query |
|-------|---------------|
| `/admin/events` | `events ORDER BY created_at DESC` (all, including drafts/cancelled) |
| `/admin/members` | `profiles ORDER BY created_at DESC` + count bookings per member |
| `/admin/reviews` | `event_reviews ORDER BY created_at DESC` + profiles + events joins |
| `/admin/notifications` | `notifications ORDER BY sent_at DESC` |

---

## 3. Auth Flow

```
                    ┌──────────────────────────────────────────┐
                    │              SIGNUP FLOW                  │
                    └──────────────────────────────────────────┘

User visits /join
        │
        ▼
Step 1: Enter email + password + full name
        │
        ▼
supabase.auth.signUp({
  email, password,
  options: { data: { full_name } }
})
        │
        ├── Success ──────────────────────────────────────────┐
        │                                                      │
        ▼                                                      ▼
  auth.users row created                          DB trigger fires:
  Session cookie set                              handle_new_user()
                                                        │
                                                        ▼
                                                  profiles row created
                                                  (id = auth.users.id,
                                                   role = 'member',
                                                   onboarding_complete = false)
        │
        ▼
Steps 2-4: Profile details (job, industry, interests, bio)
        │  Each step calls a Server Action:
        │  updateProfile({ jobTitle, company, ... })
        │  → Validates auth.uid() server-side
        │  → UPDATE profiles SET ... WHERE id = auth.uid()
        │
        ▼
Step 5: Welcome screen
        │  Server Action: completeOnboarding()
        │  → UPDATE profiles SET onboarding_complete = true
        │
        ▼
Redirect to /events or /profile


                    ┌──────────────────────────────────────────┐
                    │              LOGIN FLOW                   │
                    └──────────────────────────────────────────┘

User visits /login
        │
        ▼
Enter email + password
        │
        ▼
supabase.auth.signInWithPassword({ email, password })
        │
        ├── Success → Session cookie set → Redirect to /events
        │
        └── Error → Show error message (invalid credentials)


                    ┌──────────────────────────────────────────┐
                    │          MIDDLEWARE (every request)        │
                    └──────────────────────────────────────────┘

Request arrives
        │
        ▼
middleware.ts runs:
  1. Create Supabase server client with request cookies
  2. Call supabase.auth.getSession()
        │
        ├── Session valid → Continue (attach refreshed cookies to response)
        │
        ├── Session expired (refresh token valid) → Auto-refresh → Continue
        │
        └── No session / expired refresh token
                │
                ├── On public route (/, /events, /gallery, /login, /join)
                │   → Continue (unauthenticated access allowed)
                │
                └── On protected route (/profile, /bookings, /admin/*)
                    → Redirect to /login?redirect={current_path}


                    ┌──────────────────────────────────────────┐
                    │         PROTECTED ROUTE LAYOUTS           │
                    └──────────────────────────────────────────┘

(member) layout.tsx:
  1. const { data: { user } } = await supabase.auth.getUser()
  2. if (!user) → redirect('/login')
  3. if (!profile.onboarding_complete) → redirect('/join?step=2')
  4. Render children

(admin) layout.tsx:
  1. const { data: { user } } = await supabase.auth.getUser()
  2. if (!user) → redirect('/login')
  3. const profile = await supabase.from('profiles').select('role').eq('id', user.id).single()
  4. if (profile.role !== 'admin') → redirect('/')
  5. Render children


                    ┌──────────────────────────────────────────┐
                    │       TRIGGER FAILURE SAFETY NET          │
                    └──────────────────────────────────────────┘

If the handle_new_user() trigger fails:
  - auth.users row exists but profiles row does not
  - The EXCEPTION block logs a warning but lets signup succeed
  - On first protected page visit, the (member) layout checks for profile
  - If profile missing → redirect to /join?step=2 with a toast:
    "Let's finish setting up your profile"
  - The join page step 2+ Server Action does an UPSERT on profiles
    (INSERT ... ON CONFLICT (id) DO UPDATE)

This ensures no user is permanently stuck without a profile.
```

### First Admin Creation

The first admin is created via `supabase/seed.sql`:

```sql
-- In seed.sql (after Supabase Auth user is created via CLI or dashboard):
-- 1. Create the admin user via Supabase Auth API (supabase CLI or dashboard)
-- 2. Then in seed.sql:
UPDATE profiles SET role = 'admin' WHERE email = 'admin@thesocialseen.com';
```

**Important:** The admin user must first be created through Supabase Auth (email/password signup via the dashboard or CLI). The seed.sql only updates the role. The profiles row is created automatically by the trigger.

---

## 4. Booking State Machine

```
                           ┌─────────────┐
                           │  NO BOOKING  │
                           └──────┬───────┘
                                  │
                    ┌─────────────┴─────────────┐
                    │                           │
              spots available            event is full
                    │                           │
                    ▼                           ▼
            ┌──────────────┐          ┌────────────────┐
            │  CONFIRMED   │          │   WAITLISTED   │
            └──────┬───────┘          └───────┬────────┘
                   │                          │
         ┌────────┼────────┐        ┌────────┼────────┐
         │        │        │        │        │        │
    user cancels  │   admin marks   │   user cancels  │
         │        │   post-event    │        │        │
         ▼        │        │        ▼        │        │
  ┌───────────┐   │        │  ┌───────────┐  │   admin promotes
  │ CANCELLED │   │        │  │ CANCELLED │  │        │
  └───────────┘   │        ▼  └───────────┘  │        ▼
                  │  ┌──────────┐             │  ┌──────────────┐
                  │  │ NO_SHOW  │             │  │  CONFIRMED   │
                  │  └──────────┘             │  └──────────────┘
                  │                           │
                  └───────────────────────────┘
                         (no transitions
                          from no_show)
```

### Valid State Transitions

| From | To | Trigger | Actor |
|------|----|---------|-------|
| (none) | confirmed | Book event (spots available) | User (via `book_event()` RPC) |
| (none) | waitlisted | Book event (full) | User (via `book_event()` RPC) |
| confirmed | cancelled | Cancel booking | User or Admin |
| waitlisted | cancelled | Leave waitlist | User or Admin |
| waitlisted | confirmed | Promote from waitlist | Admin only |
| confirmed | no_show | Mark no-show after event | Admin only |
| cancelled | (new row) confirmed | Rebook (spots available) | User (creates NEW booking row) |
| cancelled | (new row) waitlisted | Rebook (full) | User (creates NEW booking row) |

### Invalid Transitions (enforced in application logic)

- confirmed → waitlisted (never demote)
- no_show → anything (terminal state)
- cancelled → confirmed/waitlisted on same row (create new row instead)
- Any state → any state for a past event (except admin no_show marking)

### Waitlist Recomputation

When a waitlisted booking is cancelled:
1. Get all remaining waitlisted bookings for that event, ordered by current `waitlist_position`
2. Reassign positions sequentially starting from 1
3. This is done in the `cancel_booking()` Server Action

When admin promotes from waitlist:
1. Find the booking with `waitlist_position = 1` for that event
2. Set `status = 'confirmed'`, `waitlist_position = NULL`
3. Recompute remaining waitlist positions

---

## 5. Edge Cases Register

### EC-01: Race Condition on Last Spot

| | |
|---|---|
| **Scenario** | Two users click "Book" simultaneously when 1 spot remains |
| **Risk** | Both get confirmed, exceeding capacity |
| **Solution** | `book_event()` RPC function uses `SELECT ... FOR UPDATE` row lock on the event. Only one transaction proceeds at a time. Second user gets waitlisted. |
| **Status** | Handled by design (Section 1, Booking RPC Function) |

### EC-02: Rebook After Cancellation

| | |
|---|---|
| **Scenario** | User books, cancels, then tries to book the same event again |
| **Risk** | Duplicate booking or unique constraint violation |
| **Solution** | Partial unique index `(user_id, event_id) WHERE status != 'cancelled'` allows rebooking. A new booking row is created; the cancelled row remains for audit. |
| **Status** | Handled by partial unique index |

### EC-03: Waitlist for Past Event

| | |
|---|---|
| **Scenario** | Event date passes while users are still on the waitlist |
| **Risk** | Orphaned waitlist entries, confusing UX |
| **Solution** | No auto-action for demo. Admin dashboard flags: "X events have waitlisted members for past events." Admin can bulk-cancel. The `book_event()` function rejects bookings for past events. |
| **Status** | Acceptable for demo — flag in admin UI |

### EC-04: Capacity Reduction Below Confirmed Count

| | |
|---|---|
| **Scenario** | Admin edits event capacity from 30 to 20, but 25 are already confirmed |
| **Risk** | Data inconsistency — more confirmed than capacity |
| **Solution** | Server Action validates: `new_capacity >= confirmed_count OR new_capacity IS NULL`. Reject with error: "Cannot reduce below 25 confirmed bookings. Cancel some bookings first." |
| **Status** | Enforced in Server Action validation |

### EC-05: Admin Cancels Entire Event

| | |
|---|---|
| **Scenario** | Admin decides to cancel an event with 20 confirmed + 5 waitlisted bookings |
| **Risk** | Orphaned bookings, confused members |
| **Solution** | "Cancel Event" Server Action: (1) Set `events.is_cancelled = true`, (2) UPDATE all active bookings for that event to `status = 'cancelled'`, (3) Create a notification record for event attendees. Mocked email notification (toast + console.log). |
| **Status** | Requires "Cancel Event" admin action — spec for backend-developer |

### EC-06: Price Change After Booking

| | |
|---|---|
| **Scenario** | User books a free event, admin later changes price to £35 |
| **Risk** | Retroactive charge, confusing billing |
| **Solution** | `bookings.price_at_booking` captures the event price at the moment of booking. Existing bookings are grandfathered. Since payments are mocked for demo, this is recorded for audit only. |
| **Status** | Handled by `price_at_booking` column |

### EC-07: Auth Trigger Failure

| | |
|---|---|
| **Scenario** | `handle_new_user()` trigger fails — auth.users created but profiles row missing |
| **Risk** | User can log in but has no profile, breaking all queries |
| **Solution** | Trigger has EXCEPTION handler that logs but doesn't fail signup. Protected route layout checks for profile existence. If missing, redirects to `/join?step=2` with UPSERT logic. |
| **Status** | Handled by safety net (Section 3) |

### EC-08: Simultaneous Profile Updates

| | |
|---|---|
| **Scenario** | User has two tabs open, edits profile in both |
| **Risk** | Lost update (second save overwrites first) |
| **Solution** | `updated_at` column exists but last-write-wins is acceptable for a demo. No optimistic locking needed. |
| **Status** | Acceptable for demo |

### EC-09: Review for Unattended Event

| | |
|---|---|
| **Scenario** | User tries to review an event they didn't attend (or were marked no_show) |
| **Risk** | Fake reviews |
| **Solution** | RLS policy on `event_reviews` INSERT requires `EXISTS (bookings WHERE status = 'confirmed' AND event_id = ...)`. Users marked `no_show` cannot review because their status is no longer `confirmed`. Server Action also validates this. |
| **Status** | Enforced by RLS + Server Action |

### EC-10: Review for Future Event

| | |
|---|---|
| **Scenario** | User tries to review an event that hasn't happened yet |
| **Risk** | Pre-emptive reviews |
| **Solution** | Server Action checks `events.date_time < now()` before allowing review submission. RLS alone can't enforce this easily, so it's application-level. |
| **Status** | Enforced in Server Action |

---

## 6. Architecture Decisions Refined

### ADR-01: Price Stored in Pence (Integer)

**Decision:** Store `events.price` and `bookings.price_at_booking` as integers in pence (£35.00 = 3500).

**Rationale:** Avoids floating-point rounding issues. The frontend formats with `(price / 100).toFixed(2)` for display. Standard practice for payment systems.

**Impact:** The current mock data uses whole pounds (e.g., `price: 35`). When migrating to Supabase, multiply by 100. Update `currency.ts` utility.

### ADR-02: Event Soft Cancellation via `is_cancelled` Boolean

**Decision:** Add `is_cancelled boolean DEFAULT false` to events table instead of adding 'cancelled' to a status enum.

**Rationale:** An event can be both published and cancelled (members need to see it was cancelled). `is_published` and `is_cancelled` are independent states. A single status enum can't represent this.

**Impact:** Queries for "active" events must filter `WHERE is_published AND NOT is_cancelled AND deleted_at IS NULL`.

### ADR-03: Booking RPC Function Over Application-Only Logic

**Decision:** Use a PostgreSQL RPC function (`book_event()`) for booking instead of client-side check-then-insert.

**Rationale:** Prevents race conditions on the last spot. The function uses `SELECT ... FOR UPDATE` row locking. This is critical even for a demo — two co-founders testing simultaneously and both getting "confirmed" would be embarrassing.

**Impact:** Bookings are created via `supabase.rpc('book_event', { p_user_id, p_event_id })` instead of direct insert. The function runs as `SECURITY DEFINER` and handles all validation.

### ADR-04: `event_with_stats` Database View

**Decision:** Create a database view that joins events with confirmed_count, avg_rating, review_count, and spots_left.

**Rationale:** Multiple pages need the same aggregated data (landing, events listing, related events, admin). A view centralises this and avoids inconsistent count logic across queries.

**Impact:** Event listing and card queries use the view. The view is read-only. Mutations still go to the `events` table directly.

### ADR-05: Font Correction — Inter, not DM Sans

**Decision:** Replace DM Sans with Inter in `layout.tsx`.

**Rationale:** CLAUDE.md specifies `Inter` for body text. The current implementation uses `DM_Sans`. This must be corrected in Batch 1.

**Impact:** Changes `layout.tsx` import and CSS variable `--font-sans`. May cause minor visual shifts in existing components.

### ADR-06: Hardcoded Hex Values Must Be Eliminated

**Decision:** All components must use CSS variables or Tailwind theme tokens — never inline hex values.

**Rationale:** Multiple components (events listing, admin page, etc.) currently use hardcoded values like `text-[#1C1C1E]`, `bg-[#FAF7F2]`, `text-[#C9A96E]`. These bypass the theme system and break dark mode.

**Impact:** Systematic find-and-replace in Batch 1 or 2. Map:
- `#1C1C1E` → `text-text-primary` or `bg-charcoal`
- `#FAF7F2` → `bg-bg-primary` or `bg-cream`
- `#C9A96E` → `text-gold`
- `#E8D5C4` → `border-blush` / `bg-blush`
- `#6B6B6B` / opacity variants → `text-text-secondary` or `text-text-tertiary`

### ADR-07: Route Groups for Layout Differentiation

**Decision:** Restructure pages into route groups as specified in CLAUDE.md.

**Rationale:** Different sections need different layouts:
- `(marketing)` — transparent/overlay header on hero, full-bleed sections
- `(auth)` — centered card layout, no footer
- `(member)` — standard layout + auth gate
- `(admin)` — sidebar layout + admin gate
- `(events)` and `gallery` — standard layout

**Impact:** File moves (not renames — Next.js route groups don't change URLs). Must be done carefully to avoid breaking imports. Batch 1 task.

### ADR-08: TypeScript Types Must Mirror DB Schema

**Decision:** Rewrite `src/types/index.ts` to match the normalised database schema, plus derived types for UI consumption.

**Rationale:** Current types are flat and mock-oriented (e.g., `SocialEvent` has `hostName`, `hostRole`, `hostAvatar` inline). The DB schema normalises this into `event_hosts` + `profiles`. Types need both:
- **DB row types** (matching Supabase-generated types or manual equivalents)
- **Composed types** (for pages that join multiple tables)

**Impact:** Every component that imports from `@/types` will need updating. Do this alongside Supabase integration.

### ADR-09: Category Enum Case Normalisation

**Decision:** Database enum uses lowercase (`drinks`, `dining`, `cultural`, ...). TypeScript uses the same lowercase values. Display labels are Title Case via a mapping utility.

**Rationale:** The current TS enum uses Title Case (`"Drinks"`, `"Dining"`). Database enums should be lowercase by convention. A `categoryLabel()` utility handles display.

**Impact:** Update `src/types/index.ts` EventCategory values. Update all filter UIs and event card displays to use the label utility.

### ADR-10: `event_inclusions` as Separate Table (Not JSONB)

**Decision:** Keep `event_inclusions` as a separate table with `sort_order`.

**Rationale:** While JSONB would be simpler for read-only display, the admin CRUD for managing inclusions (add, reorder, delete) is cleaner with a dedicated table. The admin event form can manipulate rows individually.

**Tradeoff:** Slightly more complex queries (nested select) but better admin UX. Acceptable.

### ADR-11: Image Loading Strategy

**Decision:** Use `next/image` with a custom Supabase Storage loader and Unsplash fallback.

**Rationale:** `next/image` provides optimisation, lazy loading, and responsive sizing. Supabase Storage URLs need to be added to `next.config.ts` `remotePatterns`. For the demo, images will be a mix of Unsplash URLs (seed data) and any admin-uploaded images.

**Impact:** Add Supabase project hostname to `next.config.ts` when known. Create `src/lib/utils/images.ts` to resolve image URLs (Supabase path → full URL, or passthrough for external URLs).

### ADR-12: Email Confirmation Disabled for Demo

**Decision:** Disable Supabase Auth email confirmation for the demo.

**Rationale:** Requiring email confirmation adds friction to the demo flow. The co-founder testing it shouldn't need to check email to log in. Enable post-launch.

**Impact:** Set in Supabase dashboard: Authentication → Settings → Confirm email = OFF. Document in `.env.local` setup instructions.

### ADR-13: Realtime Limited to Event Detail Attendee Count

**Decision:** Only subscribe to Supabase Realtime on the event detail page for live attendee count updates.

**Rationale:** Real-time everywhere is overkill for a demo. The one place it genuinely impresses is watching "8 spots left" tick down to "7 spots left" while someone else books.

**Impact:** One custom hook: `use-realtime-count.ts`. Subscribe to `bookings` table changes filtered by `event_id`. Cleanup on unmount. All other pages use server-fetched data.

---

## 7. Open Questions

These need a human decision before execution begins.

### OQ-01: Supabase Project Setup

**Question:** Has the Supabase project been created? What is the project URL and anon key?

**Why it matters:** Needed for `.env.local`, `next.config.ts` (image domains), and local development with `supabase start`.

**Blocking:** Batch 1 (Foundation)

### OQ-02: Font — Keep DM Sans or Switch to Inter?

**Question:** CLAUDE.md specifies Inter for body text. The current build uses DM Sans. Both are excellent sans-serif fonts. Which should we use?

**Options:**
- (A) Switch to Inter as per CLAUDE.md spec ← **recommended**
- (B) Update CLAUDE.md to reflect DM Sans (if the prototype was approved with DM Sans)

**Blocking:** Batch 1 (design system finalisation)

### OQ-03: Price Storage — Pence or Pounds?

**Question:** Should prices be stored in pence (3500 = £35.00) or pounds (35)?

**Options:**
- (A) Pence (integer) — standard for payment systems, prevents rounding ← **recommended**
- (B) Pounds (integer) — simpler for demo, no decimal events anyway

**Blocking:** Batch 1 (schema migration)

### OQ-04: Seed Data Admin User

**Question:** What email/password should the demo admin account use?

**Suggested:** `admin@thesocialseen.com` / (set via Supabase dashboard, not committed to code)

**Blocking:** Batch 1 (seed.sql)

### OQ-05: Supabase Storage Bucket Structure

**Question:** Proposed bucket structure:
- `avatars/` — profile photos (public read, authenticated write own)
- `events/` — event hero images (public read, admin write)
- `gallery/` — event gallery photos (public read, admin write)

Confirm or adjust?

**Blocking:** Batch 1 (Storage setup)

### OQ-06: Should Past Events Show on the Main Events Page?

**Question:** Currently, past events are in a collapsible accordion on `/events`. This is nice for showing history but could clutter the page. Keep or move to a separate `/events/past` route?

**Options:**
- (A) Keep accordion ← **current implementation, recommended for demo**
- (B) Move to `/events/past`

**Not blocking** — aesthetic decision.

### OQ-07: Error Boundaries

**Question:** Should we add `error.tsx` at the root layout and per-route-group level?

**Recommendation:** Yes — at minimum, `src/app/error.tsx` (global) and `src/app/(member)/error.tsx` (auth-related errors). Shows a branded error page instead of a white screen if Supabase is unreachable.

**Blocking:** Batch 9 (Polish) — but simple enough to do in Batch 1.

### OQ-08: Environment Variable Validation

**Question:** Should we validate that required env vars (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) are present at build time?

**Recommendation:** Yes — a simple check in `src/lib/supabase/client.ts` and `server.ts` that throws a clear error on missing vars. Prevents confusing runtime errors.

**Blocking:** Batch 1

---

## Migration Plan (Execution Order)

For reference — these are NOT being executed now. This is the planned migration sequence:

```
supabase/migrations/
├── 001_create_enums.sql           # user_role, event_category, booking_status, notification enums
├── 002_create_profiles.sql        # profiles table + RLS + trigger
├── 003_create_events.sql          # events table + RLS
├── 004_create_event_hosts.sql     # event_hosts + RLS
├── 005_create_event_inclusions.sql # event_inclusions + RLS
├── 006_create_bookings.sql        # bookings + partial unique index + RLS
├── 007_create_event_reviews.sql   # event_reviews + CHECK + UNIQUE + RLS
├── 008_create_event_photos.sql    # event_photos + RLS
├── 009_create_user_interests.sql  # user_interests + RLS
├── 010_create_notifications.sql   # notifications + RLS
├── 011_create_views.sql           # event_with_stats view
├── 012_create_functions.sql       # book_event() RPC, waitlist helpers
└── 013_create_storage_buckets.sql # Storage buckets + policies
```

Each migration is idempotent (`IF NOT EXISTS`) and self-contained.

---

## HANDOVER

- **Agent:** architect
- **Task:** Phase 1 system architecture review — produced SYSTEM-DESIGN.md
- **Files changed:** `SYSTEM-DESIGN.md` (created)
- **Migrations planned:** 13 migration files (see Migration Plan above — not yet created)
- **Tests added:** none (architect doesn't write tests)
- **Next agent:** Human review → then `backend-developer` for Batch 1 (Foundation)
- **Risks / open questions:**
  - 8 open questions requiring human decision (OQ-01 through OQ-08)
  - Font mismatch (DM Sans vs Inter) must be resolved before any visual work
  - Supabase project must be created before Batch 1 can start
  - Hardcoded hex values in existing components need systematic replacement
  - TypeScript types need full rewrite to match normalised DB schema
