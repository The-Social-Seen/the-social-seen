/**
 * Canonical taxonomy constants — Phase 3 Member Data Layer.
 *
 * Mirrors the seed in `supabase/migrations/20260504000001_create_tags_and_event_tags.sql`
 * and the slug→enum mapping in `_tag_slug_to_legacy_category()`.
 *
 * ⚠️ Lockstep — change here means change in three other places:
 *   1. Migration 2 tag seed
 *   2. Migration 2 `_tag_slug_to_legacy_category` function (slug→enum)
 *   3. Migration 2 sync trigger CASE expressions
 * Adding a new primary-eligible slug without updating the migration's
 * mapping function will cause Side B of the bidirectional trigger to
 * raise `'no legacy enum mapping for primary tag slug: <slug>'` on the
 * first event_tags INSERT/UPDATE that uses it.
 */
import type { EventCategory } from '@/types'

/**
 * The 15 primary-eligible tag slugs. Admins can choose ANY of these as an
 * event's primary tag. The 8 interest-only slugs (prefixed `interest-`) are
 * NOT in this set and the admin tag picker hides them from the primary
 * column.
 */
export const PRIMARY_ELIGIBLE_TAG_SLUGS = new Set<string>([
  'drinks-bars',
  'dining-supper-clubs',
  'activities-social-games',
  'nightlife-dancing',
  'live-music-gigs',
  'theatre-comedy',
  'galleries-museums',
  'festivals-seasonal',
  'sport-fitness',
  'outdoor-picnics',
  'weekends-travel',
  'themed-socials',
  'charity-volunteering',
  'wellness-mindfulness',
  'workshops-masterclasses',
])

/**
 * Static slug → legacy `event_category` enum mapping. Mirrors the
 * `_tag_slug_to_legacy_category()` SQL function shipped in Migration 2.
 *
 * Lossy 15→9 collapse — multiple primary slugs may map to the same enum
 * value (e.g. `theatre-comedy` and `galleries-museums` both → `'cultural'`).
 * That's fine: `events.category` is a "best-effort legacy display value"
 * during the dual-write window. Source of truth is `event_tags.is_primary`.
 *
 * Returns `null` for interest-only slugs and any unknown input. Callers
 * must treat null as a validation failure.
 */
const SLUG_TO_LEGACY_CATEGORY: Record<string, EventCategory> = {
  'drinks-bars':              'drinks',
  'dining-supper-clubs':      'dining',
  'activities-social-games':  'activity',
  'nightlife-dancing':        'drinks',     // closest existing enum
  'live-music-gigs':          'music',
  'theatre-comedy':           'cultural',
  'galleries-museums':        'cultural',
  'festivals-seasonal':       'cultural',
  'sport-fitness':            'sport',
  'outdoor-picnics':          'activity',
  'weekends-travel':          'activity',
  'themed-socials':           'drinks',     // themed parties are typically drinks-led
  'charity-volunteering':     'cultural',
  'wellness-mindfulness':     'wellness',
  'workshops-masterclasses':  'workshops',
}

export function legacyCategoryForSlug(slug: string): EventCategory | null {
  return SLUG_TO_LEGACY_CATEGORY[slug] ?? null
}
