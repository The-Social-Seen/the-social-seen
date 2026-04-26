-- Migration: migrate_user_interests_to_tag_id
--
-- Phase 3, Wave 3 (Migration 3) of the Member Data Layer build.
-- Spec: docs/member-data-layer-spec.md (Decision 8 "Migration 3" intent +
-- Decision 9 reconciliation map + SQL fragment "user_interests schema
-- change (Migration 3)").
--
-- ── Pairing note ────────────────────────────────────────────────────────────
-- This migration depends on `public.tags` existing and the 23 canonical
-- rows being seeded — both established by 20260504000001_create_tags_and_event_tags.sql
-- (Migration 2). The pair must apply in order; both ship in the same PR.
--
-- ── What this migration does ────────────────────────────────────────────────
--   1. Adds `user_interests.tag_id uuid REFERENCES public.tags(id) ON DELETE
--      CASCADE` as nullable. Cascade because user-interest rows are
--      tightly bound to the tag they reference — if a tag is ever
--      hard-deleted (admin curation, not user data deletion), the
--      orphaned interest row should go too. (In practice tags retire
--      via `is_active = false`, never DELETE.)
--   2. Backfills `tag_id` from the existing `interest` text column via
--      the Decision 9 reconciliation map — 14 known INTEREST_OPTIONS
--      values, 6 remap to primary-eligible tags, 8 remap to interest-
--      only tags. Off-list values fall through to NULL and are caught by
--      the verification step.
--   3. Verifies zero NULL `tag_id` rows remain. Defensive RAISE EXCEPTION
--      surfaces any unmapped legacy values immediately — the migration
--      refuses to apply rather than silently leaving holes.
--   4. Sets `tag_id` NOT NULL once verification passes.
--   5. Swaps the unique constraint:
--        old: uq_user_interests_user_interest (user_id, interest)
--        new: uq_user_interests_user_tag      (user_id, tag_id)
--      Both swapped inside an explicit transaction so concurrent sessions
--      never see a window with neither constraint active.
--   6. Adds idx_user_interests_tag for the new tag_id-keyed lookups.
--
-- ── Anon-visibility decision (per CLAUDE.md rule) ───────────────────────────
-- N/A — `user_interests` has never been exposed to anon (RLS gates SELECT
-- to own row + admin). The new `tag_id` column inherits the same posture.
-- No GRANT change.
--
-- ── Why the legacy `interest` text column is KEPT ───────────────────────────
-- Belt-and-braces rollback insurance for one release. After this PR ships,
-- the application still reads `user_interests.interest` (string) for the
-- existing UI; W5 swaps to read via `user_interests.tag_id` join to
-- `tags.label`. Once that lands AND has soaked, follow-up F2 drops the
-- text column. Until then keeping it gives us a clean "revert tag_id
-- column, application keeps reading interest text" rollback path with
-- zero data loss.
--
-- ── Out of scope (held for follow-up migrations) ────────────────────────────
--   • F2 — drop `user_interests.interest` text column. Ships after the
--     application has fully migrated to the FK.
--   • F1 / Migration 4 — drop `events.category` enum. Independent path.
--
-- ── Safety / blast radius ───────────────────────────────────────────────────
--   • ADD COLUMN of a nullable column: catalog-only, no rewrite.
--   • Backfill UPDATE: bounded — at current scale ~30 rows in seed, ~4K
--     at 1,000-member projection. Sub-second.
--   • SET NOT NULL: full table scan to verify, but the immediately-prior
--     verification block has already counted NULLs at zero.
--   • Constraint swap inside a transaction: no concurrent session
--     observes "neither constraint active."
--   • The reconciliation CASE covers all 14 INTEREST_OPTIONS values from
--     `src/lib/constants.ts`. Off-list values trigger RAISE EXCEPTION —
--     fail loud, don't silently drop rows.
--
-- ── Idempotency ─────────────────────────────────────────────────────────────
--   • ADD COLUMN IF NOT EXISTS — re-runs are no-ops.
--   • Backfill UPDATE only writes where `tag_id IS NULL` — already-mapped
--     rows are skipped on re-run.
--   • DROP CONSTRAINT IF EXISTS / ADD CONSTRAINT IF NOT EXISTS pattern.
--   • CREATE INDEX IF NOT EXISTS.
--   • Verification block raises explicitly on inconsistency.
--
-- ── Rollback ────────────────────────────────────────────────────────────────
-- 1. ALTER TABLE public.user_interests DROP CONSTRAINT uq_user_interests_user_tag;
-- 2. ALTER TABLE public.user_interests ADD CONSTRAINT uq_user_interests_user_interest UNIQUE (user_id, interest);
-- 3. ALTER TABLE public.user_interests ALTER COLUMN tag_id DROP NOT NULL;
-- 4. ALTER TABLE public.user_interests DROP COLUMN tag_id;
-- The application reverts to reading `interest` text — which has been
-- preserved throughout the migration.

-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║ 1. Add nullable tag_id FK                                                  ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

ALTER TABLE public.user_interests
  ADD COLUMN IF NOT EXISTS tag_id uuid
    REFERENCES public.tags(id) ON DELETE CASCADE;

COMMENT ON COLUMN public.user_interests.tag_id IS
  'FK to public.tags. Backfilled from the legacy `interest` text column by Migration 3 via the Decision 9 reconciliation map. The `interest` text column is kept until follow-up F2 ships.';

-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║ 2. Backfill tag_id from interest text (Decision 9 reconciliation)          ║
-- ║ 14 INTEREST_OPTIONS values, 6 → primary-eligible, 8 → interest-only.       ║
-- ║ Only updates rows where tag_id is currently NULL — re-run safe.            ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

UPDATE public.user_interests ui
SET tag_id = t.id
FROM public.tags t
WHERE ui.tag_id IS NULL
  AND t.slug = CASE ui.interest
    -- Group A: primary-eligible remaps (6)
    WHEN 'Wine & Cocktails'   THEN 'drinks-bars'
    WHEN 'Fine Dining'        THEN 'dining-supper-clubs'
    WHEN 'Art & Culture'      THEN 'galleries-museums'
    WHEN 'Yoga & Wellness'    THEN 'wellness-mindfulness'
    WHEN 'Running & Sport'    THEN 'sport-fitness'
    WHEN 'Jazz & Music'       THEN 'live-music-gigs'
    -- Group B: interest-only remaps (8)
    WHEN 'Technology'         THEN 'interest-technology'
    WHEN 'Entrepreneurship'   THEN 'interest-entrepreneurship'
    WHEN 'Networking'         THEN 'interest-networking'
    WHEN 'Photography'        THEN 'interest-photography'
    WHEN 'Travel'             THEN 'interest-travel'
    WHEN 'Books & Literature' THEN 'interest-books-literature'
    WHEN 'Sustainable Living' THEN 'interest-sustainable-living'
    WHEN 'Film & Cinema'      THEN 'interest-film-cinema'
    -- Off-list values fall through; the WHERE clause above ensures
    -- t.slug must equal the CASE expression, so a NULL CASE produces
    -- no row match and tag_id stays NULL — caught by §3 verification.
    ELSE NULL
  END;

-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║ 3. Verify zero NULL tag_id rows remain                                     ║
-- ║ RAISE EXCEPTION (not warning) so the migration aborts on any unmapped     ║
-- ║ legacy interest value. Backend-developer handles by either adding the     ║
-- ║ mapping above or explicitly deleting the orphan row in a follow-up PR     ║
-- ║ — never silently dropping data.                                            ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

DO $$
DECLARE
  null_count int;
  sample_unmapped text;
BEGIN
  SELECT count(*) INTO null_count
  FROM public.user_interests
  WHERE tag_id IS NULL;

  IF null_count > 0 THEN
    -- Surface the unmapped value(s) in the error message for fast triage.
    SELECT string_agg(DISTINCT interest, ', ') INTO sample_unmapped
    FROM public.user_interests
    WHERE tag_id IS NULL;
    RAISE EXCEPTION
      'user_interests backfill incomplete: % rows with NULL tag_id. Unmapped interest values: %',
      null_count, sample_unmapped;
  END IF;
END $$;

-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║ 4. SET NOT NULL                                                            ║
-- ║ Safe because §3 has just verified zero NULLs.                              ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

ALTER TABLE public.user_interests
  ALTER COLUMN tag_id SET NOT NULL;

-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║ 5. Swap the unique constraint (atomic, in a transaction)                   ║
-- ║ Old: (user_id, interest) — text-based, prevents duplicate tags per user    ║
-- ║      under the legacy text vocabulary.                                     ║
-- ║ New: (user_id, tag_id)   — FK-based, prevents duplicate tags under the     ║
-- ║      canonical taxonomy. Same semantics; sharper enforcement.              ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

BEGIN;

ALTER TABLE public.user_interests
  DROP CONSTRAINT IF EXISTS uq_user_interests_user_interest;

ALTER TABLE public.user_interests
  ADD CONSTRAINT uq_user_interests_user_tag UNIQUE (user_id, tag_id);

COMMIT;

-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║ 6. Index for FK-keyed lookups                                              ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

CREATE INDEX IF NOT EXISTS idx_user_interests_tag
  ON public.user_interests(tag_id);

-- ── End of Migration 3 ──────────────────────────────────────────────────────
