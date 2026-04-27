-- Migration: drop_user_interests_interest_column
--
-- Phase 3, F2-schema (final cut of the user_interests dual-write window).
-- Spec: docs/member-data-layer-spec.md (Decision 9).
--
-- ── Prerequisites ───────────────────────────────────────────────────────────
-- This migration is safe to apply ONLY after the following has shipped to
-- main:
--
--   • F2-app (PR #66) — migrates the two remaining production reads of
--     `user_interests.interest` to JOIN through `user_interests.tag_id`
--     onto `tags.label`:
--       - getProfile (src/lib/supabase/queries/profile.ts)
--       - exportMyData (src/app/(member)/profile/privacy-actions.ts)
--     After PR #66, the only places in the codebase that touched the
--     `interest` text column for READS were the regression-guard
--     allowlist entries — both retired in this PR's app-side cleanup.
--
-- The regression guard at
-- src/lib/__tests__/user-interests-text-column-migration-guard.test.ts
-- enforced zero `user_interests.interest` reads in the migrated paths
-- at test time. PR #66's manual verification confirmed the same at
-- merge time. This migration ships the schema half; the matching
-- app-side cleanup of the type system, the write-path INSERT payload,
-- the seed shape, and the allowlist trim ships in the same PR.
--
-- ── What this migration does ────────────────────────────────────────────────
--   1. Drop the legacy unique constraint `uq_user_interests_user_interest`
--      (originally on `(user_id, interest)`, replaced by Migration 3 with
--      `uq_user_interests_user_tag` on `(user_id, tag_id)`). IF EXISTS
--      handles either state — Migration 3's intent was to drop it, but
--      depending on the apply path the original may still be present.
--   2. Drop the column `user_interests.interest`.
--
-- After this migration, `user_interests.tag_id` (FK to public.tags) is
-- the SOLE carrier of interest semantics. The 23-row canonical taxonomy
-- in `tags` (15 primary-eligible + 8 interest-only, seeded by Migration
-- 2) is the read source via JOIN.
--
-- ── No view dependents ──────────────────────────────────────────────────────
-- F1b-schema's hard-won lesson was that `event_with_stats` had an
-- internal column reference to `events.category` via `e.*` expansion.
-- For F2-schema, no view in supabase/migrations/ references
-- user_interests:
--   • event_with_stats (Migration 011) is sourced from events / bookings
--     / event_reviews — not user_interests.
--   • profile_email_audit (Migration 20260423000001) is sourced from
--     profiles + auth.users — not user_interests.
-- Confirmed by `grep -nE 'FROM.*user_interests|JOIN.*user_interests'
-- supabase/migrations/*.sql` returning zero hits inside CREATE VIEW.
--
-- ── No index dependents ─────────────────────────────────────────────────────
-- The two indexes on user_interests are:
--   • idx_user_interests_user — on user_id (Migration 9). Unaffected.
--   • idx_user_interests_tag  — on tag_id (Migration 3). Unaffected.
-- No `idx_user_interests_interest` exists. Confirmed by
-- `grep -nE 'idx_user_interests' supabase/migrations/*.sql`.
--
-- ── Anon visibility ─────────────────────────────────────────────────────────
-- N/A — schema-level change. user_interests.tag_id was never on the anon
-- read path (RLS limits SELECT to `user_id = auth.uid()` or admin), so
-- the column drop has no effect on anon visibility.
--
-- ── Drop order ──────────────────────────────────────────────────────────────
-- Constraint before column — the original UNIQUE(user_id, interest) is
-- defined on the column we're dropping. Postgres would auto-drop it on
-- DROP COLUMN, but explicit-drop-first matches the F1b-schema pattern
-- of avoiding implicit CASCADE behaviour.
--
-- ── Safety / blast radius ───────────────────────────────────────────────────
-- DESTRUCTIVE. Once this lands, the `user_interests.interest` text
-- column is gone. Recovery from a bad apply is backup-restore only.
-- The defensive DO $$ … END $$; block at the end raises if either
-- artefact (column or legacy unique constraint) is still present after
-- the drops — failure surfaces explicitly rather than as a silent
-- success masking a bad apply.
--
-- ── Idempotency ─────────────────────────────────────────────────────────────
-- All DROPs use IF EXISTS. The post-apply verification check raises if
-- artefacts remain, NOT if they are already absent — a no-op replay is
-- supported.
--
-- ── Rollback ────────────────────────────────────────────────────────────────
-- There is no automated rollback. To restore the legacy state, restore
-- from a pre-apply backup AND revert the matching app-side commit
-- (which removes UserInterest.interest, the INSERT-payload `interest`
-- field, and the seed's interest-text VALUES). user_interests.tag_id
-- is unaffected — the new code path keeps working.

-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║ 1. Drop the legacy unique constraint                                       ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

-- Original constraint from Migration 9 (20260402000009_create_user_interests).
-- Migration 3 (20260504000002_migrate_user_interests_to_tag_id) added the
-- replacement `uq_user_interests_user_tag` on `(user_id, tag_id)` and (per
-- its body) drops this one — but IF EXISTS handles both states for safety.
ALTER TABLE public.user_interests
  DROP CONSTRAINT IF EXISTS uq_user_interests_user_interest;

-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║ 2. Drop the column                                                         ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

ALTER TABLE public.user_interests
  DROP COLUMN IF EXISTS interest;

-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║ 3. Defensive post-apply verification                                       ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

-- If either artefact is still present after the DROPs above, something
-- has gone wrong (an unexpected dependency, a partial apply, or a bug
-- in supabase db push) — fail the migration loudly so the operator
-- notices instead of declaring success on a corrupted schema.
DO $$
BEGIN
  -- Column should no longer exist on user_interests.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_interests'
      AND column_name = 'interest'
  ) THEN
    RAISE EXCEPTION 'F2-schema apply incomplete: user_interests.interest column still exists after DROP COLUMN';
  END IF;

  -- Legacy unique constraint should no longer exist on user_interests.
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_user_interests_user_interest'
      AND conrelid = 'public.user_interests'::regclass
  ) THEN
    RAISE EXCEPTION 'F2-schema apply incomplete: uq_user_interests_user_interest constraint still exists after DROP CONSTRAINT';
  END IF;
END $$;
