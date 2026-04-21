import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Supabase mock ──────────────────────────────────────────────────────────

const mockGetUser = vi.fn()
const mockFrom = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(() =>
    Promise.resolve({
      auth: { getUser: mockGetUser },
      from: mockFrom,
      rpc: vi.fn(),
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
  cancelEvent,
  duplicateEvent,
  upsertEventInclusions,
  upsertEventHosts,
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

/**
 * Build a chainable mock that mirrors Supabase's PostgREST builder pattern.
 */
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

/**
 * Set up mock where the first from() returns admin profile,
 * and subsequent calls return from the `responses` array.
 */
function mockAdminWithSequence(
  responses: Array<{ data?: unknown; error?: unknown; count?: number | null }>,
  userId = 'admin-1'
) {
  authenticateAdmin(userId)
  let callCount = 0
  mockFrom.mockImplementation(() => {
    if (callCount === 0) {
      // First call is requireAdmin → profiles.role
      callCount++
      return mockChain({ data: { role: 'admin' } })
    }
    const idx = callCount - 1
    callCount++
    const response = responses[idx] ?? responses[responses.length - 1]
    return mockChain(response)
  })
}

/**
 * Set up mock for a non-admin user (member role).
 */
function mockMemberUser(userId = 'user-1') {
  mockGetUser.mockResolvedValue({
    data: { user: { id: userId } },
    error: null,
  })
  mockFrom.mockImplementation(() => mockChain({ data: { role: 'member' } }))
}

// ── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
})

// ════════════════════════════════════════════════════════════════════════════
// cancelEvent
// ════════════════════════════════════════════════════════════════════════════

describe('cancelEvent', () => {
  // NOTE: This test mocks Supabase. RLS enforcement is in supabase/migrations/ — verify there.
  it('T1-1: throws for unauthenticated user', async () => {
    unauthenticateUser()
    await expect(cancelEvent('evt-1')).rejects.toThrow('Authentication required')
  })

  // NOTE: This test mocks Supabase. RLS enforcement is in supabase/migrations/ — verify there.
  it('T1-2: throws for member role (not admin)', async () => {
    mockMemberUser()
    await expect(cancelEvent('evt-1')).rejects.toThrow('Admin access required')
  })

  it('T1-3: happy path — sets is_cancelled true and returns success', async () => {
    mockAdminWithSequence([
      // Call 1: events.select('slug').eq('id', eventId).single()
      { data: { slug: 'test-event' } },
      // Call 2: events.update({ is_cancelled: true }).eq('id', eventId)
      { error: null },
    ])

    const result = await cancelEvent('evt-1')

    expect(result).toEqual({ success: true })
  })

  it('T1-4: event not found returns error', async () => {
    mockAdminWithSequence([
      // Call 1: events.select('slug') → no data
      { data: null },
    ])

    const result = await cancelEvent('evt-not-found')

    expect(result).toEqual({ error: 'Event not found' })
  })
})

// ════════════════════════════════════════════════════════════════════════════
// duplicateEvent
// ════════════════════════════════════════════════════════════════════════════

describe('duplicateEvent', () => {
  const baseSource = {
    id: 'evt-source',
    title: 'Wine Night',
    slug: 'wine-night',
    description: 'long desc',
    short_description: 'short',
    date_time: '2026-05-01T18:00:00.000Z',
    end_time: '2026-05-01T22:00:00.000Z',
    venue_name: 'Borough Market',
    venue_address: '8 Southwark St',
    postcode: 'SE1 1TL',
    venue_revealed: false,
    category: 'drinks',
    price: 3500,
    capacity: 30,
    image_url: null,
    dress_code: 'Smart casual',
  }

  it('rejects non-admin users', async () => {
    mockMemberUser()
    await expect(duplicateEvent('evt-1')).rejects.toThrow('Admin access required')
  })

  it('returns error when event id is missing', async () => {
    authenticateAdmin()
    mockFrom.mockImplementation(() => mockChain({ data: { role: 'admin' } }))
    const result = await duplicateEvent('')
    expect(result).toEqual({ error: 'Event ID is required' })
  })

  it('returns error when source event is not found', async () => {
    mockAdminWithSequence([
      // events.select('*').eq('id', ...).is('deleted_at', null).single() → no row
      { data: null, error: { message: 'no rows' } },
    ])
    const result = await duplicateEvent('evt-missing')
    expect(result).toEqual({ error: 'Event not found' })
  })

  it('happy path — inserts a new draft with shifted dates, copies inclusions + hosts', async () => {
    let insertedRow: Record<string, unknown> | null = null
    let insertedInclusions: unknown = null
    let insertedHosts: unknown = null

    // uniqueSlug is mocked at module level to return a deterministic slug
    // without calling the `exists` callback, so the from() sequence is:
    //   1: requireAdmin → profiles.role
    //   2: events.select source
    //   3: events.insert (returns inserted row)
    //   4: event_inclusions.select
    //   5: event_inclusions.insert
    //   6: event_hosts.select
    //   7: event_hosts.insert
    authenticateAdmin()
    let callCount = 0
    mockFrom.mockImplementation(() => {
      callCount++
      if (callCount === 1) return mockChain({ data: { role: 'admin' } })
      if (callCount === 2) return mockChain({ data: baseSource })
      if (callCount === 3) {
        const chain = mockChain({
          data: { id: 'evt-dup', slug: 'copy-of-wine-night' },
        })
        chain.insert = vi.fn((row: unknown) => {
          insertedRow = row as Record<string, unknown>
          return chain
        })
        return chain
      }
      if (callCount === 4) {
        return mockChain({
          data: [{ label: 'Welcome Drink', icon: 'wine', sort_order: 0 }],
        })
      }
      if (callCount === 5) {
        const chain = mockChain({ error: null })
        chain.insert = vi.fn((rows: unknown) => {
          insertedInclusions = rows
          return chain
        })
        return chain
      }
      if (callCount === 6) {
        return mockChain({
          data: [
            { profile_id: 'host-a', role_label: 'Host', sort_order: 0 },
          ],
        })
      }
      if (callCount === 7) {
        const chain = mockChain({ error: null })
        chain.insert = vi.fn((rows: unknown) => {
          insertedHosts = rows
          return chain
        })
        return chain
      }
      return mockChain({ data: null })
    })

    const result = await duplicateEvent('evt-source')

    expect(result).toEqual({
      event: { id: 'evt-dup', slug: 'copy-of-wine-night' },
    })
    expect(insertedRow).toMatchObject({
      title: 'Copy of Wine Night',
      slug: 'copy-of-wine-night',
      description: 'long desc',
      venue_name: 'Borough Market',
      venue_revealed: false,
      capacity: 30,
      is_published: false,
      is_cancelled: false,
    })
    // Date shifted +7 days exactly.
    const newStart = new Date(insertedRow!.date_time as string).getTime()
    const newEnd = new Date(insertedRow!.end_time as string).getTime()
    expect(newStart - new Date(baseSource.date_time).getTime()).toBe(
      7 * 24 * 60 * 60 * 1000,
    )
    expect(newEnd - new Date(baseSource.end_time).getTime()).toBe(
      7 * 24 * 60 * 60 * 1000,
    )
    expect(insertedInclusions).toEqual([
      { event_id: 'evt-dup', label: 'Welcome Drink', icon: 'wine', sort_order: 0 },
    ])
    expect(insertedHosts).toEqual([
      { event_id: 'evt-dup', profile_id: 'host-a', role_label: 'Host', sort_order: 0 },
    ])
  })

  it('does not copy bookings, reviews, or photos (only events/inclusions/hosts touched)', async () => {
    const tablesTouched: string[] = []
    authenticateAdmin()
    let callCount = 0
    mockFrom.mockImplementation((table: string) => {
      callCount++
      tablesTouched.push(table)
      if (callCount === 1) return mockChain({ data: { role: 'admin' } })
      if (callCount === 2) return mockChain({ data: baseSource })
      if (callCount === 3) {
        return mockChain({ data: { id: 'evt-dup', slug: 'copy-of-wine-night' } })
      }
      // No inclusions to copy.
      if (callCount === 4) return mockChain({ data: [] })
      // No hosts to copy.
      if (callCount === 5) return mockChain({ data: [] })
      return mockChain({ data: null })
    })

    const result = await duplicateEvent('evt-source')
    expect('event' in result).toBe(true)
    // requireAdmin -> profiles, then events x3 (fetch, slug-check, insert),
    // then event_inclusions, event_hosts. No bookings/reviews/photos.
    expect(tablesTouched).not.toContain('bookings')
    expect(tablesTouched).not.toContain('event_reviews')
    expect(tablesTouched).not.toContain('event_photos')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// upsertEventInclusions
// ════════════════════════════════════════════════════════════════════════════

describe('upsertEventInclusions', () => {
  // NOTE: This test mocks Supabase. RLS enforcement is in supabase/migrations/ — verify there.
  it('T1-5: throws for member role (not admin)', async () => {
    mockMemberUser()
    await expect(
      upsertEventInclusions('evt-1', [{ label: 'Wine' }])
    ).rejects.toThrow('Admin access required')
  })

  it('T1-6: happy path — deletes existing then inserts 2 inclusions with sort_order', async () => {
    let capturedDeleteTable = ''
    let capturedInsertData: unknown = null

    authenticateAdmin()
    let callCount = 0
    mockFrom.mockImplementation((table: string) => {
      callCount++
      if (callCount === 1) {
        // requireAdmin → profiles.role
        return mockChain({ data: { role: 'admin' } })
      }
      if (callCount === 2) {
        // delete existing inclusions
        capturedDeleteTable = table
        return mockChain({ error: null })
      }
      if (callCount === 3) {
        // insert new inclusions
        const chain = mockChain({ error: null })
        chain.insert = vi.fn((data: unknown) => {
          capturedInsertData = data
          return chain
        })
        return chain
      }
      return mockChain({ data: null })
    })

    const result = await upsertEventInclusions('evt-1', [
      { label: 'Welcome Drink', icon: 'wine' },
      { label: 'Canapes', icon: 'food' },
    ])

    expect(result).toEqual({ success: true })
    expect(capturedDeleteTable).toBe('event_inclusions')
    expect(capturedInsertData).toEqual([
      { event_id: 'evt-1', label: 'Welcome Drink', icon: 'wine', sort_order: 0 },
      { event_id: 'evt-1', label: 'Canapes', icon: 'food', sort_order: 1 },
    ])
  })
})

// ════════════════════════════════════════════════════════════════════════════
// upsertEventHosts
// ════════════════════════════════════════════════════════════════════════════

describe('upsertEventHosts', () => {
  it('T1-7: happy path — deletes existing then inserts 2 hosts with role_label Host', async () => {
    let capturedDeleteTable = ''
    let capturedInsertData: unknown = null

    authenticateAdmin()
    let callCount = 0
    mockFrom.mockImplementation((table: string) => {
      callCount++
      if (callCount === 1) {
        // requireAdmin → profiles.role
        return mockChain({ data: { role: 'admin' } })
      }
      if (callCount === 2) {
        // delete existing hosts
        capturedDeleteTable = table
        return mockChain({ error: null })
      }
      if (callCount === 3) {
        // insert new hosts
        const chain = mockChain({ error: null })
        chain.insert = vi.fn((data: unknown) => {
          capturedInsertData = data
          return chain
        })
        return chain
      }
      return mockChain({ data: null })
    })

    const result = await upsertEventHosts('evt-1', ['host-a', 'host-b'])

    expect(result).toEqual({ success: true })
    expect(capturedDeleteTable).toBe('event_hosts')
    expect(capturedInsertData).toEqual([
      { event_id: 'evt-1', profile_id: 'host-a', role_label: 'Host', sort_order: 0 },
      { event_id: 'evt-1', profile_id: 'host-b', role_label: 'Host', sort_order: 1 },
    ])
  })
})
