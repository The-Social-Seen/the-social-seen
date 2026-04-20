-- Migration: add_profile_registration_fields
-- Adds phone_number, email_consent, email_verified, and status columns to
-- public.profiles to support:
--   P2-2 (this batch): phone + email consent collected at registration
--   P2-3: email verification flag (flipped to true after OTP verify)
--   P2-8: user status enum for admin ban/suspend actions
--
-- Also updates the handle_new_user() trigger to pull phone_number and
-- email_consent from auth user metadata (raw_user_meta_data).
--
-- Idempotent: uses IF NOT EXISTS, DO $$ ... EXCEPTION WHEN duplicate_object
-- for the enum, and CREATE OR REPLACE for the function.

-- ── New enum: user_status ─────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE user_status AS ENUM ('active', 'suspended', 'banned');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Add new columns to profiles ──────────────────────────────────────────────
-- Each column is added individually with IF NOT EXISTS so this migration can
-- be re-run without failing if partially applied.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS phone_number    text,
  ADD COLUMN IF NOT EXISTS email_consent   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS email_verified  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS status          user_status NOT NULL DEFAULT 'active';

-- Phone number format constraint — accepts international formats (10–15 digits,
-- optional leading +). Frontend enforces UK-specific formatting; this rejects
-- obvious garbage (letters, too-short, too-long).
DO $$ BEGIN
  ALTER TABLE public.profiles
    ADD CONSTRAINT chk_profiles_phone_number_format
    CHECK (phone_number IS NULL OR phone_number ~ '^\+?[0-9]{10,15}$');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Index on status for admin-facing filter queries (e.g. "show banned members").
-- Partial index excludes soft-deleted rows.
CREATE INDEX IF NOT EXISTS idx_profiles_status
  ON public.profiles (status)
  WHERE deleted_at IS NULL;

-- ── Update handle_new_user() trigger ─────────────────────────────────────────
-- Extends the existing trigger from migration 002 to read phone_number and
-- email_consent from raw_user_meta_data. full_name handling is unchanged.
-- CREATE OR REPLACE makes this fully idempotent.

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
    -- jsonb '->>' returns text; parse 'true' → true, anything else → false.
    -- Defaults to false when the key is absent (GDPR: opt-in only).
    COALESCE((NEW.raw_user_meta_data->>'email_consent')::boolean, false)
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Log but don't fail signup — profile can be created on first visit
  RAISE WARNING 'Failed to create profile for user %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

-- Trigger itself is unchanged from migration 002 — no need to recreate it here.
