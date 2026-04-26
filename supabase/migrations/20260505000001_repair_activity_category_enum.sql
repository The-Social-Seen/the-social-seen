-- Migration: repair_activity_category_enum
--
-- Forward-fix for a quirk discovered during the W2+W3 hosted-apply
-- verification (Checkpoint C, 2026-04-26). The original migration
-- `20260406000001_add_activity_category.sql` runs:
--
--   ALTER TYPE event_category ADD VALUE IF NOT EXISTS 'activity';
--
-- That migration is recorded in `schema_migrations` as applied, and
-- on local + CI environments the value DID get added. On the hosted
-- production project, however, the value was somehow not committed —
-- a Postgres `ALTER TYPE ... ADD VALUE` cannot run inside a
-- transaction in older PG versions, and `supabase db push` wraps each
-- migration in a transaction. The value was hand-added on hosted via
-- the SQL editor on 2026-04-26 to unblock the Checkpoint C smoke
-- tests.
--
-- This migration is the durable forward-fix: it re-applies the ADD
-- VALUE (idempotently via IF NOT EXISTS) so any FUTURE environment
-- (a fresh `supabase db reset` in CI, a restored backup, a brand-new
-- staging project) gets a complete enum. On environments where the
-- original migration succeeded (every local DB + CI), this is a
-- no-op. On environments where it didn't (hosted, any future restore
-- from a hosted backup), this rescues the missing value.
--
-- ── Anon visibility ─────────────────────────────────────────────────
-- N/A — enum values are schema-level, not row-level. Anon's existing
-- SELECT grant on `events.category` is unaffected by this migration.
--
-- ── Idempotency ─────────────────────────────────────────────────────
-- IF NOT EXISTS is the documented idempotent form. Re-running this
-- migration after a successful apply is a no-op.

ALTER TYPE public.event_category ADD VALUE IF NOT EXISTS 'activity';

-- Defensive verification: surface a clear error if (somehow, against
-- all the above) the value still isn't present after this migration.
-- The migration apply will roll back and the operator will see the
-- RAISE NOTICE message naming the gap.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum
    WHERE enumtypid = 'public.event_category'::regtype
      AND enumlabel = 'activity'
  ) THEN
    RAISE EXCEPTION 'event_category enum still missing ''activity'' after ALTER TYPE — investigate Postgres transaction behaviour for ADD VALUE';
  END IF;
END $$;
