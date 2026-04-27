import { createServerClient } from '@/lib/supabase/server'
import type {
  AgeRange,
  BookingWithEvent,
  Gender,
  PrimaryTag,
  Profile,
} from '@/types'

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
      .select('id, user_id, tag_id, created_at, tags(slug, label)')
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

  // Source labels from the joined `tags` row. The legacy
  // `user_interests.interest` text column was dropped by F2-schema —
  // tag_id is the sole carrier of interest semantics now. Consumer-facing
  // shape (`string[]`) is unchanged. user_interests.tag_id is NOT NULL FK
  // → tags, so the join always resolves to one row; the array fallback
  // is defensive for typegen.
  type InterestRow = {
    tags:
      | { slug: string; label: string }
      | { slug: string; label: string }[]
      | null
  }
  const interests = ((interestsResult.data ?? []) as InterestRow[])
    .map((row) => {
      const tag = Array.isArray(row.tags) ? row.tags[0] : row.tags
      return tag?.label ?? null
    })
    .filter((label): label is string => label !== null)

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
// ── Caller's own demographics (Phase 3 W1) ──────────────────────────────────

export interface MyDemographics {
  gender: Gender | null
  age_range: AgeRange | null
}

/**
 * Fetches the signed-in caller's own `gender` and `age_range` via the
 * `get_my_demographics()` SECURITY DEFINER function.
 *
 * Why an RPC: Phase 3 W1 narrowed the `authenticated` GRANT on
 * `public.profiles` so column-level SELECT on these fields raises `42501`.
 * The function bypasses that by reading inside a SECURITY DEFINER context
 * scoped to `auth.uid()` so it can only ever return the caller's own row.
 *
 * Returns `{ gender: null, age_range: null }` if the caller has no row or
 * has not set either field.
 */
export async function getMyDemographics(): Promise<MyDemographics> {
  const supabase = await createServerClient()
  const { data, error } = await supabase.rpc('get_my_demographics')
  if (error) {
    console.error('[getMyDemographics]', error.message)
    return { gender: null, age_range: null }
  }
  // RPC `RETURNS TABLE` resolves to an array of rows. auth.uid() filter
  // guarantees ≤1 row; empty array = no profile row (shouldn't happen
  // post-auth, but defensive).
  const row = Array.isArray(data) ? data[0] : null
  if (!row) return { gender: null, age_range: null }
  return {
    gender: (row as { gender: Gender | null }).gender ?? null,
    age_range: (row as { age_range: AgeRange | null }).age_range ?? null,
  }
}

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
 *
 * Nested event row includes `primary_tag: { slug, label }` from the
 * event_tags + tags join (F1a). The legacy `category` column was dropped
 * by F1b-schema and is no longer selected.
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
      event:events(
        id, slug, title, short_description, date_time, end_time, venue_name, venue_address, image_url, dress_code,
        event_tags!inner(is_primary, tags!inner(slug, label))
      )
    `,
    )
    .eq('user_id', userId)
    .is('deleted_at', null)
    .eq('event.event_tags.is_primary', true)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[getMyBookings]', error.message)
    return []
  }

  // Supabase returns FK joins as arrays for to-one relations; unwrap.
  // For each booking, pull primary_tag out of the nested event.event_tags
  // embed (F1a). The partial unique index guarantees exactly one primary,
  // so the inner array always has a single element.
  return (data ?? []).map((row) => {
    const eventRaw = (Array.isArray(row.event) ? row.event[0] : row.event) as
      | (Record<string, unknown> & {
          event_tags?:
            | Array<{
                is_primary: boolean
                tags: { slug: string; label: string } | { slug: string; label: string }[] | null
              }>
            | null
        })
      | null

    if (!eventRaw) {
      // Defensive: shouldn't happen given FK constraints, but keep the
      // shape stable for the consumer rather than crashing.
      return { ...row, event: null as unknown as BookingWithEvent['event'] }
    }

    const tagRow = (eventRaw.event_tags ?? []).find((t) => t.is_primary) ?? null
    const tagInner = tagRow
      ? Array.isArray(tagRow.tags)
        ? tagRow.tags[0]
        : tagRow.tags
      : null
    const primary_tag: PrimaryTag = tagInner
      ? { slug: tagInner.slug, label: tagInner.label }
      : { slug: '', label: '' } // unreachable in practice — see comment above

    const { event_tags: _et, ...eventFields } = eventRaw
    return {
      ...row,
      event: { ...eventFields, primary_tag } as BookingWithEvent['event'],
    }
  }) as BookingWithEvent[]
}
