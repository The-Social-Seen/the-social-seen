-- Migration: 006_create_bookings
-- User ↔ event bookings table with race-condition-safe partial unique index,
-- soft deletes, CHECK constraints (Amendment 1.7), and RLS policies.

CREATE TABLE IF NOT EXISTS public.bookings (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- RESTRICT prevents deleting events that have bookings — use soft delete on events
  event_id            uuid NOT NULL REFERENCES public.events(id) ON DELETE RESTRICT,
  status              booking_status NOT NULL DEFAULT 'confirmed',
  waitlist_position   integer,
  -- Amendment 1.2: price snapshot at time of booking
  price_at_booking    integer NOT NULL DEFAULT 0,
  booked_at           timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  -- Amendment 1.2
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz,

  -- Amendment 1.7: waitlist_position must be positive when set
  CONSTRAINT chk_bookings_waitlist_position CHECK (waitlist_position > 0 OR waitlist_position IS NULL)
);

-- Standard indexes for JOIN and filter performance
CREATE INDEX IF NOT EXISTS idx_bookings_event  ON public.bookings (event_id);
CREATE INDEX IF NOT EXISTS idx_bookings_user   ON public.bookings (user_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON public.bookings (status);

-- Amendment 1.6: partial unique index — one active booking per user per event
-- Excludes cancelled bookings and soft-deleted rows
CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_active
  ON public.bookings (user_id, event_id)
  WHERE status != 'cancelled' AND deleted_at IS NULL;

-- Enable Row Level Security
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

-- ── RLS Policies ──────────────────────────────────────────────────────────────

-- Users see their own bookings; admins see all
DROP POLICY IF EXISTS "bookings_select" ON public.bookings;
CREATE POLICY "bookings_select"
  ON public.bookings FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Users can create bookings for themselves only
DROP POLICY IF EXISTS "bookings_insert" ON public.bookings;
CREATE POLICY "bookings_insert"
  ON public.bookings FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Users can update their own booking (e.g. cancel); admins can update any
DROP POLICY IF EXISTS "bookings_update" ON public.bookings;
CREATE POLICY "bookings_update"
  ON public.bookings FOR UPDATE
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- No hard deletes — cancelled bookings retain audit trail via status + deleted_at

-- ── updated_at trigger ───────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS set_bookings_updated_at ON public.bookings;
CREATE TRIGGER set_bookings_updated_at
  BEFORE UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
