-- Migration: admin_get_user_phones_batch
--
-- ── Why now ────────────────────────────────────────────────────────────────
-- Phase 3 PII hardening (20260420000003 → 20260503000002) revoked
-- `phone_number` from BOTH the `anon` and the `authenticated` column-level
-- SELECT GRANT on `public.profiles`. The only sanctioned reads are via
-- SECURITY DEFINER helpers: `get_my_phone()` (own row) and
-- `admin_get_user_phone(uuid)` (admin, single row).
--
-- The admin LIST surfaces (per-event attendees, members table, attendee CSV
-- export) need each row's phone in BULK. The only existing admin primitive is
-- the SINGLE-row `admin_get_user_phone(uuid)`; calling it once per row would be
-- an N+1 round-trip storm against PostgREST (the members list is up to ~1,000
-- rows). This migration adds the missing BATCH sibling.
--
-- ── Pattern source ─────────────────────────────────────────────────────────
-- Batch sibling of `admin_get_user_phone(target_user_id uuid)` in
-- 20260503000002_narrow_phone_number_grant.sql. Mirrors that function
-- one-for-one; the only differences are (a) array parameter, (b) set return,
-- (c) the body selects `id` alongside `phone_number` so the caller can key the
-- merge. Same admin gate, same 'forbidden' message, same `search_path`, same
-- GRANT target. See docs/SYSTEM-DESIGN-member-phone-admin-read.md §1.
--
-- ── What this migration does ───────────────────────────────────────────────
--   1. Creates `admin_get_user_phones(target_user_ids uuid[])` SECURITY
--      DEFINER, returning a set of (user_id, phone_number) for admin callers.
--   2. Grants EXECUTE to `authenticated` (the in-body admin gate is what
--      restricts the RESULT to admins; the GRANT only allows invocation).
--
-- ── Anon-visibility decision ───────────────────────────────────────────────
-- NO CHANGE to any table GRANT. `phone_number` remains revoked from BOTH
-- `anon` (since 20260420000003) AND `authenticated` (since 20260503000002).
-- This migration adds NOTHING to either grant and adds NO new column to
-- `public.profiles` — so the CLAUDE.md "new column anon-visibility" rule is
-- satisfied vacuously. The ONLY new exposure is this admin-gated SECURITY
-- DEFINER function; anon and non-admin `authenticated` callers receive
-- 'forbidden', never data.
--
-- ── search_path decision ───────────────────────────────────────────────────
-- `SET search_path = public` — EXACTLY matches its three siblings
-- (`get_my_phone`, `admin_get_user_phone`, `admin_get_demographics`). The
-- stricter `public, pg_catalog` form is deliberately NOT used here: sibling
-- consistency is the project decision. The search_path hardening retrofit
-- (MEMORY.md → "SECURITY DEFINER search_path hardening") is a separate future
-- PR that will move all four functions together — introducing the stricter
-- form on only this one function would fragment the pattern.
--
-- ── Soft-delete filter ─────────────────────────────────────────────────────
-- The function filters `deleted_at IS NULL`, so soft-deleted profiles return
-- NO row. A booking can reference a profile that was later soft-deleted
-- (account deletion nulls the profile but retains the booking for event
-- history); in that case the merge yields NULL → UI shows "—" / CSV exports an
-- empty cell. This is the intended outcome: a deleted member's PII must not
-- resurface in an admin list. Callers MUST NOT assume every input id yields a
-- row (build a Map keyed by user_id with a `?? null` fallback; never zip-by-
-- index).
--
-- ── Safety / blast radius ──────────────────────────────────────────────────
--   • Catalog-only operation (CREATE OR REPLACE FUNCTION + GRANT). No table
--     rewrite, no row scan, no DROP/TRUNCATE/DELETE, no `supabase db reset`.
--   • No edit to any already-applied migration file.
--   • Function is CREATE OR REPLACE — re-runnable cleanly. GRANT is idempotent.
--   • Least privilege: scoped to exactly one column + an admin gate. No
--     service-role anywhere in this path.
--
-- ── Rollback ───────────────────────────────────────────────────────────────
-- `DROP FUNCTION IF EXISTS public.admin_get_user_phones(uuid[]);`
-- No data loss — the function only reads existing data; dropping it removes
-- the admin batch-read path (the singular `admin_get_user_phone` remains).
--
-- ── Prod apply step (FLAG FOR THE HUMAN — agent does NOT run this) ──────────
-- Per MEMORY.md → "Migrations need manual `supabase db push` to prod", CI
-- applies migrations to the LOCAL Supabase only. After this PR merges, a human
-- must run `supabase db push --include-all --linked` against prod to apply
-- this migration.

-- ── 1. SECURITY DEFINER: admin_get_user_phones(target_user_ids uuid[]) ──────
--
-- Mirrors `admin_get_user_phone(uuid)` one-for-one: plpgsql, explicit admin
-- role check on the caller's auth.uid(), RAISE EXCEPTION 'forbidden' for
-- non-admins (same message string). OUT-parameter names (user_id,
-- phone_number) are disambiguated from the table columns with the alias `p.`
-- (same defensive pattern as the demographics functions).

CREATE OR REPLACE FUNCTION public.admin_get_user_phones(target_user_ids uuid[])
RETURNS TABLE (user_id uuid, phone_number text)
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
  SELECT p.id, p.phone_number
  FROM public.profiles p
  WHERE p.id = ANY(target_user_ids)
    AND p.deleted_at IS NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_user_phones(uuid[]) TO authenticated;
