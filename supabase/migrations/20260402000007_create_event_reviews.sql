-- Migration: 007_create_event_reviews
-- Verified attendee reviews per event.
-- One review per user per event enforced by UNIQUE constraint.
-- CHECK constraint ensures rating is 1–5 (Amendment 1.7).

CREATE TABLE IF NOT EXISTS public.event_reviews (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  event_id     uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  rating       integer NOT NULL,
  review_text  text,
  is_visible   boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  -- Amendment 1.2
  updated_at   timestamptz NOT NULL DEFAULT now(),

  -- Amendment 1.7
  CONSTRAINT chk_reviews_rating CHECK (rating >= 1 AND rating <= 5),
  -- One review per user per event
  CONSTRAINT uq_event_reviews_user_event UNIQUE (user_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_event_reviews_event ON public.event_reviews (event_id);
CREATE INDEX IF NOT EXISTS idx_event_reviews_user  ON public.event_reviews (user_id);

-- Enable Row Level Security
ALTER TABLE public.event_reviews ENABLE ROW LEVEL SECURITY;

-- ── RLS Policies ──────────────────────────────────────────────────────────────

-- Anyone can read visible reviews
DROP POLICY IF EXISTS "reviews_select" ON public.event_reviews;
CREATE POLICY "reviews_select"
  ON public.event_reviews FOR SELECT
  USING (is_visible = true OR user_id = auth.uid());

-- Only verified attendees (confirmed booking) can submit a review
DROP POLICY IF EXISTS "reviews_insert" ON public.event_reviews;
CREATE POLICY "reviews_insert"
  ON public.event_reviews FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.bookings
      WHERE user_id = auth.uid()
        AND event_id = event_reviews.event_id
        AND status = 'confirmed'
        AND deleted_at IS NULL
    )
  );

-- Users can edit their own review; admins can toggle visibility
DROP POLICY IF EXISTS "reviews_update" ON public.event_reviews;
CREATE POLICY "reviews_update"
  ON public.event_reviews FOR UPDATE
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- No delete policy — reviews are permanent (moderated via is_visible)

-- ── updated_at trigger ───────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS set_event_reviews_updated_at ON public.event_reviews;
CREATE TRIGGER set_event_reviews_updated_at
  BEFORE UPDATE ON public.event_reviews
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
