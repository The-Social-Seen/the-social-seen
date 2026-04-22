import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Chainable query builder mock ─────────────────────────────────────────────
// Each method returns `this` so `.from().select().eq().order()` etc. all chain.
// Call `mockResolve(data)` or `mockReject(error)` to set what the chain returns.

interface MockQueryBuilder {
  select: ReturnType<typeof vi.fn>
  eq: ReturnType<typeof vi.fn>
  neq: ReturnType<typeof vi.fn>
  is: ReturnType<typeof vi.fn>
  not: ReturnType<typeof vi.fn>
  in: ReturnType<typeof vi.fn>
  lt: ReturnType<typeof vi.fn>
  order: ReturnType<typeof vi.fn>
  limit: ReturnType<typeof vi.fn>
  single: ReturnType<typeof vi.fn>
  maybeSingle: ReturnType<typeof vi.fn>
  then: (resolve: (v: unknown) => void, reject: (v: unknown) => void) => Promise<unknown>
  mockResolve: (data: unknown, count?: number | null) => void
  mockReject: (message: string, code?: string) => void
}

function createQueryBuilder(): MockQueryBuilder {
  let _result: { data: unknown; error: unknown; count?: number | null } = {
    data: null,
    error: null,
    count: null,
  }

  const builder = {} as MockQueryBuilder
  const chainMethods: (keyof MockQueryBuilder)[] = [
    'select', 'eq', 'neq', 'is', 'not', 'in', 'lt', 'order', 'limit', 'single', 'maybeSingle',
  ]

  for (const method of chainMethods) {
    (builder[method] as ReturnType<typeof vi.fn>) = vi.fn(() => builder)
  }

  // Make the builder thenable so `await supabase.from(...).select(...)` resolves
  builder.then = (resolve: (v: unknown) => void, reject: (v: unknown) => void) => {
    return Promise.resolve(_result).then(resolve, reject)
  }

  // Helpers to control what the chain resolves to
  builder.mockResolve = (data: unknown, count?: number | null) => {
    _result = { data, error: null, count: count ?? null }
  }
  builder.mockReject = (message: string, code?: string) => {
    _result = { data: null, error: { message, code: code ?? 'ERROR' }, count: null }
  }

  return builder
}

// ── Supabase client mock ─────────────────────────────────────────────────────

let fromBuilders: Record<string, MockQueryBuilder>
let mockGetUser: ReturnType<typeof vi.fn>

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(() => {
    return Promise.resolve({
      from: vi.fn((table: string) => {
        if (!fromBuilders[table]) {
          fromBuilders[table] = createQueryBuilder()
        }
        return fromBuilders[table]
      }),
      auth: {
        getUser: mockGetUser,
      },
    })
  }),
}))

// ── Import after mocks ──────────────────────────────────────────────────────

import {
  getPastEvents,
  getPublishedEvents,
  getEventBySlug,
  getEventReviews,
  getEventPhotos,
  getRelatedEvents,
  getUserBookingForEvent,
} from '../events'

// ── Fixtures ────────────────────────────────────────────────────────────────

const mockEventWithStats = {
  id: 'evt-1',
  slug: 'wine-and-wisdom',
  title: 'Wine & Wisdom',
  description: 'A great evening',
  short_description: 'Wine tasting',
  date_time: '2026-05-10T19:00:00Z',
  end_time: '2026-05-10T22:00:00Z',
  venue_name: 'The Cellar',
  venue_address: '123 London Rd',
  category: 'dining' as const,
  price: 3500,
  capacity: 30,
  image_url: '/img/wine.jpg',
  dress_code: 'Smart Casual',
  is_published: true,
  is_cancelled: false,
  created_at: '2026-04-01T00:00:00Z',
  updated_at: '2026-04-01T00:00:00Z',
  deleted_at: null,
  confirmed_count: 12,
  avg_rating: 4.5,
  review_count: 8,
  spots_left: 18,
}

const mockEventRow = {
  id: 'evt-1',
  slug: 'wine-and-wisdom',
  title: 'Wine & Wisdom',
  description: 'A great evening',
  short_description: 'Wine tasting',
  date_time: '2026-05-10T19:00:00Z',
  end_time: '2026-05-10T22:00:00Z',
  venue_name: 'The Cellar',
  venue_address: '123 London Rd',
  category: 'dining',
  price: 3500,
  capacity: 30,
  image_url: '/img/wine.jpg',
  dress_code: 'Smart Casual',
  is_published: true,
  is_cancelled: false,
  created_at: '2026-04-01T00:00:00Z',
  updated_at: '2026-04-01T00:00:00Z',
  deleted_at: null,
  event_hosts: [
    {
      id: 'host-1',
      event_id: 'evt-1',
      profile_id: 'prof-1',
      role_label: 'Host',
      sort_order: 1,
      created_at: '2026-04-01T00:00:00Z',
      profile: { id: 'prof-1', full_name: 'Jane Doe', avatar_url: null, bio: 'Hi', job_title: 'Sommelier', company: 'Wine Co' },
    },
    {
      id: 'host-2',
      event_id: 'evt-1',
      profile_id: 'prof-2',
      role_label: 'Co-host',
      sort_order: 0,
      created_at: '2026-04-01T00:00:00Z',
      profile: { id: 'prof-2', full_name: 'John Smith', avatar_url: '/img/john.jpg', bio: null, job_title: null, company: null },
    },
  ],
  event_inclusions: [
    { id: 'inc-1', event_id: 'evt-1', label: 'Welcome drink', icon: 'wine', sort_order: 1, created_at: '2026-04-01T00:00:00Z' },
    { id: 'inc-2', event_id: 'evt-1', label: 'Cheese board', icon: 'utensils', sort_order: 0, created_at: '2026-04-01T00:00:00Z' },
  ],
}

const mockReview = {
  id: 'rev-1',
  user_id: 'user-1',
  event_id: 'evt-1',
  rating: 5,
  review_text: 'Excellent event!',
  is_visible: true,
  created_at: '2026-05-11T10:00:00Z',
  updated_at: '2026-05-11T10:00:00Z',
  author: [{ id: 'user-1', full_name: 'Alice', avatar_url: '/img/alice.jpg' }],
}

const mockPhoto = {
  id: 'photo-1',
  event_id: 'evt-1',
  image_url: '/img/gallery-1.jpg',
  caption: 'Great vibes',
  sort_order: 0,
  created_at: '2026-05-11T10:00:00Z',
}

const mockBooking = {
  id: 'book-1',
  user_id: 'user-1',
  event_id: 'evt-1',
  status: 'confirmed',
  waitlist_position: null,
  price_at_booking: 3500,
  booked_at: '2026-05-01T12:00:00Z',
  created_at: '2026-05-01T12:00:00Z',
  updated_at: '2026-05-01T12:00:00Z',
  deleted_at: null,
}

// ── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.restoreAllMocks()
  fromBuilders = {}
  mockGetUser = vi.fn(() => Promise.resolve({ data: { user: null } }))
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

// ── Tests ───────────────────────────────────────────────────────────────────

describe('getPublishedEvents', () => {
  it('returns events from event_with_stats view', async () => {
    const builder = createQueryBuilder()
    builder.mockResolve([mockEventWithStats])
    fromBuilders['event_with_stats'] = builder

    const result = await getPublishedEvents()

    expect(result).toHaveLength(1)
    expect(result[0].slug).toBe('wine-and-wisdom')
    expect(result[0].confirmed_count).toBe(12)
    expect(result[0].spots_left).toBe(18)
  })

  it('returns empty array on error', async () => {
    const builder = createQueryBuilder()
    builder.mockReject('connection refused')
    fromBuilders['event_with_stats'] = builder

    const result = await getPublishedEvents()

    expect(result).toEqual([])
    expect(console.error).toHaveBeenCalledWith(
      '[getPublishedEvents]',
      'connection refused'
    )
  })

  it('returns empty array when data is null', async () => {
    const builder = createQueryBuilder()
    builder.mockResolve(null)
    fromBuilders['event_with_stats'] = builder

    const result = await getPublishedEvents()

    expect(result).toEqual([])
  })
})

describe('getEventBySlug', () => {
  it('returns full EventDetail with hosts sorted by sort_order', async () => {
    // events builder returns the event row
    const eventsBuilder = createQueryBuilder()
    eventsBuilder.mockResolve(mockEventRow)
    fromBuilders['events'] = eventsBuilder

    // bookings builder returns count
    const bookingsBuilder = createQueryBuilder()
    bookingsBuilder.mockResolve(null, 5)
    fromBuilders['bookings'] = bookingsBuilder

    // reviews builder returns ratings
    const reviewsBuilder = createQueryBuilder()
    reviewsBuilder.mockResolve([{ rating: 4 }, { rating: 5 }])
    fromBuilders['event_reviews'] = reviewsBuilder

    const result = await getEventBySlug('wine-and-wisdom')

    expect(result).not.toBeNull()
    expect(result!.slug).toBe('wine-and-wisdom')
    // Hosts should be sorted: sort_order 0 (John) before 1 (Jane)
    expect(result!.hosts[0].profile.full_name).toBe('John Smith')
    expect(result!.hosts[1].profile.full_name).toBe('Jane Doe')
    // Inclusions sorted: sort_order 0 (Cheese) before 1 (Welcome)
    expect(result!.inclusions[0].label).toBe('Cheese board')
    expect(result!.inclusions[1].label).toBe('Welcome drink')
    // Stats
    expect(result!.confirmed_count).toBe(5)
    expect(result!.review_count).toBe(2)
    expect(result!.avg_rating).toBe(4.5)
    expect(result!.spots_left).toBe(25) // capacity 30 - 5 confirmed
  })

  it('returns null spots_left when capacity is null (unlimited)', async () => {
    const unlimitedEvent = { ...mockEventRow, capacity: null }
    const eventsBuilder = createQueryBuilder()
    eventsBuilder.mockResolve(unlimitedEvent)
    fromBuilders['events'] = eventsBuilder

    const bookingsBuilder = createQueryBuilder()
    bookingsBuilder.mockResolve(null, 50)
    fromBuilders['bookings'] = bookingsBuilder

    const reviewsBuilder = createQueryBuilder()
    reviewsBuilder.mockResolve([])
    fromBuilders['event_reviews'] = reviewsBuilder

    const result = await getEventBySlug('wine-and-wisdom')

    expect(result).not.toBeNull()
    expect(result!.spots_left).toBeNull()
  })

  it('returns spots_left as 0 when over capacity (not negative)', async () => {
    const eventsBuilder = createQueryBuilder()
    eventsBuilder.mockResolve({ ...mockEventRow, capacity: 10 })
    fromBuilders['events'] = eventsBuilder

    const bookingsBuilder = createQueryBuilder()
    bookingsBuilder.mockResolve(null, 15) // 15 confirmed, capacity 10
    fromBuilders['bookings'] = bookingsBuilder

    const reviewsBuilder = createQueryBuilder()
    reviewsBuilder.mockResolve([])
    fromBuilders['event_reviews'] = reviewsBuilder

    const result = await getEventBySlug('wine-and-wisdom')

    expect(result!.spots_left).toBe(0) // never negative
  })

  it('returns null for non-existent slug (PGRST116)', async () => {
    const eventsBuilder = createQueryBuilder()
    eventsBuilder.mockReject('JSON object requested, multiple (or no) rows returned', 'PGRST116')
    fromBuilders['events'] = eventsBuilder

    const result = await getEventBySlug('does-not-exist')

    expect(result).toBeNull()
    // PGRST116 should NOT trigger console.error (expected case)
    expect(console.error).not.toHaveBeenCalled()
  })

  it('logs unexpected errors and returns null', async () => {
    const eventsBuilder = createQueryBuilder()
    eventsBuilder.mockReject('connection timeout', 'PGRST500')
    fromBuilders['events'] = eventsBuilder

    const result = await getEventBySlug('wine-and-wisdom')

    expect(result).toBeNull()
    expect(console.error).toHaveBeenCalledWith(
      '[getEventBySlug]',
      'connection timeout'
    )
  })

  it('computes avg_rating as 0 when there are no reviews', async () => {
    const eventsBuilder = createQueryBuilder()
    eventsBuilder.mockResolve(mockEventRow)
    fromBuilders['events'] = eventsBuilder

    const bookingsBuilder = createQueryBuilder()
    bookingsBuilder.mockResolve(null, 0)
    fromBuilders['bookings'] = bookingsBuilder

    const reviewsBuilder = createQueryBuilder()
    reviewsBuilder.mockResolve([])
    fromBuilders['event_reviews'] = reviewsBuilder

    const result = await getEventBySlug('wine-and-wisdom')

    expect(result!.avg_rating).toBe(0)
    expect(result!.review_count).toBe(0)
  })

  it('handles null event_hosts and event_inclusions gracefully', async () => {
    const eventWithNulls = {
      ...mockEventRow,
      event_hosts: null,
      event_inclusions: null,
    }
    const eventsBuilder = createQueryBuilder()
    eventsBuilder.mockResolve(eventWithNulls)
    fromBuilders['events'] = eventsBuilder

    const bookingsBuilder = createQueryBuilder()
    bookingsBuilder.mockResolve(null, 0)
    fromBuilders['bookings'] = bookingsBuilder

    const reviewsBuilder = createQueryBuilder()
    reviewsBuilder.mockResolve([])
    fromBuilders['event_reviews'] = reviewsBuilder

    const result = await getEventBySlug('wine-and-wisdom')

    expect(result!.hosts).toEqual([])
    expect(result!.inclusions).toEqual([])
  })
})

describe('getEventReviews', () => {
  it('returns reviews with unwrapped author from array', async () => {
    const builder = createQueryBuilder()
    builder.mockResolve([mockReview])
    fromBuilders['event_reviews'] = builder

    const result = await getEventReviews('evt-1')

    expect(result).toHaveLength(1)
    expect(result[0].rating).toBe(5)
    // Author should be unwrapped from array to single object
    expect(result[0].author.full_name).toBe('Alice')
  })

  it('handles author already being a single object (not array)', async () => {
    const reviewWithObjectAuthor = {
      ...mockReview,
      author: { id: 'user-1', full_name: 'Alice', avatar_url: '/img/alice.jpg' },
    }
    const builder = createQueryBuilder()
    builder.mockResolve([reviewWithObjectAuthor])
    fromBuilders['event_reviews'] = builder

    const result = await getEventReviews('evt-1')

    expect(result[0].author.full_name).toBe('Alice')
  })

  it('returns empty array on error', async () => {
    const builder = createQueryBuilder()
    builder.mockReject('query failed')
    fromBuilders['event_reviews'] = builder

    const result = await getEventReviews('evt-1')

    expect(result).toEqual([])
  })

  it('returns empty array when no reviews exist', async () => {
    const builder = createQueryBuilder()
    builder.mockResolve([])
    fromBuilders['event_reviews'] = builder

    const result = await getEventReviews('evt-1')

    expect(result).toEqual([])
  })
})

describe('getEventPhotos', () => {
  it('returns photos for an event', async () => {
    const builder = createQueryBuilder()
    builder.mockResolve([mockPhoto])
    fromBuilders['event_photos'] = builder

    const result = await getEventPhotos('evt-1')

    expect(result).toHaveLength(1)
    expect(result[0].image_url).toBe('/img/gallery-1.jpg')
    expect(result[0].caption).toBe('Great vibes')
  })

  it('returns empty array on error', async () => {
    const builder = createQueryBuilder()
    builder.mockReject('storage error')
    fromBuilders['event_photos'] = builder

    const result = await getEventPhotos('evt-1')

    expect(result).toEqual([])
  })

  it('returns empty array when no photos exist', async () => {
    const builder = createQueryBuilder()
    builder.mockResolve([])
    fromBuilders['event_photos'] = builder

    const result = await getEventPhotos('evt-1')

    expect(result).toEqual([])
  })
})

describe('getRelatedEvents', () => {
  it('returns related events in the same category', async () => {
    const builder = createQueryBuilder()
    builder.mockResolve([mockEventWithStats])
    fromBuilders['event_with_stats'] = builder

    const result = await getRelatedEvents('dining', 'evt-other')

    expect(result).toHaveLength(1)
    expect(result[0].category).toBe('dining')
  })

  it('returns empty array on error', async () => {
    const builder = createQueryBuilder()
    builder.mockReject('timeout')
    fromBuilders['event_with_stats'] = builder

    const result = await getRelatedEvents('dining', 'evt-1')

    expect(result).toEqual([])
    expect(console.error).toHaveBeenCalledWith('[getRelatedEvents]', 'timeout')
  })

  it('returns empty array when no related events exist', async () => {
    const builder = createQueryBuilder()
    builder.mockResolve([])
    fromBuilders['event_with_stats'] = builder

    const result = await getRelatedEvents('wellness', 'evt-1')

    expect(result).toEqual([])
  })
})

describe('getUserBookingForEvent', () => {
  it('returns null when user is not authenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })

    const result = await getUserBookingForEvent('evt-1')

    expect(result).toBeNull()
  })

  it('returns booking when user is authenticated and has one', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    const builder = createQueryBuilder()
    builder.mockResolve(mockBooking)
    fromBuilders['bookings'] = builder

    const result = await getUserBookingForEvent('evt-1')

    expect(result).not.toBeNull()
    expect(result!.status).toBe('confirmed')
    expect(result!.user_id).toBe('user-1')
  })

  it('returns null when authenticated user has no active booking', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    const builder = createQueryBuilder()
    builder.mockResolve(null)
    fromBuilders['bookings'] = builder

    const result = await getUserBookingForEvent('evt-1')

    expect(result).toBeNull()
  })

  it('returns null on query error', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    const builder = createQueryBuilder()
    builder.mockReject('permission denied')
    fromBuilders['bookings'] = builder

    const result = await getUserBookingForEvent('evt-1')

    expect(result).toBeNull()
    expect(console.error).toHaveBeenCalledWith(
      '[getUserBookingForEvent]',
      'permission denied'
    )
  })
})

// ── getPastEvents ────────────────────────────────────────────────────────────
//
// Note: this query orchestrates 3 calls — events, reviews (in), photos (in)
// — and assembles the result via JS Maps. Tests cover the dedup logic
// (top-rated review per event), photo cap (3), and the null-author fallback.

describe('getPastEvents', () => {
  it('returns empty array on events query error', async () => {
    const builder = createQueryBuilder()
    builder.mockReject('connection refused')
    fromBuilders['event_with_stats'] = builder

    const result = await getPastEvents()

    expect(result).toEqual([])
    expect(console.error).toHaveBeenCalledWith(
      '[getPastEvents]',
      'connection refused',
    )
  })

  it('returns empty array when no past events exist (and skips review/photo queries)', async () => {
    const eventsBuilder = createQueryBuilder()
    eventsBuilder.mockResolve([])
    fromBuilders['event_with_stats'] = eventsBuilder

    const result = await getPastEvents()

    expect(result).toEqual([])
    // The reviews/photos queries should not have been issued.
    expect(fromBuilders['event_reviews']).toBeUndefined()
    expect(fromBuilders['event_photos']).toBeUndefined()
  })

  it('filters to is_published + non-cancelled + past + ordered desc with limit 60', async () => {
    const eventsBuilder = createQueryBuilder()
    eventsBuilder.mockResolve([])
    fromBuilders['event_with_stats'] = eventsBuilder

    await getPastEvents()

    expect(eventsBuilder.eq).toHaveBeenCalledWith('is_published', true)
    expect(eventsBuilder.eq).toHaveBeenCalledWith('is_cancelled', false)
    expect(eventsBuilder.lt).toHaveBeenCalledWith(
      'date_time',
      expect.any(String),
    )
    expect(eventsBuilder.order).toHaveBeenCalledWith('date_time', {
      ascending: false,
    })
    expect(eventsBuilder.limit).toHaveBeenCalledWith(60)
  })

  it('attaches the highest-rated review per event (first match wins) and caps photos at 3', async () => {
    const eventsBuilder = createQueryBuilder()
    eventsBuilder.mockResolve([
      { ...mockEventWithStats, id: 'evt-1' },
      { ...mockEventWithStats, id: 'evt-2' },
    ])
    fromBuilders['event_with_stats'] = eventsBuilder

    // Reviews come pre-sorted by rating desc (mirrors the .order chain).
    // For evt-1 we provide two reviews — only the first should attach.
    // evt-2 gets none.
    const reviewsBuilder = createQueryBuilder()
    reviewsBuilder.mockResolve([
      {
        event_id: 'evt-1',
        rating: 5,
        review_text: 'Top tier.',
        author: { full_name: 'Anna Lee' },
      },
      {
        event_id: 'evt-1',
        rating: 4,
        review_text: 'Was OK.',
        author: { full_name: 'Ben Park' },
      },
    ])
    fromBuilders['event_reviews'] = reviewsBuilder

    // Photos: evt-1 gets 5 — should cap at 3. evt-2 gets none.
    const photosBuilder = createQueryBuilder()
    photosBuilder.mockResolve(
      Array.from({ length: 5 }, (_, i) => ({
        event_id: 'evt-1',
        image_url: `/p${i}.jpg`,
      })),
    )
    fromBuilders['event_photos'] = photosBuilder

    const result = await getPastEvents()

    expect(result).toHaveLength(2)
    const e1 = result.find((e) => e.id === 'evt-1')!
    const e2 = result.find((e) => e.id === 'evt-2')!

    expect(e1.top_review).toEqual({
      rating: 5,
      review_text: 'Top tier.',
      author_name: 'Anna Lee',
    })
    expect(e1.photos).toHaveLength(3)
    expect(e1.photos.map((p) => p.image_url)).toEqual([
      '/p0.jpg',
      '/p1.jpg',
      '/p2.jpg',
    ])

    expect(e2.top_review).toBeNull()
    expect(e2.photos).toEqual([])
  })

  it('falls back to "A member" when the author join is null or missing', async () => {
    const eventsBuilder = createQueryBuilder()
    eventsBuilder.mockResolve([{ ...mockEventWithStats, id: 'evt-1' }])
    fromBuilders['event_with_stats'] = eventsBuilder

    const reviewsBuilder = createQueryBuilder()
    reviewsBuilder.mockResolve([
      {
        event_id: 'evt-1',
        rating: 5,
        review_text: 'Great.',
        // author missing entirely (Supabase returns null when no FK row)
        author: null,
      },
    ])
    fromBuilders['event_reviews'] = reviewsBuilder

    const photosBuilder = createQueryBuilder()
    photosBuilder.mockResolve([])
    fromBuilders['event_photos'] = photosBuilder

    const result = await getPastEvents()

    expect(result[0].top_review?.author_name).toBe('A member')
  })

  it('normalises Supabase array-shape author joins to single object', async () => {
    const eventsBuilder = createQueryBuilder()
    eventsBuilder.mockResolve([{ ...mockEventWithStats, id: 'evt-1' }])
    fromBuilders['event_with_stats'] = eventsBuilder

    const reviewsBuilder = createQueryBuilder()
    reviewsBuilder.mockResolve([
      {
        event_id: 'evt-1',
        rating: 5,
        review_text: 'Great.',
        // Author returned as an array (the FK join shape Supabase
        // sometimes returns even for single FKs).
        author: [{ full_name: 'Charlotte Davis' }],
      },
    ])
    fromBuilders['event_reviews'] = reviewsBuilder

    const photosBuilder = createQueryBuilder()
    photosBuilder.mockResolve([])
    fromBuilders['event_photos'] = photosBuilder

    const result = await getPastEvents()

    expect(result[0].top_review?.author_name).toBe('Charlotte Davis')
  })

  it('filters reviews to is_visible + non-null/non-empty review_text', async () => {
    const eventsBuilder = createQueryBuilder()
    eventsBuilder.mockResolve([{ ...mockEventWithStats, id: 'evt-1' }])
    fromBuilders['event_with_stats'] = eventsBuilder

    const reviewsBuilder = createQueryBuilder()
    reviewsBuilder.mockResolve([])
    fromBuilders['event_reviews'] = reviewsBuilder

    const photosBuilder = createQueryBuilder()
    photosBuilder.mockResolve([])
    fromBuilders['event_photos'] = photosBuilder

    await getPastEvents()

    expect(reviewsBuilder.eq).toHaveBeenCalledWith('is_visible', true)
    expect(reviewsBuilder.not).toHaveBeenCalledWith('review_text', 'is', null)
    expect(reviewsBuilder.neq).toHaveBeenCalledWith('review_text', '')
  })
})
