-- Migration: 008_create_event_photos
-- Gallery photos per event (Supabase Storage paths or external URLs).
-- Amendment 1.2: includes sort_order column.

CREATE TABLE IF NOT EXISTS public.event_photos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  image_url   text NOT NULL,   -- Storage path or external URL
  caption     text,
  -- Amendment 1.2
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_photos_event      ON public.event_photos (event_id);
CREATE INDEX IF NOT EXISTS idx_event_photos_sort_order ON public.event_photos (event_id, sort_order);

-- Enable Row Level Security
ALTER TABLE public.event_photos ENABLE ROW LEVEL SECURITY;

-- ── RLS Policies ──────────────────────────────────────────────────────────────

-- Anyone can view event photos
DROP POLICY IF EXISTS "photos_select" ON public.event_photos;
CREATE POLICY "photos_select"
  ON public.event_photos FOR SELECT
  USING (true);

-- Admins only for insert
DROP POLICY IF EXISTS "photos_insert" ON public.event_photos;
CREATE POLICY "photos_insert"
  ON public.event_photos FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Admins only for update
DROP POLICY IF EXISTS "photos_update" ON public.event_photos;
CREATE POLICY "photos_update"
  ON public.event_photos FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Admins only for delete (photos can be hard-deleted — no user PII)
DROP POLICY IF EXISTS "photos_delete" ON public.event_photos;
CREATE POLICY "photos_delete"
  ON public.event_photos FOR DELETE
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );
