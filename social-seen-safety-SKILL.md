---
name: social-seen-safety
description: "Critical safety rules and project context for working on The Social Seen codebase. Use this skill whenever the user mentions The Social Seen, asks for help with Supabase changes, migrations, auth work, RLS policies, booking logic, or any task on the events platform. Also trigger when the user asks about agent prompts, batch planning, or anything related to their London social events platform."
---

# The Social Seen — AI Agent Safety & Project Context

## ⚠️ SUPABASE SAFETY RULES — NON-NEGOTIABLE

These rules apply to every Claude Code session working on The Social Seen. Read all of them before executing any task.

### What you must NEVER do:
- Run `supabase db reset` without explicit human approval in the chat
- Run raw SQL that DROPs, TRUNCATEs, or DELETEs any table
- Disable Row Level Security (RLS) on any table, even temporarily for debugging
- Use the `service_role` key in any file under `src/` that could be imported client-side
- Import from `@/lib/supabase/admin` in any Client Component or file without `'use server'`
- Store Supabase keys, Stripe keys, or any secret in committed code (use `.env.local` only)
- Delete or modify an already-applied migration file — create a new migration instead
- Push directly to `main` — all work goes on feature branches
- Modify `auth.users` table directly — use Supabase Auth APIs only
- Run `ALTER TABLE` or `DROP COLUMN` without stating what data could be lost
- Create files with spaces in their names (e.g. `EventCard 2.tsx`)
- Exceed 15 file changes in a single batch without stopping to checkpoint

### What you MUST do instead:
- All schema changes via `supabase migration new <descriptive-name>`
- Migrations must be idempotent where possible (use `IF NOT EXISTS`, `IF EXISTS`)
- Seed data goes in `supabase/seed.sql` — never ad-hoc inserts
- Every new table has: `id uuid DEFAULT gen_random_uuid() PRIMARY KEY`, `created_at timestamptz DEFAULT now()`, and RLS enabled
- Every table that stores user-created content has `deleted_at timestamptz` for soft deletes
- RLS policies defined in migration files, not toggled in the Supabase dashboard
- Test with `supabase start` locally before declaring done
- Commit to feature branches: `feat/<batch-name>`
- Run `pnpm tsc --noEmit && pnpm lint && pnpm build` before declaring any batch done

---

## Auth & Role Safety

### User roles:
- `member` — default role on registration
- `admin` — manually set in database (not self-assignable)

### Role enforcement:
- Store role in `profiles.role` (default: 'member')
- Admin checks use `profiles.role = 'admin'` via RLS policy joins
- NEVER trust client-side role checks alone — always enforce in RLS and Server Actions
- Server Actions that modify events, manage members, or moderate reviews MUST verify admin role server-side
- Registration flow must NOT allow setting role — it defaults to 'member'

### Auth flow:
- Supabase Auth with email/password
- On signup: trigger creates `profiles` row with same UUID (via database trigger)
- Session refresh via middleware (`lib/supabase/middleware.ts`)
- Protected routes check auth in layout.tsx (server-side redirect)
- Admin routes additionally check role in layout.tsx

---

## RLS Policy Rules

Every policy must be defined in a migration file. This is the canonical policy set:

### profiles
```sql
-- Anyone can read profiles (public community)
CREATE POLICY "profiles_select" ON profiles FOR SELECT USING (true);
-- Users can update their own profile
CREATE POLICY "profiles_update" ON profiles FOR UPDATE USING (auth.uid() = id);
-- Insert handled by auth trigger, not user-facing
```

### events
```sql
-- Anyone can read published events
CREATE POLICY "events_select" ON events FOR SELECT USING (is_published = true OR
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
-- Only admins can insert/update
CREATE POLICY "events_insert" ON events FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "events_update" ON events FOR UPDATE USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
```

### bookings
```sql
-- Users see own bookings, admins see all
CREATE POLICY "bookings_select" ON bookings FOR SELECT USING (
  user_id = auth.uid() OR
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
-- Users can book for themselves only
CREATE POLICY "bookings_insert" ON bookings FOR INSERT WITH CHECK (user_id = auth.uid());
-- Users can cancel own, admins can update any
CREATE POLICY "bookings_update" ON bookings FOR UPDATE USING (
  user_id = auth.uid() OR
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
```

### event_reviews
```sql
-- Anyone can read visible reviews
CREATE POLICY "reviews_select" ON event_reviews FOR SELECT USING (is_visible = true);
-- Only verified attendees can review
CREATE POLICY "reviews_insert" ON event_reviews FOR INSERT WITH CHECK (
  user_id = auth.uid() AND
  EXISTS (SELECT 1 FROM bookings WHERE user_id = auth.uid() AND event_id = event_reviews.event_id AND status = 'confirmed'));
-- Own reviews only, admins can toggle visibility
CREATE POLICY "reviews_update" ON event_reviews FOR UPDATE USING (
  user_id = auth.uid() OR
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
```

### event_photos
```sql
-- Anyone can view
CREATE POLICY "photos_select" ON event_photos FOR SELECT USING (true);
-- Admins only for CUD
CREATE POLICY "photos_insert" ON event_photos FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
```

---

## Booking & Waitlist Safety

### Booking logic:
1. Check `event.capacity IS NULL` (unlimited) OR `confirmed_count < capacity`
2. If spots available → insert with `status = 'confirmed'`
3. If full → insert with `status = 'waitlisted'`, set `waitlist_position` = max + 1
4. On cancellation → set `status = 'cancelled'`, do NOT hard delete
5. Waitlist promotion is MANUAL (admin action) for the demo — no auto-promote
6. Waitlist positions must be recomputed when someone leaves the waitlist

### Booking constraints:
- One active booking per user per event (unique constraint on `user_id + event_id` where status != 'cancelled')
- Users cannot book past events
- Users cannot review events they didn't attend (RLS enforces this)
- Free events use RSVP flow (no Stripe), paid events show mock payment

---

## Design System Safety

### The following design tokens are LOCKED. Do not modify:
- See CLAUDE.md "Design Tokens" section for the full canonical set
- Charcoal `#1C1C1E`, Cream `#FAF7F2`, Gold `#C9A96E`
- Playfair Display for headings, Inter for body
- Gold CTAs are rounded-full with white text

### Do NOT:
- Invent new colours outside the defined palette
- Use different fonts
- Change border-radius conventions (xl for cards, full for CTAs)
- Use spinner loading states — always skeleton screens
- Use default shadcn colours — override everything with the brand palette

### DO:
- Reference tokens from Tailwind config, never hardcode hex values in components
- Use CSS variables for dark mode (toggle data-theme attribute)
- Follow the component patterns table in CLAUDE.md exactly

---

## File & Import Safety

### Forbidden patterns:
```typescript
// NEVER — service_role in client code
import { adminClient } from '@/lib/supabase/admin'
// in a file without 'use server' directive

// NEVER — hardcoded keys
const supabase = createClient('https://...', 'eyJ...')

// NEVER — direct table manipulation bypassing RLS
supabase.from('profiles').update({ role: 'admin' })
// role changes are DB-admin-only operations
```

### Required patterns:
```typescript
// Server Components use server client
import { createServerClient } from '@/lib/supabase/server'

// Client Components use browser client
import { createBrowserClient } from '@/lib/supabase/client'

// Server Actions use 'use server' directive
'use server'
import { createServerClient } from '@/lib/supabase/server'

// Admin operations (migration scripts only)
import { createAdminClient } from '@/lib/supabase/admin'
// This file must NEVER be imported outside of server-only contexts
```

---

## Prompt & Batch Conventions

### Batch prompts:
- Stored in `prompts/` directory
- Named: `batch-NN-descriptive-name.md`
- Each prompt includes: context, tasks (numbered), verification checklist, files affected
- Max 15 files changed per batch
- Additive changes before structural changes

### Done checklist (required at end of every batch):
```
[ ] TypeScript compiles: pnpm tsc --noEmit
[ ] Lint passes: pnpm lint
[ ] Build succeeds: pnpm build
[ ] New components have at least one test
[ ] No hardcoded hex values — all colours from Tailwind config
[ ] No service_role imports in client code
[ ] Committed to feature branch (not main)
[ ] Files created listed below:
    - [list every file created or modified]
```

### If anything is ambiguous:
STOP and ask the developer. Do not guess. Do not improvise database schema changes. Do not create tables that aren't in CLAUDE.md. Do not add npm packages without stating why.

---

## Project Context

### What this is:
A demo build to impress a co-founder. It needs to feel production-ready: polished UI, smooth interactions, real data from Supabase, working auth and bookings.

### What this is NOT:
- A production deployment with real payments (Stripe is mocked)
- A system handling real user data yet (seed data only)
- An enterprise app needing horizontal scaling

### Aesthetic:
Soho House meets Time Out. Sophisticated, warm, editorial. The kind of site a member would proudly share with a colleague. Every pixel matters.

### Users of this platform:
- London professionals, 30s–40s
- Well-educated, design-aware, used to premium digital experiences
- Accessing primarily on mobile (iPhone) and desktop (MacBook)
- Events range from free run clubs to £55 supper clubs
