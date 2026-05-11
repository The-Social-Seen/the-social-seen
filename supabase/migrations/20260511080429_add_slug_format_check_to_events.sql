-- Migration: add CHECK constraint enforcing slugify format on events.slug
--
-- Purpose
-- ───────
-- Slug format on public.events.slug was enforced only by the TypeScript
-- `slugify` helper at insert time (src/lib/utils/slugify.ts). That left
-- two gaps:
--
--   1. An out-of-band write (raw SQL by an admin, a future Server Action
--      that forgot to route through slugify, or a data import) could land
--      a slug containing `?`, `&`, `/`, spaces, etc.
--   2. src/components/events/MobileBookingBar.tsx:116 interpolates the
--      slug raw into the post-login redirect URL
--      (`/login?redirect=/events/${eventSlug}?book=1`). A slug containing
--      `?` or `&` would shadow the `redirect` query parameter or split
--      it, producing a broken redirect target after authentication.
--
-- This migration closes both gaps at the database layer with a single
-- CHECK constraint mirroring the regex the application enforces.
--
-- Shape change
-- ────────────
-- Adds one constraint to public.events:
--   CONSTRAINT events_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
--
-- The regex matches the output of `slugify`: lowercase alphanumerics
-- joined by single hyphens, no leading/trailing hyphen, no consecutive
-- hyphens, no other characters.
--
-- Pre-flight validation
-- ─────────────────────
-- Before adding the constraint, the DO block below counts any existing
-- rows that would violate it and raises a clear exception. Without this
-- pre-flight, an offending row would surface a cryptic Postgres error
-- (`new row for relation "events" violates check constraint
-- "events_slug_format"`) with no clue how many rows are bad. The
-- pre-flight surfaces the count so the operator can fix the data first.
--
-- Note: in production the only writers of `events.slug` are the admin
-- Server Action paths in src/app/(admin)/admin/actions.ts, which route
-- through `uniqueSlug` → `slugify`. Existing rows are expected to be
-- compliant.
--
-- Anon visibility
-- ───────────────
-- No new column, no GRANT change. Pure constraint addition. RLS posture
-- unchanged.
--
-- Cross-reference
-- ───────────────
-- Follow-up from PR #103 reviewer note S-1 (logged-out booking redirect).
-- Per ~/.claude/projects/.../memory/project_migration_apply_step.md, the
-- user must run `supabase db push --include-all --linked` after merge —
-- CI applies migrations only to its local Supabase stack for E2E.

DO $$
DECLARE
  bad_count int;
BEGIN
  SELECT COUNT(*) INTO bad_count
  FROM public.events
  WHERE slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$';

  IF bad_count > 0 THEN
    RAISE EXCEPTION
      'Cannot add events_slug_format CHECK: % row(s) in public.events have slugs that do not match the slugify regex. Fix data first (e.g. SELECT id, slug FROM public.events WHERE slug !~ ''^[a-z0-9]+(-[a-z0-9]+)*$'').',
      bad_count;
  END IF;
END $$;

ALTER TABLE public.events
  ADD CONSTRAINT events_slug_format
  CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

COMMENT ON CONSTRAINT events_slug_format ON public.events IS
  'Enforces URL-safe slug format (lowercase alphanumerics joined by single hyphens). Mirrors src/lib/utils/slugify.ts so out-of-band writes (raw SQL, data import) cannot land slugs containing ? & / spaces — which would break post-login redirect URLs that interpolate the slug raw. Added per PR #103 reviewer note S-1.';
