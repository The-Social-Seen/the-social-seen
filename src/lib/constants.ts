// ── Site config ───────────────────────────────────────────────────────────────

export const SITE_CONFIG = {
  name:        'The Social Seen',
  tagline:     'Where Connections Become Stories',
  description: "Supper clubs. Gallery openings. Rooftop drinks. London's most interesting professionals, one unforgettable evening at a time.",
  url:         'https://thesocialseen.com',
  memberCount: '1,000+',
  eventsHosted: '200+',
  avgRating:   '4.9',
} as const

// ── Social ───────────────────────────────────────────────────────────────────
// Single source of truth for the brand's social URLs. Used by the footer,
// the gallery follow-CTA, the post-booking nudge, and the Organization
// JSON-LD `sameAs`. Add additional channels here as they go live.

export const SOCIAL_LINKS = {
  instagram: 'https://www.instagram.com/the_social_seen',
} as const

// ── Timezone ──────────────────────────────────────────────────────────────────

export const LONDON_TZ = 'Europe/London'

// ── Navigation ────────────────────────────────────────────────────────────────

// 2026-04-29: Gallery removed from nav until the upload UI ships.
// The `/gallery` route still exists as a soft "coming soon" page to
// preserve external bookmarks (no 404). Restore the entry below to
// both arrays when the upload flow is ready — see
// memory/project_event_gallery_hidden.md.
export const NAV_LINKS_PUBLIC = [
  { label: 'Events',      href: '/events' },
  { label: 'Contact',     href: '/contact' },
  { label: 'Collaborate', href: '/collaborate' },
  { label: 'Join',        href: '/join' },
  { label: 'Sign In',     href: '/login' },
] as const

export const NAV_LINKS_MEMBER = [
  { label: 'Events',      href: '/events' },
  { label: 'My Bookings', href: '/bookings' },
  { label: 'Contact',     href: '/contact' },
] as const

// ── Event categories ──────────────────────────────────────────────────────────
//
// Removed in F1b-schema: the legacy `CATEGORIES` array (9 enum values) had
// zero consumers after F1a's chip-bar migration. The 15-tag canonical
// taxonomy lives in src/lib/constants/tags.ts (PRIMARY_TAG_LABELS) and is
// the only enumeration the chip bar / admin picker / member-facing UI
// reference now.

// ── Interest options (registration Step 2 + profile edit) ────────────────────
//
// 2026-04-28: removed in favour of a runtime fetch from `public.tags`.
// Registration + profile-edit now read the 15 primary-eligible tags via
// `getRegistrationInterestTags()` (src/lib/supabase/queries/tags.ts) and
// save by canonical slug — no in-code mirror of the taxonomy. The 8
// interest-only tags (slugs prefixed `interest-`) are soft-retired from
// the user-facing flows; their seed rows in `tags` and any existing
// `user_interests` rows pointing at them remain intact.

// ── "How did you hear about us?" options (registration Step 1) ───────────────

export const HEAR_ABOUT_OPTIONS = [
  'A friend or colleague',
  'Instagram',
  'LinkedIn',
  'Attended an event',
  'Google search',
  'Other',
] as const

// ── Pricing ───────────────────────────────────────────────────────────────────

/** Prices are stored in pence. This constant makes intent explicit. */
export const PENCE_PER_POUND = 100

// ── Booking limits ────────────────────────────────────────────────────────────

/** Warn when an event has this many spots remaining */
export const LOW_SPOTS_THRESHOLD = 5

/** Events within this many hours show a "Tomorrow" reminder highlight */
export const REMINDER_HOURS_THRESHOLD = 48

// ── Admin ─────────────────────────────────────────────────────────────────────

export const ADMIN_EMAIL = 'mitesh50@hotmail.com'

// ── Supabase Storage buckets ──────────────────────────────────────────────────

export const STORAGE_BUCKETS = {
  eventImages: 'event-images',
  avatars:     'avatars',
} as const
