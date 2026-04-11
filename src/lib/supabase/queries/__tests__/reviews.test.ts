import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Chainable query builder mock ─────────────────────────────────────────────

interface MockQueryBuilder {
  select: ReturnType<typeof vi.fn>
  eq: ReturnType<typeof vi.fn>
  neq: ReturnType<typeof vi.fn>
  is: ReturnType<typeof vi.fn>
  lt: ReturnType<typeof vi.fn>
  in: ReturnType<typeof vi.fn>
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
    'select', 'eq', 'neq', 'is', 'lt', 'in', 'order', 'limit', 'single', 'maybeSingle',
  ]

  for (const method of chainMethods) {
    (builder[method] as ReturnType<typeof vi.fn>) = vi.fn(() => builder)
  }

  builder.then = (resolve: (v: unknown) => void, reject: (v: unknown) => void) => {
    return Promise.resolve(_result).then(resolve, reject)
  }

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

import { getReviewableEvents } from '../reviews'

// ── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.restoreAllMocks()
  fromBuilders = {}
  mockGetUser = vi.fn(() => Promise.resolve({ data: { user: null } }))
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

// ── Tests ───────────────────────────────────────────────────────────────────

describe('getReviewableEvents', () => {
  it('T2-5: unauthenticated user returns empty array', async () => {
    mockGetUser = vi.fn(() => Promise.resolve({ data: { user: null } }))

    const result = await getReviewableEvents()

    expect(result).toEqual([])
  })

  it('T2-6: event already reviewed is filtered out of result', async () => {
    mockGetUser = vi.fn(() =>
      Promise.resolve({ data: { user: { id: 'user-1' } } })
    )

    // bookings query returns one past event
    const bookingsBuilder = createQueryBuilder()
    bookingsBuilder.mockResolve([
      {
        event: {
          id: 'evt-1',
          slug: 'wine',
          title: 'Wine',
          date_time: '2020-01-01T19:00:00Z',
          venue_name: 'Bar',
          image_url: '',
          category: 'drinks',
        },
      },
    ])
    fromBuilders['bookings'] = bookingsBuilder

    // event_reviews query says evt-1 is already reviewed
    const reviewsBuilder = createQueryBuilder()
    reviewsBuilder.mockResolve([{ event_id: 'evt-1' }])
    fromBuilders['event_reviews'] = reviewsBuilder

    const result = await getReviewableEvents()

    expect(result).toEqual([])
  })

  it('T2-7: error on bookings query returns empty array', async () => {
    mockGetUser = vi.fn(() =>
      Promise.resolve({ data: { user: { id: 'user-1' } } })
    )

    const bookingsBuilder = createQueryBuilder()
    bookingsBuilder.mockReject('connection refused')
    fromBuilders['bookings'] = bookingsBuilder

    const result = await getReviewableEvents()

    expect(result).toEqual([])
    expect(console.error).toHaveBeenCalledWith(
      '[getReviewableEvents]',
      'connection refused'
    )
  })
})
