import { createServerClient } from '@/lib/supabase/server'
import type { Tag } from '@/types'

/**
 * Fetch all active tags ordered by `sort_order`.
 *
 * Used by the admin event tag picker to populate the chip grid. Returns
 * the full 23-row canonical taxonomy (15 primary-eligible + 8 interest-only
 * — caller filters by `PRIMARY_ELIGIBLE_TAG_SLUGS` for the primary column).
 *
 * Public RLS policy `tags_select_active` allows anon + authenticated to
 * read active rows, so this works with any caller context. We use the
 * server client to keep the data fetch on the server side.
 */
export async function getActiveTags(): Promise<Tag[]> {
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('tags')
    .select('id, slug, label, parent_id, sort_order, is_active, created_at, updated_at')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })

  if (error) {
    console.error('[getActiveTags]', error.message)
    return []
  }
  return (data ?? []) as Tag[]
}

/**
 * Tags shown to users in registration + profile-edit interest selectors.
 * Primary-eligible only (event-tagging tags); excludes the interest-only
 * taxonomy (slugs prefixed with 'interest-'). Same is_active filter and
 * sort_order as getActiveTags.
 *
 * 2026-04-28: introduced to source registration interests from the tags
 * table directly, replacing the hardcoded INTEREST_OPTIONS constant in
 * src/lib/constants.ts.
 */
export async function getRegistrationInterestTags(): Promise<Tag[]> {
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('tags')
    .select('id, slug, label, parent_id, sort_order, is_active, created_at, updated_at')
    .eq('is_active', true)
    .not('slug', 'like', 'interest-%')
    .order('sort_order', { ascending: true })

  if (error) {
    console.error('[getRegistrationInterestTags]', error.message)
    return []
  }
  return (data ?? []) as Tag[]
}

export interface EventTagSelection {
  /** Primary tag slug (exactly one per event after Migration 2). Null for legacy events that haven't been re-saved through the new picker. */
  primary: string | null
  /** Secondary tag slugs (0..N), excludes the primary. */
  secondaries: string[]
}

/**
 * Fetch the primary slug + secondary slugs for an event. Used to
 * pre-populate the admin tag picker on the edit screen.
 */
export async function getEventTagsForEvent(
  eventId: string,
): Promise<EventTagSelection> {
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('event_tags')
    .select('is_primary, tag:tags(slug)')
    .eq('event_id', eventId)

  if (error) {
    console.error('[getEventTagsForEvent]', error.message)
    return { primary: null, secondaries: [] }
  }

  let primary: string | null = null
  const secondaries: string[] = []
  for (const row of data ?? []) {
    // Supabase nests to-one joins as either { slug } or [{ slug }]
    const tag = Array.isArray(row.tag) ? row.tag[0] : row.tag
    const slug = (tag as { slug?: string } | null)?.slug
    if (!slug) continue
    if (row.is_primary) {
      primary = slug
    } else {
      secondaries.push(slug)
    }
  }
  return { primary, secondaries }
}
