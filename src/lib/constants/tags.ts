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

/**
 * Member-facing display order + labels for the 15 primary-eligible tags.
 *
 * Mirrors the seed in Migration 2 (sort_order 10..150 ascending). Used by
 * the events filter chip bar and any UI that needs to enumerate primary
 * tags without hitting the DB. Labels match `tags.label` exactly — change
 * here means change in Migration 2 too.
 *
 * Order matches the migration's ascending sort_order: "Drinks & Bars" first
 * (sort 10), "Workshops & Masterclasses" last (sort 150).
 */
export const PRIMARY_TAG_LABELS: ReadonlyArray<{ slug: string; label: string }> = [
  { slug: 'drinks-bars',             label: 'Drinks & Bars' },
  { slug: 'dining-supper-clubs',     label: 'Dining & Supper Clubs' },
  { slug: 'activities-social-games', label: 'Activities & Social Games' },
  { slug: 'nightlife-dancing',       label: 'Nightlife & Dancing' },
  { slug: 'live-music-gigs',         label: 'Live Music & Gigs' },
  { slug: 'theatre-comedy',          label: 'Theatre & Comedy' },
  { slug: 'galleries-museums',       label: 'Galleries & Museums' },
  { slug: 'festivals-seasonal',      label: 'Festivals & Seasonal' },
  { slug: 'sport-fitness',           label: 'Sport & Fitness' },
  { slug: 'outdoor-picnics',         label: 'Outdoor & Picnics' },
  { slug: 'weekends-travel',         label: 'Weekends & Travel' },
  { slug: 'themed-socials',          label: 'Themed Socials' },
  { slug: 'charity-volunteering',    label: 'Charity & Volunteering' },
  { slug: 'wellness-mindfulness',    label: 'Wellness & Mindfulness' },
  { slug: 'workshops-masterclasses', label: 'Workshops & Masterclasses' },
]

/**
 * Reverse mapping for the `?category=` → `?tag=` soft fallback on the
 * events listing page. Mirrors Migration 2's "Step 2: default fallback"
 * SQL — each legacy enum value points to the most representative primary
 * slug (the one a member who clicked the old chip would most plausibly
 * have meant).
 *
 * Lossy: an enum value that splits into multiple primary slugs (e.g.
 * `cultural` → theatre / galleries / festivals / charity) collapses to
 * one. That's accepted — the soft fallback exists to keep old shared
 * links from 404'ing, not to perfectly recover original intent. Users
 * landing via the redirect can re-pick a sharper tag from the new chip
 * row.
 *
 * Returns the canonical primary slug, or null if the input isn't a known
 * legacy enum value (caller treats null as "ignore the param").
 */
const LEGACY_CATEGORY_TO_PRIMARY_SLUG: Record<EventCategory, string> = {
  drinks:     'drinks-bars',
  dining:     'dining-supper-clubs',
  cultural:   'galleries-museums',     // see Migration 2 Step 2 fallback
  wellness:   'wellness-mindfulness',
  sport:      'sport-fitness',
  workshops:  'workshops-masterclasses',
  music:      'live-music-gigs',
  networking: 'workshops-masterclasses', // networking demoted to interest-only
  activity:   'activities-social-games',
}

const LEGACY_CATEGORIES = new Set<string>(Object.keys(LEGACY_CATEGORY_TO_PRIMARY_SLUG))

export function primarySlugForLegacyCategory(category: string): string | null {
  return LEGACY_CATEGORIES.has(category)
    ? LEGACY_CATEGORY_TO_PRIMARY_SLUG[category as EventCategory]
    : null
}
