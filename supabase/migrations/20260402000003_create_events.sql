-- Migration: 003_create_events
-- Creates the events table with all CHECK constraints (Amendment 1.7),
-- additional columns (Amendment 1.2), indexes, and RLS policies.

CREATE TABLE IF NOT EXISTS public.events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug              text UNIQUE NOT NULL,
  title             text NOT NULL,
  description       text NOT NULL,
  -- Amendment 1.2
  short_description text NOT NULL,
  date_time         timestamptz NOT NULL,
  end_time          timestamptz NOT NULL,
  venue_name        text NOT NULL,
  venue_address     text NOT NULL,
  category          event_category NOT NULL,
  price             integer NOT NULL DEFAULT 0,  -- stored in pence (£35 = 3500)
  capacity          integer,                     -- NULL = unlimited
  image_url         text,
  -- Amendment 1.2
  dress_code        text,
  is_published      boolean NOT NULL DEFAULT false,
  -- Amendment 1.2
  is_cancelled      boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  -- Amendment 1.2
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz,

  -- Amendment 1.7: CHECK constraints
  CONSTRAINT chk_events_price_non_negative   CHECK (price >= 0),
  CONSTRAINT chk_events_capacity_positive    CHECK (capacity > 0 OR capacity IS NULL),
  CONSTRAINT chk_events_end_after_start      CHECK (end_time > date_time)
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_events_slug        ON public.events (slug);
CREATE INDEX IF NOT EXISTS idx_events_category    ON public.events (category);
CREATE INDEX IF NOT EXISTS idx_events_date        ON public.events (date_time);
CREATE INDEX IF NOT EXISTS idx_events_published   ON public.events (is_published) WHERE deleted_at IS NULL;

-- Enable Row Level Security
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

-- ── RLS Policies ──────────────────────────────────────────────────────────────

-- Anyone can read published events; admins can read all (including drafts)
DROP POLICY IF EXISTS "events_select" ON public.events;
CREATE POLICY "events_select"
  ON public.events FOR SELECT
  USING (
    is_published = true
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Only admins can insert events
DROP POLICY IF EXISTS "events_insert" ON public.events;
CREATE POLICY "events_insert"
  ON public.events FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Only admins can update events
DROP POLICY IF EXISTS "events_update" ON public.events;
CREATE POLICY "events_update"
  ON public.events FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- No hard deletes — use soft delete (deleted_at) only
-- No DELETE policy intentionally

-- ── updated_at trigger ───────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS set_events_updated_at ON public.events;
CREATE TRIGGER set_events_updated_at
  BEFORE UPDATE ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
