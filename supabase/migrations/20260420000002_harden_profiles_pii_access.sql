-- Migration: harden_profiles_pii_access
--
-- Follow-up to migration 20260420000001 addressing two blockers from the
-- P2-2 code review.
--
-- Blocker #1 (GDPR leak):
--   The profiles_select RLS policy uses `USING (true)` so anonymous callers
--   hitting the REST API with the anon key can read every member's
--   phone_number, email_consent, and email_verified. App-side embedded
--   relations like `profile:profiles(id, full_name, avatar_url)` are safe
--   (they only return the listed columns) but the direct REST endpoint
--   (e.g. `GET /rest/v1/profiles?select=phone_number`) is the attack vector.
--
--   Fix: column-level REVOKE from `anon`, keep column-level GRANT for
--   `authenticated`. PostgREST respects column-level privileges on top of
--   RLS, so anon callers simply cannot select these columns regardless of
--   the row-level policy.
--
--   RLS policies are deliberately not touched — app-side embedded queries
--   and public profile rendering (hosts, reviewers, attendee names) still
--   need SELECT at the row level. Column grants are the right tool here.
--
-- Blocker #2 (trigger silently skips profile creation):
--   The previous `handle_new_user()` cast `(...->>'email_consent')::boolean`
--   raises `invalid_text_representation` on any input that isn't literal
--   'true' / 'false'. The outer EXCEPTION WHEN OTHERS block swallows the
--   error and returns NEW, but the INSERT is skipped — the auth user exists
--   with no corresponding profile row, wedging signup.
--
--   Fix: replace the direct cast with a non-throwing CASE expression.
--   Strict opt-in semantics preserved: only literal 'true' / 't' / '1'
--   (case-insensitive) evaluate to true; everything else (including NULL,
--   empty string, 'yes', 1, garbage) is false.
--
-- Fully idempotent — REVOKE / GRANT are stable under re-runs, CREATE OR
-- REPLACE handles the function.

-- ── Blocker #1 — Column-level PII access controls ────────────────────────────

REVOKE SELECT (phone_number, email_consent, email_verified)
  ON public.profiles FROM anon;

GRANT SELECT (phone_number, email_consent, email_verified)
  ON public.profiles TO authenticated;

-- NOTE: `status` is intentionally not restricted — it's admin metadata
-- (active / suspended / banned), not personal data. If we later expose
-- profile browsing to authenticated non-admin users, revisit whether
-- phone_number and email_consent should be further restricted to the
-- row owner via a view or security-definer function.

-- ── Blocker #2 — Non-throwing email_consent cast in handle_new_user() ────────

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, phone_number, email_consent)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    -- NULLIF converts empty strings to NULL so the CHECK constraint isn't
    -- violated if a client somehow submits an empty phone string.
    NULLIF(NEW.raw_user_meta_data->>'phone_number', ''),
    -- Non-throwing cast: only literal 'true' / 't' / '1' = true.
    -- Anything else (NULL, empty string, 'yes', garbage) = false.
    -- Strict by design: GDPR consent defaults to opt-out.
    CASE
      WHEN LOWER(COALESCE(NEW.raw_user_meta_data->>'email_consent', '')) IN ('true', 't', '1')
        THEN true
      ELSE false
    END
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Log but don't fail signup — profile can be created on first visit
  RAISE WARNING 'Failed to create profile for user %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;
