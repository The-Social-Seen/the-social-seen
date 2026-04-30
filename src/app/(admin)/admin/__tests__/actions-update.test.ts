import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Supabase mock ──────────────────────────────────────────────────────────

const mockGetUser = vi.fn()
const mockFrom = vi.fn()
const mockRpc = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(() =>
    Promise.resolve({
      auth: { getUser: mockGetUser },
      from: mockFrom,
      rpc: mockRpc,
    }),
  ),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('@/lib/utils/slugify', () => ({
  slugify: vi.fn((text: string) => text.toLowerCase().replace(/\s+/g, '-')),
  uniqueSlug: vi.fn(async (text: string) => text.toLowerCase().replace(/\s+/g, '-')),
}))

import {
  updateEvent,
  getMonthlyBookings,
  getAdminReviews,
} from '../actions'

// ── Helpers ────────────────────────────────────────────────────────────────

function authenticateAdmin(userId = 'admin-1') {
  mockGetUser.mockResolvedValue({
    data: { user: { id: userId } },
    error: null,
  })
}

function unauthenticateUser() {
  mockGetUser.mockResolvedValue({
    data: { user: null },
    error: { message: 'Not authenticated' },
  })
}

function mockChain(response: { data?: unknown; error?: unknown; count?: number | null }) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {}
  const methods = [
    'select', 'insert', 'update', 'delete',
    'eq', 'neq', 'is', 'single', 'maybeSingle',
    'order', 'limit', 'gt', 'gte', 'lte', 'or', 'in',
  ]
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain)
  }
  chain.then = vi.fn((resolve: (v: unknown) => void) => resolve(response))
  return chain
}

function mockAdminWithSequence(
  responses: Array<{ data?: unknown; error?: unknown; count?: number | null }>,
  userId = 'admin-1'
) {
  authenticateAdmin(userId)
  let callCount = 0
  mockFrom.mockImplementation(() => {
    if (callCount === 0) {
      callCount++
      return mockChain({ data: { role: 'admin' } })
    }
    const idx = callCount - 1
    callCount++
    const response = responses[idx] ?? responses[responses.length - 1]
    return mockChain(response)
  })
}

function mockMemberUser(userId = 'user-1') {
  mockGetUser.mockResolvedValue({
    data: { user: { id: userId } },
    error: null,
  })
  mockFrom.mockImplementation(() => mockChain({ data: { role: 'member' } }))
}

function makeEventFormData(overrides: Record<string, string> = {}): FormData {
  const defaults: Record<string, string> = {
    title: 'Test Wine Evening',
    description: 'A lovely evening of wine and conversation in London',
    short_description: 'Wine tasting for professionals',
    date_time: '2026-06-15T19:00:00.000Z',
    end_time: '2026-06-15T22:00:00.000Z',
    venue_name: 'Wine Cellar',
    venue_address: '1 Bank End, London SE1 9BU',
    // Phase 3 W5 — replaces the legacy `category` field.
    primary_tag_slug: 'drinks-bars',
    price: '35',
    capacity: '20',
    image_url: '',
    dress_code: '',
    is_published: 'true',
  }
  const merged = { ...defaults, ...overrides }
  const fd = new FormData()
  for (const [k, v] of Object.entries(merged)) {
    fd.set(k, v)
  }
  return fd
}

// ── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
})

// ════════════════════════════════════════════════════════════════════════════
// updateEvent
// ════════════════════════════════════════════════════════════════════════════

describe('updateEvent', () => {
  // NOTE: This test mocks Supabase. RLS enforcement is in supabase/migrations/ — verify there.
  it('T3-1: throws for member role (not admin)', async () => {
    mockMemberUser()
    await expect(updateEvent('evt-1', makeEventFormData())).rejects.toThrow('Admin access required')
  })

  // NOTE: This test mocks Supabase. RLS enforcement is in supabase/migrations/ — verify there.
  it('T3-2: throws for unauthenticated user', async () => {
    unauthenticateUser()
    await expect(updateEvent('evt-1', makeEventFormData())).rejects.toThrow('Authentication required')
  })

  it('T3-3: returns validation error for title shorter than 3 chars', async () => {
    mockAdminWithSequence([])

    const result = await updateEvent('evt-1', makeEventFormData({ title: 'AB' }))

    expect(result.error).toBeDefined()
    expect(result.error).toContain('at least 3')
  })

  it('T3-4: converts price from pounds to pence (35 → 3500)', async () => {
    let capturedUpdate: unknown = null

    authenticateAdmin()
    let callCount = 0
    mockFrom.mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        // requireAdmin → profiles.role
        return mockChain({ data: { role: 'admin' } })
      }
      if (callCount === 2) {
        // events.select('slug, title').eq('id').single() → current event
        return mockChain({ data: { slug: 'test-wine-evening', title: 'Test Wine Evening' } })
      }
      if (callCount === 3) {
        // events.update({...}).eq('id').select().single()
        const chain = mockChain({ data: { id: 'evt-1', slug: 'test-wine-evening' } })
        chain.update = vi.fn((data: unknown) => {
          capturedUpdate = data
          return chain
        })
        return chain
      }
      // Any extra calls (event_hosts etc.)
      return mockChain({ error: null })
    })

    await updateEvent('evt-1', makeEventFormData({ price: '35' }))

    expect(capturedUpdate).toBeDefined()
    expect((capturedUpdate as Record<string, unknown>).price).toBe(3500)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// getMonthlyBookings
// ════════════════════════════════════════════════════════════════════════════

describe('getMonthlyBookings', () => {
  beforeEach(() => {
    vi.setSystemTime(new Date('2026-04-11T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('T3-5: returns 14 entries (12 past months + 2 future) with month and count keys', async () => {
    mockAdminWithSequence([{ data: [], error: null }])

    const result = await getMonthlyBookings()

    // 12 trailing months + current + 2 future months so admins can see
    // bookings for upcoming events grouped by event date.
    expect(result).toHaveLength(14)
    for (const entry of result) {
      expect(entry).toHaveProperty('month')
      expect(entry).toHaveProperty('count')
    }
  })

  // NOTE: This test mocks Supabase. RLS enforcement is in supabase/migrations/ — verify there.
  it('T3-6: throws for member role (not admin)', async () => {
    mockMemberUser()
    await expect(getMonthlyBookings()).rejects.toThrow('Admin access required')
  })

  it('T3-5b: buckets bookings by event date, not booking creation date', async () => {
    // System time = 2026-04-11. A booking placed in April for an event
    // that happens in May 2026 must show up in the May bucket — that's
    // the whole point of the event-date pivot.
    mockAdminWithSequence([
      {
        data: [
          // 2x bookings whose events are in May 2026
          { event: { date_time: '2026-05-04T19:00:00.000Z' } },
          { event: { date_time: '2026-05-20T19:00:00.000Z' } },
          // 1x booking whose event is in March 2026
          { event: { date_time: '2026-03-12T19:00:00.000Z' } },
        ],
        error: null,
      },
    ])

    const result = await getMonthlyBookings()

    const may = result.find((e) => e.month === 'May 2026')
    const march = result.find((e) => e.month === 'Mar 2026')
    const april = result.find((e) => e.month === 'Apr 2026')

    expect(may?.count).toBe(2)
    expect(march?.count).toBe(1)
    // April is the current month and should remain at 0 — bookings do not
    // belong to April just because they were created there.
    expect(april?.count).toBe(0)
  })

  it('T3-5c: filters by events.date_time (joined column), not bookings.created_at', async () => {
    // Guards against a regression to the old behaviour. The function must
    // join events!inner and apply date-window filters on events.date_time.
    let capturedChain: ReturnType<typeof mockChain> | null = null

    authenticateAdmin()
    let callCount = 0
    mockFrom.mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        return mockChain({ data: { role: 'admin' } })
      }
      const chain = mockChain({ data: [], error: null })
      capturedChain = chain
      return chain
    })

    await getMonthlyBookings()

    expect(capturedChain).not.toBeNull()
    const gteCalls = capturedChain!.gte.mock.calls
    const lteCalls = capturedChain!.lte.mock.calls
    // Both date-window bounds must reference the joined events.date_time,
    // never the bookings table's own created_at.
    expect(gteCalls.some((c) => c[0] === 'events.date_time')).toBe(true)
    expect(lteCalls.some((c) => c[0] === 'events.date_time')).toBe(true)
    expect(gteCalls.some((c) => c[0] === 'created_at')).toBe(false)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// getAdminReviews
// ════════════════════════════════════════════════════════════════════════════

describe('getAdminReviews', () => {
  it('T3-7: filter=visible calls .eq with is_visible true', async () => {
    let capturedChain: ReturnType<typeof mockChain> | null = null

    authenticateAdmin()
    let callCount = 0
    mockFrom.mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        return mockChain({ data: { role: 'admin' } })
      }
      const chain = mockChain({ data: [], error: null })
      capturedChain = chain
      return chain
    })

    await getAdminReviews('visible')

    expect(capturedChain).not.toBeNull()
    const eqCalls = capturedChain!.eq.mock.calls
    expect(eqCalls).toContainEqual(['is_visible', true])
  })

  it('T3-8: filter=hidden calls .eq with is_visible false', async () => {
    let capturedChain: ReturnType<typeof mockChain> | null = null

    authenticateAdmin()
    let callCount = 0
    mockFrom.mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        return mockChain({ data: { role: 'admin' } })
      }
      const chain = mockChain({ data: [], error: null })
      capturedChain = chain
      return chain
    })

    await getAdminReviews('hidden')

    expect(capturedChain).not.toBeNull()
    const eqCalls = capturedChain!.eq.mock.calls
    expect(eqCalls).toContainEqual(['is_visible', false])
  })
})
