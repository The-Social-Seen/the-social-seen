-- Migration: 009_create_user_interests
-- User interest tags collected during onboarding (Step 2 of registration).
-- UNIQUE(user_id, interest) prevents duplicate tags per user.

CREATE TABLE IF NOT EXISTS public.user_interests (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  interest   text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_user_interests_user_interest UNIQUE (user_id, interest)
);

CREATE INDEX IF NOT EXISTS idx_user_interests_user ON public.user_interests (user_id);

-- Enable Row Level Security
ALTER TABLE public.user_interests ENABLE ROW LEVEL SECURITY;

-- ── RLS Policies ──────────────────────────────────────────────────────────────

-- Users see their own interests; admins see all
DROP POLICY IF EXISTS "user_interests_select" ON public.user_interests;
CREATE POLICY "user_interests_select"
  ON public.user_interests FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Users manage their own interests
DROP POLICY IF EXISTS "user_interests_insert" ON public.user_interests;
CREATE POLICY "user_interests_insert"
  ON public.user_interests FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "user_interests_update" ON public.user_interests;
CREATE POLICY "user_interests_update"
  ON public.user_interests FOR UPDATE
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "user_interests_delete" ON public.user_interests;
CREATE POLICY "user_interests_delete"
  ON public.user_interests FOR DELETE
  USING (user_id = auth.uid());
