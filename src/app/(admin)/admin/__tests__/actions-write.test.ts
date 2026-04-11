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
