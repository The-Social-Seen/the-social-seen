-- Migration: 004_create_event_hosts
-- Join table linking events to their host profiles.
-- Unique constraint prevents duplicate host entries per event.

CREATE TABLE IF NOT EXISTS public.event_hosts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  profile_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role_label  text NOT NULL DEFAULT 'Host',  -- e.g. "Host", "Co-Host"
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_event_hosts_event_profile UNIQUE (event_id, profile_id)
);

CREATE INDEX IF NOT EXISTS idx_event_hosts_event   ON public.event_hosts (event_id);
CREATE INDEX IF NOT EXISTS idx_event_hosts_profile ON public.event_hosts (profile_id);

-- Enable Row Level Security
ALTER TABLE public.event_hosts ENABLE ROW LEVEL SECURITY;

-- ── RLS Policies ──────────────────────────────────────────────────────────────

-- Readable by anyone (inherits event visibility — public events show hosts)
DROP POLICY IF EXISTS "event_hosts_select" ON public.event_hosts;
CREATE POLICY "event_hosts_select"
  ON public.event_hosts FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.events
      WHERE id = event_hosts.event_id
        AND (is_published = true OR EXISTS (
          SELECT 1 FROM public.profiles
          WHERE id = auth.uid() AND role = 'admin'
        ))
    )
  );

-- Admins only for insert/update/delete
DROP POLICY IF EXISTS "event_hosts_insert" ON public.event_hosts;
CREATE POLICY "event_hosts_insert"
  ON public.event_hosts FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

DROP POLICY IF EXISTS "event_hosts_update" ON public.event_hosts;
CREATE POLICY "event_hosts_update"
  ON public.event_hosts FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

DROP POLICY IF EXISTS "event_hosts_delete" ON public.event_hosts;
CREATE POLICY "event_hosts_delete"
  ON public.event_hosts FOR DELETE
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );
