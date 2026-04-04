import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Chainable query builder mock ─────────────────────────────────────────────

interface MockQueryBuilder {
  select: ReturnType<typeof vi.fn>
  eq: ReturnType<typeof vi.fn>
  neq: ReturnType<typeof vi.fn>
  is: ReturnType<typeof vi.fn>
  order: ReturnType<typeof vi.fn>
  limit: ReturnType<typeof vi.fn>
  single: ReturnType<typeof vi.fn>
  maybeSingle: ReturnType<typeof vi.fn>
  then: (resolve: (v: unknown) => void, reject: (v: unknown) => void) => Promise<unknown>
  mockResolve: (data: unknown) => void
  mockReject: (message: string, code?: string) => void
}

function createQueryBuilder(): MockQueryBuilder {
  let _result: { data: unknown; error: unknown } = { data: null, error: null }

  const builder = {} as MockQueryBuilder
  const chainMethods: (keyof MockQueryBuilder)[] = [
    'select', 'eq', 'neq', 'is', 'order', 'limit', 'single', 'maybeSingle',
  ]
  for (const method of chainMethods) {
    (builder[method] as ReturnType<typeof vi.fn>) = vi.fn(() => builder)
  }

  builder.then = (resolve, reject) => Promise.resolve(_result).then(resolve, reject)

  builder.mockResolve = (data: unknown) => {
    _result = { data, error: null }
  }
  builder.mockReject = (message: string, code?: string) => {
    _result = { data: null, error: { message, code: code ?? 'ERROR' } }
  }

  return builder
}

// ── Supabase client mock ─────────────────────────────────────────────────────

let fromBuilders: Record<string, MockQueryBuilder>

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(() =>
    Promise.resolve({
      from: vi.fn((table: string) => {
        if (!fromBuilders[table]) {
          fromBuilders[table] = createQueryBuilder()
        }
        return fromBuilders[table]
      }),
    }),
  ),
}))

import { getProfile, getMyBookings } from '../profile'

// ── Fixtures ────────────────────────────────────────────────────────────────

const mockProfile = {
  id: 'user-1',
  email: 'charlotte@example.com',
  full_name: 'Charlotte Moreau',
  avatar_url: '/img/charlotte.jpg',
  job_title: 'Product Designer',
  company: 'Monzo',
  industry: 'Fintech',
  bio: 'London-based product designer',
  linkedin_url: 'https://linkedin.com/in/charlotte',
  role: 'member',
  onboarding_complete: true,
  referral_source: null,
  created_at: '2026-01-15T10:00:00Z',
  updated_at: '2026-01-15T10:00:00Z',
  deleted_at: null,
}

const mockInterests = [
  { id: 'int-1', user_id: 'user-1', interest: 'Wine & Cocktails', created_at: '2026-01-15T10:00:00Z' },
  { id: 'int-2', user_id: 'user-1', interest: 'Fine Dining', created_at: '2026-01-15T10:00:00Z' },
]

const mockBookingRow = {
  id: 'book-1',
  user_id: 'user-1',
  event_id: 'evt-1',
  status: 'confirmed',
  waitlist_position: null,
  price_at_booking: 3500,
  booked_at: '2026-04-01T12:00:00Z',
  created_at: '2026-04-01T12:00:00Z',
  updated_at: '2026-04-01T12:00:00Z',
  deleted_at: null,
  event: [
    {
      id: 'evt-1',
      slug: 'wine-and-wisdom',
      title: 'Wine & Wisdom',
      date_time: '2026-05-10T19:00:00Z',
      end_time: '2026-05-10T22:00:00Z',
      venue_name: 'The Cellar',
      image_url: '/img/wine.jpg',
      category: 'dining',
      dress_code: 'Smart Casual',
    },
  ],
}

// ── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.restoreAllMocks()
  fromBuilders = {}
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

// ── getProfile ──────────────────────────────────────────────────────────────

describe('getProfile', () => {
  it('returns profile with interests array', async () => {
    const profileBuilder = createQueryBuilder()
    profileBuilder.mockResolve(mockProfile)
    fromBuilders['profiles'] = profileBuilder

    const interestsBuilder = createQueryBuilder()
    interestsBuilder.mockResolve(mockInterests)
    fromBuilders['user_interests'] = interestsBuilder

    const result = await getProfile('user-1')

    expect(result).not.toBeNull()
    expect(result!.full_name).toBe('Charlotte Moreau')
    expect(result!.interests).toEqual(['Wine & Cocktails', 'Fine Dining'])
  })

  it('returns empty interests array when user has no interests', async () => {
    const profileBuilder = createQueryBuilder()
    profileBuilder.mockResolve(mockProfile)
    fromBuilders['profiles'] = profileBuilder

    const interestsBuilder = createQueryBuilder()
    interestsBuilder.mockResolve([])
    fromBuilders['user_interests'] = interestsBuilder

    const result = await getProfile('user-1')

    expect(result).not.toBeNull()
    expect(result!.interests).toEqual([])
  })

  it('returns null when profile does not exist (PGRST116)', async () => {
    const profileBuilder = createQueryBuilder()
    profileBuilder.mockReject('JSON object requested, multiple (or no) rows returned', 'PGRST116')
    fromBuilders['profiles'] = profileBuilder

    const interestsBuilder = createQueryBuilder()
    interestsBuilder.mockResolve([])
    fromBuilders['user_interests'] = interestsBuilder

    const result = await getProfile('nonexistent')

    expect(result).toBeNull()
    // PGRST116 is expected (not found), should not log error
    expect(console.error).not.toHaveBeenCalled()
  })

  it('returns null and logs error on unexpected error', async () => {
    const profileBuilder = createQueryBuilder()
    profileBuilder.mockReject('connection timeout', 'PGRST500')
    fromBuilders['profiles'] = profileBuilder

    const interestsBuilder = createQueryBuilder()
    interestsBuilder.mockResolve([])
    fromBuilders['user_interests'] = interestsBuilder

    const result = await getProfile('user-1')

    expect(result).toBeNull()
    expect(console.error).toHaveBeenCalledWith('[getProfile]', 'connection timeout')
  })

  it('returns profile even when interests query fails', async () => {
    const profileBuilder = createQueryBuilder()
    profileBuilder.mockResolve(mockProfile)
    fromBuilders['profiles'] = profileBuilder

    const interestsBuilder = createQueryBuilder()
    interestsBuilder.mockReject('query error')
    fromBuilders['user_interests'] = interestsBuilder

    const result = await getProfile('user-1')

    expect(result).not.toBeNull()
    expect(result!.full_name).toBe('Charlotte Moreau')
    expect(result!.interests).toEqual([])
    expect(console.error).toHaveBeenCalledWith('[getProfile:interests]', 'query error')
  })
})

// ── getMyBookings ───────────────────────────────────────────────────────────

describe('getMyBookings', () => {
  it('returns bookings with unwrapped event data', async () => {
    const builder = createQueryBuilder()
    builder.mockResolve([mockBookingRow])
    fromBuilders['bookings'] = builder

    const result = await getMyBookings('user-1')

    expect(result).toHaveLength(1)
    expect(result[0].status).toBe('confirmed')
    // Event should be unwrapped from array to single object
    expect(result[0].event.title).toBe('Wine & Wisdom')
    expect(result[0].event.slug).toBe('wine-and-wisdom')
  })

  it('handles event already being a single object (not array)', async () => {
    const rowWithObjectEvent = {
      ...mockBookingRow,
      event: mockBookingRow.event[0], // single object, not array
    }
    const builder = createQueryBuilder()
    builder.mockResolve([rowWithObjectEvent])
    fromBuilders['bookings'] = builder

    const result = await getMyBookings('user-1')

    expect(result[0].event.title).toBe('Wine & Wisdom')
  })

  it('returns empty array when user has no bookings', async () => {
    const builder = createQueryBuilder()
    builder.mockResolve([])
    fromBuilders['bookings'] = builder

    const result = await getMyBookings('user-1')

    expect(result).toEqual([])
  })

  it('returns empty array on error', async () => {
    const builder = createQueryBuilder()
    builder.mockReject('permission denied')
    fromBuilders['bookings'] = builder

    const result = await getMyBookings('user-1')

    expect(result).toEqual([])
    expect(console.error).toHaveBeenCalledWith('[getMyBookings]', 'permission denied')
  })

  it('returns empty array when data is null', async () => {
    const builder = createQueryBuilder()
    builder.mockResolve(null)
    fromBuilders['bookings'] = builder

    const result = await getMyBookings('user-1')

    expect(result).toEqual([])
  })
})
