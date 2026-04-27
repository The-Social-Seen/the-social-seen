-- Migration: drop_events_category_and_triggers
--
-- Phase 3, F1b-schema (final cut of the dual-write window).
-- Spec: docs/member-data-layer-spec.md (Decision 5).
--
-- ── Prerequisites ───────────────────────────────────────────────────────────
-- This migration is safe to apply ONLY after both of the following have
-- shipped to main:
--
--   • F1a (PR #62) — adds primary_tag to the events query layer + UI;
--     introduces the JSON shape every member-facing surface depends on.
--   • F1b-app (PR #63) — migrates the three remaining production reads of
--     `events.category` (getRelatedEvents, BookingCard, EventsTable) to
--     `event.primary_tag.label`/`.slug`. After PR #63, the only place in
--     the codebase that touched `events.category` was
--     src/types/index.ts (the legacy enum + helper definitions).
--
-- The regression guard at src/lib/__tests__/event-category-migration-guard.test.ts
-- (widened in PR #63 to scan src/components/events/, src/components/admin/,
-- src/components/profile/, src/lib/supabase/queries/, src/app/events/)
-- enforces zero `event.category` reads at test time. PR #63's manual
-- verification confirmed the same at merge time. This migration ships
-- the schema half; the matching app-side cleanup of the type system
-- ships in the same PR.
--
-- ── What this migration does ────────────────────────────────────────────────
--   1. Drop the bidirectional sync triggers shipped by Migration 2
--      (20260504000001_create_tags_and_event_tags.sql):
--        • trg_sync_primary_tag_from_category ON public.events
--        • trg_sync_category_from_primary_tag ON public.event_tags
--   2. Drop the trigger functions:
--        • _sync_primary_tag_from_category()
--        • _sync_category_from_primary_tag()
--   3. Drop the slug→enum helper:
--        • _tag_slug_to_legacy_category(text)
--      (No matching enum→slug helper exists — that direction lived inline
--      in _sync_primary_tag_from_category as a CASE expression.)
--   4. Drop the events.category dependents:
--        • idx_events_category    (B-tree index from Migration 003)
--        • event_with_stats view  (from Migration 011) — the view's
--          SELECT e.* expansion at view-creation time bound an internal
--          column reference to events.category; Postgres rejects the
--          column drop while the view holds that reference.
--      Both blockers fail the column drop with SQLSTATE 2BP01 if not
--      pre-dropped (caught the hard way during CI of this migration).
--   5. Drop the column:
--        • events.category
--   6. Recreate the event_with_stats view with the SELECT body verbatim
--      from Migration 011 (e.* now expands without `category`).
--   7. Drop the enum type:
--        • public.event_category
--
-- After this migration, event_tags.is_primary = true is the SOLE source of
-- truth for an event's primary categorisation. The 15-tag canonical
-- taxonomy in `tags` (seeded by Migration 2) replaces the 9-value legacy
-- enum. The event_with_stats view returns the same shape minus `category`
-- — F1a's primary_tag JOIN is the read path for that field anyway.
--
-- ── Anon visibility ─────────────────────────────────────────────────────────
-- N/A — this is a schema-level change. The `events` table's anon GRANT
-- previously included `category` implicitly via the table-level GRANT;
-- after the column drops, that implicit grant covers strictly fewer
-- columns. The recreated view inherits the underlying tables' RLS so
-- anon visibility on event_with_stats is unchanged. No new exposure.
--
-- ── Drop order ──────────────────────────────────────────────────────────────
-- Postgres drops dependents before dependencies. We do it explicitly to
-- avoid relying on CASCADE (which would silently nuke unrelated objects
-- if the dependency graph ever surprises us):
--   1. Triggers reference functions + tables → drop first.
--   2. Trigger functions reference the enum (`category::text` casts and
--      `event_category` parameter types) → drop next.
--   3. The slug→enum helper RETURNS event_category → drop next.
--   4. idx_events_category indexes events(category) → drop next.
--   5. event_with_stats view holds an `e.*`-expanded reference to
--      events.category → drop next (will be recreated post-column-drop).
--   6. events.category column is typed as event_category → drop next.
--   7. Recreate event_with_stats view (e.* now resolves without
--      `category`) → before the type drop so any post-apply consumer
--      hitting the view sees the new shape immediately.
--   8. The event_category type now has zero dependents → drop last.
--
-- Each statement is IF EXISTS / verbatim CREATE for idempotency —
-- re-running this migration after a successful apply is a no-op for the
-- DROPs and a no-op-ish recreate for the view (CREATE VIEW errors if it
-- exists, but we DROP IF EXISTS just before, so the pair is idempotent).
--
-- ── Safety / blast radius ───────────────────────────────────────────────────
-- DESTRUCTIVE. Once this lands, the `events.category` column is gone and
-- the `event_category` enum no longer exists. Recovery from a bad apply
-- is backup-restore only. The defensive DO $$ … END $$; block at the end
-- raises if any of the four artefacts (column, type, two triggers) are
-- still present after the drops — failure surfaces explicitly rather than
-- as a silent success masking a bad apply.
--
-- ── Idempotency ─────────────────────────────────────────────────────────────
-- All DROPs use IF EXISTS. The post-apply verification check raises if
-- artefacts remain, NOT if they are already absent — a no-op replay is
-- supported.
--
-- ── Rollback ────────────────────────────────────────────────────────────────
-- There is no automated rollback. To restore the legacy state, restore
-- from a pre-apply backup AND revert the matching app-side commit (which
-- removes the EventCategory type, the categoryLabel helper, and the
-- BookingWithEvent.event Pick<> entry for `category`). F1a's primary_tag
-- column on event_tags is unaffected by this migration; the new code
-- path keeps working.

-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║ 1. Drop the bidirectional sync triggers                                    ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

DROP TRIGGER IF EXISTS trg_sync_primary_tag_from_category ON public.events;
DROP TRIGGER IF EXISTS trg_sync_category_from_primary_tag ON public.event_tags;

-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║ 2. Drop the trigger functions                                              ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

DROP FUNCTION IF EXISTS public._sync_primary_tag_from_category();
DROP FUNCTION IF EXISTS public._sync_category_from_primary_tag();

-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║ 3. Drop the slug→enum helper                                               ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

DROP FUNCTION IF EXISTS public._tag_slug_to_legacy_category(text);

-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║ 4. Drop events.category dependents (index + view)                          ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

-- The 003_create_events.sql migration also created a B-tree index
-- `idx_events_category` on `events(category)` for the legacy filter UI.
-- Postgres won't drop the column while a dependent index still references
-- it (SQLSTATE 2BP01). Drop the index first, then the column. The index
-- is no longer needed — F1a/F1b-app moved the filter UI to read
-- `event_tags.is_primary` joined to `tags.slug`, which has its own
-- unique index (`uq_event_tags_one_primary`) under W2+W3.
DROP INDEX IF EXISTS public.idx_events_category;

-- Migration 011 (20260402000011_create_views.sql) created the
-- event_with_stats view as `SELECT e.*, … FROM public.events e LEFT
-- JOIN …`. Postgres expands `e.*` at view-creation time, so the view's
-- internal column list bound a reference to events.category — even
-- though the SQL never names it explicitly. CREATE OR REPLACE VIEW
-- can't change a resolved column list, so the only fix is drop, drop,
-- recreate. The recreation runs in section 6 below; this DROP must
-- come before the column drop.
DROP VIEW IF EXISTS public.event_with_stats;

-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║ 5. Drop the column                                                         ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

ALTER TABLE public.events DROP COLUMN IF EXISTS category;

-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║ 6. Recreate event_with_stats view                                          ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

-- Body verbatim from Migration 011 lines 7-31 (the SELECT and onward).
-- We use plain `CREATE VIEW` (not `CREATE OR REPLACE`) because we
-- explicitly dropped it in section 4 above — this pair (DROP + CREATE)
-- is idempotent under re-apply. `e.*` now resolves to the events row
-- shape MINUS `category`. Members read primary_tag.label via the F1a
-- JOIN on event_tags + tags; the view's column set is no longer a
-- consumer of events.category in any case.
CREATE VIEW public.event_with_stats AS
SELECT
  e.*,
  COALESCE(bc.confirmed_count, 0)  AS confirmed_count,
  COALESCE(rc.avg_rating, 0)       AS avg_rating,
  COALESCE(rc.review_count, 0)     AS review_count,
  CASE
    WHEN e.capacity IS NULL THEN NULL
    ELSE GREATEST(e.capacity - COALESCE(bc.confirmed_count, 0), 0)
  END AS spots_left
FROM public.events e
LEFT JOIN (
  SELECT event_id, COUNT(*) AS confirmed_count
  FROM public.bookings
  WHERE status = 'confirmed' AND deleted_at IS NULL
  GROUP BY event_id
) bc ON bc.event_id = e.id
LEFT JOIN (
  SELECT event_id,
         AVG(rating)::numeric(3,2) AS avg_rating,
         COUNT(*)                  AS review_count
  FROM public.event_reviews
  WHERE is_visible = true
  GROUP BY event_id
) rc ON rc.event_id = e.id
WHERE e.deleted_at IS NULL;

-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║ 7. Drop the enum type                                                      ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

DROP TYPE IF EXISTS public.event_category;

-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║ 8. Defensive post-apply verification                                       ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

-- If any of the four artefacts are still present after the DROPs above,
-- something has gone wrong (a dependency we didn't account for, a
-- partial apply, or a bug in supabase db push) — fail the migration
-- loudly so the operator notices instead of declaring success on a
-- corrupted schema.
DO $$
BEGIN
  -- Column should no longer exist on events.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'events'
      AND column_name = 'category'
  ) THEN
    RAISE EXCEPTION 'F1b-schema apply incomplete: events.category column still exists after DROP COLUMN';
  END IF;

  -- Enum type should no longer exist.
  IF EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'event_category'
  ) THEN
    RAISE EXCEPTION 'F1b-schema apply incomplete: public.event_category type still exists after DROP TYPE';
  END IF;

  -- Triggers should no longer exist on their respective tables.
  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_sync_primary_tag_from_category' AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'F1b-schema apply incomplete: trg_sync_primary_tag_from_category trigger still exists';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_sync_category_from_primary_tag' AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'F1b-schema apply incomplete: trg_sync_category_from_primary_tag trigger still exists';
  END IF;

  -- Trigger functions should no longer exist.
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        '_sync_primary_tag_from_category',
        '_sync_category_from_primary_tag',
        '_tag_slug_to_legacy_category'
      )
  ) THEN
    RAISE EXCEPTION 'F1b-schema apply incomplete: at least one trigger / helper function still exists in public schema';
  END IF;
END $$;
