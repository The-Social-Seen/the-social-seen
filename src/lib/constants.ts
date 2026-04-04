import type { EventCategory } from '@/types'

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

// ── Timezone ──────────────────────────────────────────────────────────────────

export const LONDON_TZ = 'Europe/London'

// ── Navigation ────────────────────────────────────────────────────────────────

export const NAV_LINKS_PUBLIC = [
  { label: 'Events',   href: '/events' },
  { label: 'Gallery',  href: '/gallery' },
  { label: 'Join',     href: '/join' },
  { label: 'Sign In',  href: '/login' },
] as const

export const NAV_LINKS_MEMBER = [
  { label: 'Events',      href: '/events' },
  { label: 'Gallery',     href: '/gallery' },
  { label: 'My Bookings', href: '/bookings' },
] as const

// ── Event categories ──────────────────────────────────────────────────────────

export const CATEGORIES: Array<{ value: EventCategory; label: string }> = [
  { value: 'drinks',     label: 'Drinks' },
  { value: 'dining',     label: 'Dining' },
  { value: 'cultural',   label: 'Cultural' },
  { value: 'wellness',   label: 'Wellness' },
  { value: 'sport',      label: 'Sport' },
  { value: 'workshops',  label: 'Workshops' },
  { value: 'music',      label: 'Music' },
  { value: 'networking', label: 'Networking' },
]

// ── Interest options (used in registration Step 2) ────────────────────────────

export const INTEREST_OPTIONS = [
  { value: 'Wine & Cocktails',     label: 'Wine & Cocktails' },
  { value: 'Fine Dining',          label: 'Fine Dining' },
  { value: 'Art & Culture',        label: 'Art & Culture' },
  { value: 'Yoga & Wellness',      label: 'Yoga & Wellness' },
  { value: 'Running & Sport',      label: 'Running & Sport' },
  { value: 'Technology',           label: 'Technology' },
  { value: 'Entrepreneurship',     label: 'Entrepreneurship' },
  { value: 'Jazz & Music',         label: 'Jazz & Music' },
  { value: 'Networking',           label: 'Networking' },
  { value: 'Photography',          label: 'Photography' },
  { value: 'Travel',               label: 'Travel' },
  { value: 'Books & Literature',   label: 'Books & Literature' },
  { value: 'Sustainable Living',   label: 'Sustainable Living' },
  { value: 'Film & Cinema',        label: 'Film & Cinema' },
] as const

export type InterestValue = (typeof INTEREST_OPTIONS)[number]['value']

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
