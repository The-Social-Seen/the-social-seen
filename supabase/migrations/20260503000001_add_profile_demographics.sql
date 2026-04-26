-- Migration: add_profile_demographics
--
-- Phase 3, Wave 1 (Migration 1) of the Member Data Layer build.
-- Spec: docs/member-data-layer-spec.md (Decision 1, 2, 7, 8 + SQL fragments
-- "New enums (Migration 1)" / "Profile column additions (Migration 1)" /
-- "SECURITY DEFINER demographics functions (Migration 1)").
--
-- ── What this migration does ────────────────────────────────────────────────
--   1. Creates enums `public.gender` and `public.age_range`.
--   2. Adds nullable `profiles.gender` and `profiles.age_range` columns. No
--      default — NULL means "not yet asked or skipped without engaging."
--   3. Narrows the `authenticated` SELECT GRANT on `public.profiles` to a
--      column allow-list — gender + age_range are deliberately omitted, so
--      a logged-in member cannot read another member's demographics over
--      the REST API. This implements **Decision 7 — Option A** (CONFIRMED
--      by product owner). It also closes the broader "any authenticated
--      member can SELECT every profile column" hole by reusing the same
--      pattern as the `anon` allow-list (20260420000003 → 20260427000001).
--   4. Provides three SECURITY DEFINER helpers gated correctly:
--        • `get_my_demographics()`     — caller's own row
--        • `set_my_demographics(...)`  — caller's own row UPDATE
--        • `admin_get_demographics(target_user_id)` — admin-only read
--
-- ── Anon-visibility decision (per CLAUDE.md rule) ───────────────────────────
--   Anon: NOT exposed. The new columns are not added to the anon GRANT
--   (which has been a narrow allow-list since 20260427000001). REST queries
--   for these columns from an unauthenticated client return 401 / 42501.
--
-- ── Lawful basis (UK GDPR) ──────────────────────────────────────────────────
--   Legitimate interest in event-mix balancing — making sure no single
--   event drifts so far in one demographic direction that the room stops
--   feeling like a balanced cross-section of the community. These two
--   fields are visible only to the small core team running the platform;
--   they are not displayed on any public profile, not shared with other
--   members, not used for advertising, and never sold. Members can leave
--   them blank without affecting access to any event. The privacy-policy
--   copy update lands separately (operator action) before the collection
--   UI ships in W5.
--
-- ── Safety / blast radius ───────────────────────────────────────────────────
--   • Both columns are nullable with no default → no table rewrite, no
--     ACCESS EXCLUSIVE lock on existing rows.
--   • The REVOKE+GRANT pair runs inside an explicit transaction so no
--     concurrent session sees a window where SELECT on profiles is
--     entirely absent for the `authenticated` role.
--   • SECURITY DEFINER functions all set `search_path = public` to defend
--     against search-path injection (mirrors `handle_new_user` in
--     20260402000002).
--   • The `handle_new_user` trigger does NOT need updating — new accounts
--     start with NULL gender / age_range, which is the correct initial
--     state. The "Complete Your Profile" banner (W5) collects them
--     post-signup via `set_my_demographics()`.
--
-- ── Rollback ────────────────────────────────────────────────────────────────
--   Trivial — drop the three functions, drop the two columns, drop the
--   two enums, restore the prior GRANT (full SELECT on public.profiles to
--   authenticated). No data loss because no UI populates these columns
--   yet (W5 ships the banner separately).
--
-- ── Idempotency ─────────────────────────────────────────────────────────────
--   • CREATE TYPE wrapped in DO $$ ... EXCEPTION WHEN duplicate_object.
--   • ADD COLUMN IF NOT EXISTS.
--   • REVOKE / GRANT are naturally idempotent.
--   • CREATE OR REPLACE FUNCTION re-runs cleanly.

-- ── 1. Enums ────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE public.gender AS ENUM (
    'female',
    'male',
    'non_binary',
    'prefer_not_to_say'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.age_range AS ENUM (
    '18-24',
    '25-29',
    '30-34',
    '35-39',
    '40-44',
    '45-49',
    '50+'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── 2. Profile column additions ────────────────────────────────────────────

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS gender    public.gender,
  ADD COLUMN IF NOT EXISTS age_range public.age_range;

COMMENT ON COLUMN public.profiles.gender IS
  'Self-declared gender. Admin-only visibility via SECURITY DEFINER (`get_my_demographics`, `admin_get_demographics`); not in any public GRANT. NULL = not yet asked / never engaged with the form.';
COMMENT ON COLUMN public.profiles.age_range IS
  'Self-declared age band. Admin-only visibility via SECURITY DEFINER (`get_my_demographics`, `admin_get_demographics`); not in any public GRANT. NULL = not yet asked / never engaged with the form.';

-- ── 3. Narrow the `authenticated` SELECT GRANT (Decision 7 — Option A) ─────
--
-- Before this migration: `authenticated` had broad SELECT on public.profiles
-- (declared explicitly in 20260420000003 / 20260427000001). After:
-- `authenticated` may SELECT only from the column allow-list below. The new
-- demographics columns are deliberately omitted; reads must go through the
-- SECURITY DEFINER functions defined further down.
--
-- Already-revoked columns (excluded from the new allow-list, retain their
-- revoked status):
--   • `stripe_customer_id`           — revoked in 20260423000003
--   • `profile_nudge_email_sent_at`  — revoked in 20260426000001
--
-- Wrapped in a single transaction so concurrent sessions never observe
-- "SELECT on profiles entirely absent for the authenticated role."
BEGIN;

REVOKE SELECT ON public.profiles FROM authenticated;

GRANT SELECT (
  -- Identity / display
  id,
  email,
  full_name,
  avatar_url,
  job_title,
  company,
  industry,
  bio,
  linkedin_url,
  role,
  -- Onboarding / lifecycle
  onboarding_complete,
  referral_source,
  status,
  -- Contact + consent (phone_number is removed in the next migration —
  -- 20260503000002_narrow_phone_number_grant — once consumers migrate)
  phone_number,
  email_consent,
  email_verified,
  sms_consent,
  -- Moderation audit (read by admin UI; harmless to expose own row to
  -- self too)
  moderation_reason,
  moderation_at,
  moderation_by,
  -- Timestamps
  created_at,
  updated_at,
  deleted_at
  -- Deliberately OMITTED:
  --   gender, age_range          → reach via get_my_demographics() /
  --                                 admin_get_demographics()
  --   stripe_customer_id         → already revoked (20260423000003)
  --   profile_nudge_email_sent_at→ already revoked (20260426000001)
) ON public.profiles TO authenticated;

COMMIT;

-- ── 4. SECURITY DEFINER demographics functions ─────────────────────────────

-- Self-read — sql language because there's no auth check beyond
-- `auth.uid()` filtering. NULL `auth.uid()` (e.g. anon caller) returns
-- zero rows, not an error. Columns are qualified with the table alias
-- to avoid ambiguity with the RETURNS TABLE OUT parameter names.
CREATE OR REPLACE FUNCTION public.get_my_demographics()
RETURNS TABLE (gender public.gender, age_range public.age_range)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.gender, p.age_range
  FROM public.profiles p
  WHERE p.id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION public.get_my_demographics() TO authenticated;

-- Self-write — plpgsql so the UPDATE is encapsulated and `updated_at`
-- maintained explicitly (the BEFORE UPDATE trigger from
-- 20260402000002 also bumps it; explicit assignment here is defensive).
CREATE OR REPLACE FUNCTION public.set_my_demographics(
  p_gender    public.gender,
  p_age_range public.age_range
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles
  SET gender     = p_gender,
      age_range  = p_age_range,
      updated_at = now()
  WHERE id = auth.uid();
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_my_demographics(
  public.gender, public.age_range
) TO authenticated;

-- Admin-read — plpgsql so we can RAISE EXCEPTION on non-admin callers.
-- The check is server-side and uses the caller's auth.uid(), so the
-- target_user_id parameter cannot be used to spoof admin-ness.
CREATE OR REPLACE FUNCTION public.admin_get_demographics(target_user_id uuid)
RETURNS TABLE (gender public.gender, age_range public.age_range)
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
  SELECT p.gender, p.age_range
  FROM public.profiles p
  WHERE p.id = target_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_demographics(uuid) TO authenticated;
