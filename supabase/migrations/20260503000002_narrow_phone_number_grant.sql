-- Migration: narrow_phone_number_grant
--
-- Phase 3, Wave 1 (Migration 1b — bundled with 20260503000001 for code-
-- review economy). Closes the deferred backlog item in
-- `docs/PHASE-3-BACKLOG.md` § "Per-owner column grants on `phone_number`".
--
-- ── Why now ────────────────────────────────────────────────────────────────
-- The phone_number column was added in 20260420000001 and the first
-- hardening pass in 20260420000003_harden_profiles_pii_access_fix.sql:19-27
-- explicitly deferred per-owner column grants for it:
--
--   "Finer-grained per-row restriction for authenticated callers (e.g.
--    'only the owner can read their own phone_number') can be added later
--    via column-level grants tied to a security-definer function, if we
--    ever expose profile browsing."
--
-- Phase 3's member-data-layer work introduces the same SECURITY DEFINER
-- pattern for `gender` and `age_range` (see 20260503000001), so closing
-- the phone_number gap in the same PR is materially cheaper than two
-- sequential ones — same migration ceremony, same code-reviewer scrutiny,
-- same test harness.
--
-- ── Pattern source ─────────────────────────────────────────────────────────
-- Decision 7 — Option A in `docs/member-data-layer-spec.md` (CONFIRMED by
-- product owner). Mirrors the demographics function shape introduced by
-- 20260503000001 one-for-one, just on a single column.
--
-- ── What this migration does ───────────────────────────────────────────────
--   1. Revokes column-level SELECT on `phone_number` from `authenticated`.
--      Per the existing pattern in 20260423000003 (stripe_customer_id) and
--      20260426000001 (profile_nudge_email_sent_at).
--   2. Creates `get_my_phone()` SECURITY DEFINER for the caller's own row.
--   3. Creates `admin_get_user_phone(target_user_id uuid)` SECURITY DEFINER
--      for admin-only reads of any user's phone.
--
-- ── Anon-visibility decision ───────────────────────────────────────────────
-- Anon was already revoked from phone_number in 20260420000003. No change.
--
-- ── Consumer-side changes shipped in the same PR ───────────────────────────
-- Three self-read sites in `src/` that previously selected `phone_number`
-- via the user-scoped client are migrated to use `get_my_phone()` in the
-- same PR — see `src/app/(member)/profile/page.tsx`,
-- `src/app/(member)/profile/preferences-actions.ts`, and
-- `src/app/(member)/profile/privacy-actions.ts`.
--
-- Unaffected (verified during the audit at the head of
-- `prompts/phase-3-member-data-W1-backend.md`):
--   • `src/app/(member)/profile/actions.ts:69-82`  — UPDATE via own auth.
--     Column-level UPDATE permission is unchanged; SELECT narrowing does
--     not affect UPDATEs.
--   • `src/lib/sms/send.ts:80-108`                 — uses the admin client
--     (service_role), which bypasses column-level GRANTs entirely.
--   • `src/app/(auth)/actions.ts:115`              — INSERT path via
--     `auth.signUp()` → `handle_new_user()` trigger (SECURITY DEFINER).
--   • `src/app/(member)/profile/privacy-actions.ts:321` — UPDATE to NULL
--     during account deletion via the admin client.
--
-- ── Safety / blast radius ──────────────────────────────────────────────────
--   • Catalog-only operation. No table rewrite, no row scan.
--   • Functions are CREATE OR REPLACE — re-runnable cleanly.
--   • Column-level REVOKE removes the prior table-level GRANT for this
--     column only; the broader allow-list re-granted in 20260503000001
--     remains in effect for the other columns.
--
-- ── Rollback ───────────────────────────────────────────────────────────────
-- `GRANT SELECT (phone_number) ON public.profiles TO authenticated;` plus
-- `DROP FUNCTION public.get_my_phone(); DROP FUNCTION
-- public.admin_get_user_phone(uuid);`. Trivial — no data loss.

-- ── 1. Revoke column-level SELECT on phone_number from authenticated ───────

REVOKE SELECT (phone_number) ON public.profiles FROM authenticated;

-- ── 2. SECURITY DEFINER: get_my_phone() ────────────────────────────────────
--
-- Mirrors `get_my_demographics()` in shape: sql language, no auth
-- conditional (filtering by auth.uid() naturally returns zero rows for
-- callers without a session). NULL `auth.uid()` returns NULL, never an
-- error — same posture as the demographics fn.

CREATE OR REPLACE FUNCTION public.get_my_phone()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT phone_number
  FROM public.profiles
  WHERE id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION public.get_my_phone() TO authenticated;

-- ── 3. SECURITY DEFINER: admin_get_user_phone(target_user_id uuid) ─────────
--
-- Mirrors `admin_get_demographics(target_user_id)` in shape: plpgsql,
-- explicit admin role check using the caller's auth.uid(), RAISE
-- EXCEPTION on non-admin callers (the same 'forbidden' message string).

CREATE OR REPLACE FUNCTION public.admin_get_user_phone(target_user_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT phone_number INTO v_phone
  FROM public.profiles
  WHERE id = target_user_id;

  RETURN v_phone;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_user_phone(uuid) TO authenticated;
