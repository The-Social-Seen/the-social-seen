-- Migration: admin_get_user_demographics_batch
--
-- ── Why now ────────────────────────────────────────────────────────────────
-- The admin event-bookings list (`getEventBookings`) needs bulk gender for
-- every attendee, mirroring the phone-number batch-read pattern. The only
-- existing demographics primitive is the SINGLE-row `admin_get_demographics
-- (uuid)` (20260503000001); calling it once per row would create an N+1
-- round-trip storm against PostgREST. This migration adds the missing BATCH
-- sibling.
--
-- ── Pattern source ─────────────────────────────────────────────────────────
-- Mirrors `admin_get_user_phones(target_user_ids uuid[])`
-- (20260602000001_admin_get_user_phones_batch.sql) one-for-one — same admin
-- gate, same 'forbidden' message, same `search_path`, same GRANT target, same
-- `deleted_at IS NULL` filter, same `p.` column-alias idiom. Named
-- `admin_get_user_demographics` (not `admin_get_demographics_batch`) to match
-- the more recently established, twice-shipped `admin_get_user_*` naming
-- lineage rather than the older, zero-caller `admin_get_demographics` shape.
-- See docs/SYSTEM-DESIGN-admin-gender-batch-rpc.md §1.1 for the full naming
-- rationale.
--
-- Single-row equivalent: `admin_get_demographics(uuid)`, 20260503000001,
-- left unchanged — see docs/SYSTEM-DESIGN-admin-gender-batch-rpc.md §2 (zero
-- production callers today; kept as a legitimate single-row read primitive,
-- exactly as `admin_get_user_phone` was kept alongside `admin_get_user_phones`).
--
-- ── What this migration does ───────────────────────────────────────────────
--   1. Creates `admin_get_user_demographics(target_user_ids uuid[])`
--      SECURITY DEFINER, returning a set of (user_id, gender, age_range) for
--      admin callers.
--   2. Grants EXECUTE to `authenticated` (the in-body admin gate is what
--      restricts the RESULT to admins; the GRANT only allows invocation).
--
-- ── Anon-visibility decision ───────────────────────────────────────────────
-- NO CHANGE to any table GRANT. This migration adds a FUNCTION, not a new
-- column — `gender` and `age_range` already exist on public.profiles and
-- their anon-visibility was already decided (admin-only; excluded from both
-- the `anon` and `authenticated` column allow-lists) in migration
-- 20260503000001. That decision is unchanged here. The ONLY new exposure is
-- this admin-gated SECURITY DEFINER function; anon and non-admin
-- `authenticated` callers receive 'forbidden', never data — same posture as
-- admin_get_user_phones (20260602000001).
--
-- ── search_path decision ───────────────────────────────────────────────────
-- `SET search_path = public` — EXACTLY matches its siblings (`get_my_
-- demographics`, `admin_get_demographics`, `admin_get_user_phone`,
-- `admin_get_user_phones`). The stricter `public, pg_catalog` form used by
-- the reaper function is a deliberate future retrofit PR that moves ALL
-- SECURITY DEFINER functions together (MEMORY.md → "SECURITY DEFINER
-- search_path hardening"). Introducing the stricter form on only this one
-- function here would fragment the pattern exactly as this migration's own
-- phone-batch precedent warns against doing. Do not deviate.
--
-- ── Soft-delete filter ─────────────────────────────────────────────────────
-- The function filters `deleted_at IS NULL`, so soft-deleted profiles return
-- NO row. A booking can reference a profile that was later soft-deleted; in
-- that case the merge yields NULL. Callers MUST NOT assume every input id
-- yields a row (build a Map keyed by user_id with a `?? null` fallback;
-- never zip-by-index).
--
-- ── Safety / blast radius ──────────────────────────────────────────────────
--   • Catalog-only operation (CREATE OR REPLACE FUNCTION + GRANT). No table
--     rewrite, no row scan, no DROP/TRUNCATE/DELETE, no `supabase db reset`.
--   • No edit to any already-applied migration file.
--   • Function is CREATE OR REPLACE — re-runnable cleanly. GRANT is idempotent.
--   • Least privilege: scoped to exactly two columns + an admin gate. No
--     service-role anywhere in this path.
--
-- ── Rollback ───────────────────────────────────────────────────────────────
-- `DROP FUNCTION IF EXISTS public.admin_get_user_demographics(uuid[]);`
-- No data loss — the function only reads existing data; dropping it removes
-- the admin batch-read path (the single-row `admin_get_demographics` remains
-- as the fallback read path).
--
-- ── Prod apply step (FLAG FOR THE HUMAN — agent does NOT run this) ──────────
-- Per MEMORY.md → "Migrations need manual `supabase db push` to prod", CI
-- applies migrations to the LOCAL Supabase only. After this PR merges, a human
-- must run `supabase db push --include-all --linked` against prod to apply
-- this migration.

-- ── 1. SECURITY DEFINER: admin_get_user_demographics(target_user_ids uuid[]) ──
--
-- Batch sibling of admin_get_demographics(uuid) (20260503000001), named to
-- match the more recently established admin_get_user_phone(s) lineage
-- (20260503000002 / 20260602000001) — see migration header for the naming
-- rationale. Mirrors admin_get_user_phones(uuid[]) one-for-one: plpgsql,
-- explicit admin role check on the caller's auth.uid(), RAISE EXCEPTION
-- 'forbidden' for non-admins (same message string), deleted_at IS NULL
-- filter, alias `p.` to disambiguate OUT-parameter names from table columns.

CREATE OR REPLACE FUNCTION public.admin_get_user_demographics(target_user_ids uuid[])
RETURNS TABLE (user_id uuid, gender public.gender, age_range public.age_range)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  SELECT p.id, p.gender, p.age_range
  FROM public.profiles p
  WHERE p.id = ANY(target_user_ids)
    AND p.deleted_at IS NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_user_demographics(uuid[]) TO authenticated;
