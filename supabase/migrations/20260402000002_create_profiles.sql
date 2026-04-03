-- Migration: 002_create_profiles
-- Creates the profiles table (extends auth.users), trigger function,
-- RLS policies, and index on role.
-- Idempotent: CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE for functions/triggers.

CREATE TABLE IF NOT EXISTS public.profiles (
  id                  uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email               text NOT NULL,
  full_name           text NOT NULL DEFAULT '',
  avatar_url          text,
  job_title           text,
  company             text,
  industry            text,
  bio                 text,
  linkedin_url        text,
  role                user_role NOT NULL DEFAULT 'member',
  -- Amendment 1.2: onboarding fields
  onboarding_complete boolean NOT NULL DEFAULT false,
  referral_source     text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);

-- Index on role for admin checks
CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles (role);

-- Enable Row Level Security
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- ── RLS Policies ──────────────────────────────────────────────────────────────

-- Anyone can read profiles (public community)
DROP POLICY IF EXISTS "profiles_select" ON public.profiles;
CREATE POLICY "profiles_select"
  ON public.profiles FOR SELECT
  USING (true);

-- Users can update their own profile only
DROP POLICY IF EXISTS "profiles_update" ON public.profiles;
CREATE POLICY "profiles_update"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

-- INSERT is handled exclusively by the auth trigger below — no user-facing insert policy
-- Admins have no special bypass here; profile creation is automatic on signup

-- ── Trigger: auto-create profile on auth signup ───────────────────────────────

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', '')
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Log but don't fail signup — profile can be created on first visit
  RAISE WARNING 'Failed to create profile for user %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

-- Drop and recreate trigger to ensure idempotency
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ── updated_at auto-maintenance ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_profiles_updated_at ON public.profiles;
CREATE TRIGGER set_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
