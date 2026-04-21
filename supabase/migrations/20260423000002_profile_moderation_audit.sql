-- Migration: profile_moderation_audit (P2-8a)
--
-- Adds audit columns to profiles for admin ban/suspend actions. Columns
-- are nullable so existing 'active' profiles keep zero audit footprint.
--
--   moderation_reason   — free-text rationale entered by the admin
--                         (e.g. "no-show x3", "payment dispute").
--                         Not shown to the member; internal only.
--
--   moderation_at       — timestamp of the status change. Distinct from
--                         updated_at which moves for any row change.
--
--   moderation_by       — admin profile id who performed the action. FK
--                         with ON DELETE SET NULL so deleting an admin
--                         doesn't cascade-hide a moderation record.
--
-- When a profile is re-activated (status → 'active') the audit columns
-- stay populated as a historical record — admins auditing later know
-- the profile was once actioned. A future "reinstate" column could
-- clear them, but a historical trail is more valuable at this scale.
--
-- ── Anon visibility — REVOKE from anon ─────────────────────────────────────
-- Per the P2-2 "secure by default" model, new profile columns default to
-- not-anon-visible unless explicitly needed. Moderation audit is PII-
-- adjacent (reveals that a member was actioned) — REVOKE from anon.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS moderation_reason text,
  ADD COLUMN IF NOT EXISTS moderation_at     timestamptz,
  ADD COLUMN IF NOT EXISTS moderation_by     uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.profiles.moderation_reason IS
  'Admin-entered rationale for ban/suspend. Internal only.';
COMMENT ON COLUMN public.profiles.moderation_at IS
  'Timestamp of the last status change (ban/suspend/reinstate).';
COMMENT ON COLUMN public.profiles.moderation_by IS
  'Admin profile id who performed the moderation action.';

-- Strip from BOTH anon and authenticated. Anon = obvious. Authenticated
-- = per code review (P2-8a, pre-push), per the Sprint 1 "secure by
-- default" model, the default GRANT to authenticated is broad (all
-- columns). Without an explicit REVOKE here, any logged-in member
-- could query `/rest/v1/profiles?select=moderation_reason,moderation_by`
-- and see who was banned, when, why, and by which admin. GDPR-adjacent
-- leak of moderator identity + reason text.
--
-- Admin reads go through the service_role admin client which bypasses
-- column grants — so REVOKE from authenticated doesn't break the admin
-- surface. No authenticated-user code path currently reads these columns.
REVOKE SELECT (moderation_reason) ON public.profiles FROM anon, authenticated;
REVOKE SELECT (moderation_at)     ON public.profiles FROM anon, authenticated;
REVOKE SELECT (moderation_by)     ON public.profiles FROM anon, authenticated;

-- ── Index for admin filtering ──────────────────────────────────────────────
-- Admin members page commonly filters "all banned" / "all suspended".
-- The existing status index (from migration 20260420000001) covers the
-- common case; add a partial index for moderation_at ordering so the
-- admin's "most recently actioned" sort is fast.
CREATE INDEX IF NOT EXISTS idx_profiles_moderation_at
  ON public.profiles (moderation_at DESC)
  WHERE moderation_at IS NOT NULL;
