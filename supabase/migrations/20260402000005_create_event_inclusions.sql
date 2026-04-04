-- Migration: 005_create_event_inclusions
-- Structured "What's Included" line items for events.
-- Amendment 1.2: includes icon column (Lucide icon name).

CREATE TABLE IF NOT EXISTS public.event_inclusions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  label       text NOT NULL,        -- e.g. "6 wine tastings"
  icon        text,                 -- optional Lucide icon name (Amendment 1.2)
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_inclusions_event ON public.event_inclusions (event_id);

-- Enable Row Level Security
ALTER TABLE public.event_inclusions ENABLE ROW LEVEL SECURITY;

-- ── RLS Policies ──────────────────────────────────────────────────────────────

-- Readable when the parent event is published (or user is admin)
DROP POLICY IF EXISTS "event_inclusions_select" ON public.event_inclusions;
CREATE POLICY "event_inclusions_select"
  ON public.event_inclusions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.events
      WHERE id = event_inclusions.event_id
        AND (is_published = true OR EXISTS (
          SELECT 1 FROM public.profiles
          WHERE id = auth.uid() AND role = 'admin'
        ))
    )
  );

-- Admins only for CUD
DROP POLICY IF EXISTS "event_inclusions_insert" ON public.event_inclusions;
CREATE POLICY "event_inclusions_insert"
  ON public.event_inclusions FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

DROP POLICY IF EXISTS "event_inclusions_update" ON public.event_inclusions;
CREATE POLICY "event_inclusions_update"
  ON public.event_inclusions FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

DROP POLICY IF EXISTS "event_inclusions_delete" ON public.event_inclusions;
CREATE POLICY "event_inclusions_delete"
  ON public.event_inclusions FOR DELETE
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );
