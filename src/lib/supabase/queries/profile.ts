import { createServerClient } from '@/lib/supabase/server'
import type { Profile, UserInterest, BookingWithEvent } from '@/types'

// ── Profile + interests ─────────────────────────────────────────────────────

/**
 * Fetch a user's profile with their interest tags.
 * Returns null if the profile doesn't exist.
 *
 * `phone_number` is intentionally NOT in the SELECT list — Phase 3 W1
 * narrows the `authenticated` GRANT so direct SELECT against that column
 * fails with `42501`. Callers needing the caller's own phone fetch it
 * via `getMyPhone()` (SECURITY DEFINER `get_my_phone()` RPC) and merge
 * it into the result.
 */
export async function getProfile(
  userId: string,
): Promise<(Profile & { interests: string[] }) | null> {
  const supabase = await createServerClient()

  const [profileResult, interestsResult] = await Promise.all([
    supabase
      .from('profiles')
      .select(
        'id, email, full_name, avatar_url, job_title, company, industry, bio, linkedin_url, role, onboarding_complete, referral_source, created_at, updated_at, deleted_at',
      )
      .eq('id', userId)
      .is('deleted_at', null)
      .single(),
    supabase
      .from('user_interests')
      .select('id, user_id, interest, created_at')
      .eq('user_id', userId),
  ])

  if (profileResult.error || !profileResult.data) {
    if (profileResult.error && profileResult.error.code !== 'PGRST116') {
      console.error('[getProfile]', profileResult.error.message)
    }
    return null
  }

  if (interestsResult.error) {
    console.error('[getProfile:interests]', interestsResult.error.message)
  }

  const interests = (interestsResult.data ?? []).map(
    (row: UserInterest) => row.interest,
  )

  return {
    ...(profileResult.data as Profile),
    interests,
  }
}

// ── Caller's own phone number ───────────────────────────────────────────────

/**
 * Fetches the signed-in caller's own `phone_number` via the
 * `get_my_phone()` SECURITY DEFINER function. Returns `null` if the
 * caller has no row or has not set a phone.
 *
 * Why an RPC and not a SELECT: Phase 3 W1 narrowed the `authenticated`
 * GRANT on `public.profiles` so column-level SELECT on `phone_number`
 * raises `42501`. The function bypasses that by reading inside a
 * SECURITY DEFINER context, scoped to `auth.uid()` so it can only ever
 * return the caller's own number.
 */
export async function getMyPhone(): Promise<string | null> {
  const supabase = await createServerClient()
  const { data, error } = await supabase.rpc('get_my_phone')
  if (error) {
    console.error('[getMyPhone]', error.message)
    return null
  }
  // RPC for `RETURNS text` returns the scalar directly.
  return (data as string | null) ?? null
}

// ── User bookings ───────────────────────────────────────────────────────────

/**
 * Fetch all bookings for a user with nested event data.
 * Returns confirmed, waitlisted, and past — frontend splits by date/status.
 */
export async function getMyBookings(
  userId: string,
): Promise<BookingWithEvent[]> {
  const supabase = await createServerClient()

  const { data, error } = await supabase
    .from('bookings')
    .select(
      `
      id, user_id, event_id, status, waitlist_position, price_at_booking, booked_at, created_at, updated_at, deleted_at,
      event:events(id, slug, title, short_description, date_time, end_time, venue_name, venue_address, image_url, category, dress_code)
    `,
    )
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[getMyBookings]', error.message)
    return []
  }

  // Supabase returns FK joins as arrays for to-one relations; unwrap
  return (data ?? []).map((row) => ({
    ...row,
    event: Array.isArray(row.event) ? row.event[0] : row.event,
  })) as BookingWithEvent[]
}
