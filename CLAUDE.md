# CLAUDE.md — The Social Seen

## Project Overview

**The Social Seen** is a curated social events platform for London professionals in their 30s–40s. ~1,000 existing WhatsApp members. This build is a demo for co-founder sign-off — it must look and feel production-ready.

**Repository:** the-social-seen
**Live URL:** TBD (Vercel)
**Supabase project:** TBD

### Required Reading (execution agents must read ALL before starting)
1. This file (CLAUDE.md)
2. `social-seen-safety-SKILL.md` — database and security safety rules
3. `SYSTEM-DESIGN.md` — refined architecture, schema, query maps, edge cases
4. `UX-REVIEW.md` — user flow analysis, copy recommendations, mobile fixes
5. `AMENDMENTS.md` — approved changes from both reviews, overrides per batch

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 15 (App Router, Server Components default) |
| Styling | Tailwind CSS 4 + shadcn/ui |
| Database | Supabase (PostgreSQL + Auth + Realtime + Storage) |
| Payments | Stripe (mocked for demo — real integration later) |
| Email | Resend (mocked for demo — toast + console.log) |
| Deployment | Vercel |
| Package manager | pnpm |
| Node | 20 LTS |

---

## Design Tokens — LOCKED

These were extracted from the approved HTML prototype and are non-negotiable. Do NOT improvise colours or fonts.

> **Documented exception:** `src/lib/email/templates/_shared.ts` may use literal hex values (the brand palette below) because email clients don't support CSS variables and inlining is required for cross-client rendering. The hex values must match this palette exactly. No other file in the codebase should use literal hex.

### Colours

```
--color-charcoal:       #1C1C1E    /* Primary text, hero backgrounds, nav */
--color-cream:          #FAF7F2    /* Page backgrounds, cards */
--color-white:          #FFFFFF    /* Card surfaces, modals */
--color-gold:           #C9A96E    /* CTAs, accent text, highlights — use sparingly */
--color-gold-hover:     #B8944F    /* Gold button hover state */
--color-gold-light:     #C9A96E1A  /* Gold at 10% opacity — tag backgrounds */
--color-blush:          #E8D5C4    /* Soft accent, dividers */
--color-border:         #E8E4DE    /* Card borders, separators */
--color-muted:          #6B6B6B    /* Secondary text, timestamps */
--color-danger:         #C45D4D    /* Waitlist badge, sold out, errors */
--color-success:        #4A7C59    /* Confirmed badges, success states */

/* Dark mode */
--color-dark-bg:        #121214    /* Page background */
--color-dark-surface:   #1C1C1E    /* Card surfaces */
--color-dark-border:    #2C2C2E    /* Borders */
--color-dark-text:      #F5F5F5    /* Primary text */
--color-dark-muted:     #8E8E93    /* Secondary text */
```

### Typography

```
Headings:  Playfair Display (serif)
           - Logo "Seen" uses italic variant
           - Page headings use regular weight
           - Letter-spacing: 0.01em on large headings
Body:      DM Sans (sans-serif)
           - Regular 400 for body
           - Medium 500 for labels, nav items
           - Semibold 600 for emphasis, prices
```

### Spacing & Layout

- Max content width: 1280px (7xl)
- Card border-radius: 12px (rounded-xl)
- Button border-radius: 9999px (rounded-full) for primary CTAs, 8px for secondary
- Section vertical padding: 80px desktop, 48px mobile
- Card padding: 24px
- Grid gap: 24px (gap-6)

### Component Patterns (from prototype)

| Component | Pattern |
|-----------|---------|
| Primary CTA | Gold bg, white text, rounded-full, px-8 py-3 |
| Secondary CTA | White bg, charcoal border, charcoal text, rounded-full |
| Category tag | Gold text, gold border at 20% opacity, rounded-full, px-3 py-1, text-sm |
| "Spots left" | Gold text, text-sm, right-aligned on card |
| "Waitlist" badge | Gold accent text, text-sm (NOT red — waitlist is positive) |
| "SOLD OUT" overlay | Centered on card image, gold bg, white text, rounded-full |
| Event card | White bg, border, rounded-xl, image top, content bottom |
| Progress bar (capacity) | Gold fill, cream track, rounded-full, h-2 |
| Star rating | Gold filled stars, border-only empty stars |
| Step indicator | Gold filled circle = complete, gold outline = current, grey = future |
| Modal | White bg, rounded-2xl, backdrop blur, max-w-lg |

---

## Database Rules — NON-NEGOTIABLE

### What you must NEVER do:
- Run raw SQL that DROPs, TRUNCATEs, or DELETEs tables
- Use the `service_role` key in any client-side code
- Disable RLS on any table, even temporarily
- Delete Supabase migration files after they've been applied
- Store passwords, tokens, or secrets in the codebase
- Run `supabase db reset` without explicit human approval
- Modify `auth.users` directly — always use Supabase Auth APIs

### What you MUST do instead:
- All schema changes go through `supabase/migrations/` files
- Use `supabase migration new <name>` to create migration files
- Seed data goes in `supabase/seed.sql` only
- Every table has RLS enabled — no exceptions
- Every table has `created_at` (timestamptz, default now())
- Soft deletes via `deleted_at` timestamp — never hard delete user data
- All timestamps stored as UTC (`timestamptz`), displayed in Europe/London
- **New column on `public.profiles`?** Make an explicit anon-visibility decision.
  The secure-by-default posture (established in migration 20260420000003) is
  that anon only reads columns on the allow-list; any new column is invisible
  to anon unless the migration explicitly adds it to the GRANT. Omit from the
  anon GRANT unless the column is genuinely needed for public event rendering
  and safe to expose publicly. Document the decision in the migration header.

### Supabase Schema

```sql
-- Core tables (in dependency order)

profiles          -- extends auth.users (same UUID as PK)
events            -- all events (past, upcoming, draft)
event_hosts       -- join table: events ↔ profiles (hosts)
event_inclusions  -- structured "What's Included" items
bookings          -- user ↔ event (confirmed/cancelled/waitlisted/no_show)
event_reviews     -- verified attendee reviews (1–5 stars + text)
event_photos      -- gallery photos per event
user_interests    -- user interest tags
notifications     -- sent notification log
```

### Key Schema Decisions

| Decision | Detail |
|----------|--------|
| profiles not users | Supabase owns auth.users. We extend with public.profiles (same id) |
| category is enum | `event_category` enum: drinks, dining, cultural, wellness, sport, workshops, music, networking |
| capacity nullable | NULL = unlimited (e.g. run club). Check `capacity IS NULL OR spots < capacity` |
| booking status enum | `booking_status`: confirmed, cancelled, waitlisted, no_show |
| waitlist_position | Integer on bookings. Recompute on cancellation. |
| soft deletes | `deleted_at timestamptz` on profiles, events, bookings |
| slugs | events.slug is unique, generated from title, used in URLs |
| image_url flexible | Stores Supabase Storage path OR external URL. Resolve with helper. |
| timestamps UTC | All timestamptz. Frontend converts to Europe/London for display. |

---

## RLS Policies

Define these in migration files, not the dashboard.

| Table | SELECT | INSERT | UPDATE | DELETE |
|-------|--------|--------|--------|--------|
| profiles | Anyone (public community) | Auth trigger on signup | Own profile only | Never (soft delete) |
| events | Published events: anyone. Drafts: admins | Admins only | Admins only | Never (soft delete) |
| bookings | Own bookings only. Admins: all | Authenticated, for self only | Own booking status only. Admins: all | Never (soft delete) |
| event_reviews | Visible reviews: anyone | Authenticated + must have confirmed booking for event | Own review only. Admins: is_visible | Never |
| event_photos | Anyone | Admins only | Admins only | Admins only |
| user_interests | Own interests only. Admins: all | Authenticated, for self | Authenticated, for self | Authenticated, for self |

Admin role: check `profiles.role = 'admin'` via auth.uid() join.

---

## File Structure

```
the-social-seen/
├── src/
│   ├── app/
│   │   ├── (marketing)/          # Landing, about
│   │   │   ├── page.tsx
│   │   │   └── about/page.tsx
│   │   ├── (events)/             # Public event pages
│   │   │   └── events/
│   │   │       ├── page.tsx
│   │   │       └── [slug]/page.tsx
│   │   ├── (auth)/               # Login, registration
│   │   │   ├── login/page.tsx
│   │   │   └── join/page.tsx
│   │   ├── (member)/             # Auth-gated member pages
│   │   │   ├── profile/page.tsx
│   │   │   └── bookings/page.tsx
│   │   ├── (admin)/              # Admin-only pages
│   │   │   └── admin/
│   │   │       ├── page.tsx      # Dashboard overview
│   │   │       ├── events/
│   │   │       ├── members/
│   │   │       ├── reviews/
│   │   │       └── notifications/
│   │   ├── gallery/page.tsx      # Public gallery
│   │   ├── layout.tsx
│   │   └── globals.css
│   ├── components/
│   │   ├── ui/                   # shadcn/ui components
│   │   ├── layout/               # Header, Footer, MobileNav, PageWrapper
│   │   ├── events/               # EventCard, EventFilters, BookingModal, CapacityBar
│   │   ├── gallery/              # MasonryGrid, Lightbox, PhotoCard
│   │   ├── reviews/              # StarRating, ReviewCard, ReviewForm
│   │   ├── profile/              # ProfileForm, InterestSelector, BookingsList
│   │   ├── admin/                # KPICard, DataTable, EventForm, ReviewModeration
│   │   └── shared/               # CategoryTag, StatusBadge, EmptyState, SkeletonCard
│   ├── lib/
│   │   ├── supabase/
│   │   │   ├── client.ts         # Browser client (anon key only)
│   │   │   ├── server.ts         # Server client (for Server Components)
│   │   │   ├── middleware.ts     # Auth session refresh
│   │   │   └── admin.ts          # Service role (server-only, never imported client-side)
│   │   ├── stripe/               # Payment utilities (mocked initially)
│   │   ├── utils/
│   │   │   ├── dates.ts          # Format dates in Europe/London timezone
│   │   │   ├── images.ts         # Resolve Supabase Storage or external URLs
│   │   │   ├── slugify.ts        # Generate URL-safe slugs
│   │   │   └── currency.ts       # Format GBP prices
│   │   └── constants.ts          # Site config, nav links, categories
│   ├── config/
│   │   └── design-tokens.ts      # Exported token values for JS usage
│   ├── types/
│   │   └── index.ts              # All TypeScript types/interfaces
│   └── hooks/
│       ├── use-booking.ts
│       ├── use-waitlist.ts
│       └── use-realtime-count.ts
├── supabase/
│   ├── migrations/               # All schema changes here
│   ├── seed.sql                  # Seed data
│   └── config.toml
├── public/
│   └── og/                       # Open Graph images
├── .env.local                    # Supabase + Stripe keys (gitignored)
├── CLAUDE.md                     # This file
└── prompts/                      # Agent execution prompts
    ├── batch-01-foundation.md
    ├── batch-02-marketing-pages.md
    ├── batch-03-event-pages.md
    └── ...
```

---

## Agent Rules

### Planning agent (Opus in claude.ai) — CTO role
- Defines architecture, writes CLAUDE.md, writes agent prompts
- NEVER outputs terminal commands that modify code, git, or database
- Read-only suggestions only (git status, cat, SELECT queries)
- Produces prompt files for Claude Code to execute

### Execution agent (Claude Code) — Builder role
- Follows prompt files from `prompts/` directory
- Works in batches of 3–5 related changes
- Commits to feature branches only — never push to main
- Runs tests before reporting done
- If a prompt is ambiguous, STOP and ask — do not guess

### Batch rules
- Each batch has a numbered prompt file
- Each prompt includes: context, specific tasks, verification checklist, files to create/modify
- Additive changes before structural changes
- No batch may modify more than 15 files
- Every batch ends with a done checklist

### Git workflow
- Branch naming: `feat/<batch-name>` (e.g. `feat/foundation`, `feat/event-pages`)
- Commit messages: conventional commits (`feat:`, `fix:`, `chore:`)
- Merge to main only after human review
- Tag releases: `v0.1.0` (foundation), `v0.2.0` (pages), etc.

---

## Testing Requirements

### Every batch must include:
1. TypeScript compiles with zero errors (`pnpm tsc --noEmit`)
2. Lint passes (`pnpm lint`)
3. Any new component has at least one test
4. Server Actions have integration tests
5. Auth/RLS changes have explicit security test cases
6. Build succeeds (`pnpm build`)

### Test stack:
- **Unit/Component:** Vitest + React Testing Library
- **E2E:** Playwright (stretch — add after Batch 5)
- **DB:** Supabase local dev (`supabase start`) for migration testing

---

## What's Real vs. Mocked (Demo Scope)

| Feature | Status | Notes |
|---------|--------|-------|
| Auth (email/password) | REAL | Supabase Auth |
| Event listing + filters | REAL | Supabase queries |
| Event detail pages | REAL | Server Components + slug routing |
| Booking (free events) | REAL | Supabase insert + RLS |
| Waitlist join/leave | REAL | Supabase + position tracking |
| Profile CRUD | REAL | Supabase + Storage for avatar |
| Admin event CRUD | REAL | Server Actions + RLS |
| Reviews | REAL | Post-event, verified attendees only |
| Gallery | REAL | Supabase Storage + seed Unsplash |
| Dark mode | REAL | CSS variables + toggle |
| Stripe payments | MOCKED | Simulated checkout, confirm flow |
| Email notifications | MOCKED | Toast + console.log |
| Waitlist auto-promote | MOCKED | Manual admin action for demo |
| Google Maps | MOCKED | Static image, link to Google Maps |
| Social login (Google) | DEFERRED | Post-demo |

---

## Priority Build Order

**IMPORTANT:** Each batch has amendments from the architect and UX reviews. Read `AMENDMENTS.md` for per-batch overrides before starting any batch.

1. **Batch 1 — Foundation:** Project setup, Supabase schema (13 migrations), seed data, design system, base layout, error boundaries, env validation
2. **Batch 2 — Marketing:** Landing page (updated hero copy), footer, header (route-based nav, auth-aware), about page (footer link only)
3. **Batch 3 — Events:** Events listing with filters, event detail page, sticky mobile booking bar, positive waitlist messaging
4. **Batch 4 — Auth:** Login, **3-step registration** (Account → Interests → Welcome), auth middleware, disabled Google OAuth button
5. **Batch 5 — Member:** Profile page with "Complete Your Profile" banner, bookings list, edit profile, empty states with CTAs
6. **Batch 6 — Booking:** **2-step free** (Confirm → Ticket Card), **3-step paid** (Confirm → Mock Payment → Ticket Card), bottom sheet on mobile, book_event() RPC
7. **Batch 7 — Social:** **ReviewForm component** (must build), gallery page, per-event photos, lightbox with keyboard/swipe
8. **Batch 8 — Admin:** Dashboard (mitesh50@hotmail.com admin), event CRUD with slug preview, member list, review moderation, one-click waitlist promote
9. **Batch 9 — Polish:** Dark mode (light default), gold/cream skeleton shimmer, touch target audit, safe area insets, responsive QA, SEO, performance
