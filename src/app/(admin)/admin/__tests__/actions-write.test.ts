import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Supabase mock ──────────────────────────────────────────────────────────

const mockGetUser = vi.fn()
const mockFrom = vi.fn()
// refund-fee-deduction: cancelEventAndRefundBookings uses
// createAdminClient() for the bulk-refund loop because it mutates rows
// belonging to many users (service_role bypass — same pattern as the
// webhook handler). Keep this mock separate from the user-context
// `mockFrom` so we can assert on each independently.
const mockAdminFrom = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(() =>
    Promise.resolve({
      auth: { getUser: mockGetUser },
      from: mockFrom,
      rpc: vi.fn(),
    }),
  ),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: mockAdminFrom,
  }),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

// `after()` runs in a Next.js request scope unavailable to Vitest. Mock
// it to execute the callback immediately so any post-response side
// effects (e.g. cancellation emails) are still exercised.
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>()
  return {
    ...actual,
    after: (fn: () => unknown | Promise<unknown>) => {
      void Promise.resolve(fn())
    },
  }
})

// refund-fee-deduction: cancelEventAndRefundBookings calls Stripe to
// issue per-booking refunds. The mock returns a deterministic refund id;
// individual tests override with mockRejectedValueOnce to exercise the
// partial-failure branch.
const mockStripeRefundCreate = vi.fn()
vi.mock('@/lib/stripe/server', () => ({
  getStripeClient: () => ({
    refunds: { create: (...args: unknown[]) => mockStripeRefundCreate(...args) },
  }),
}))

// Stub the email send wrapper so tests don't reach Resend.
const mockSendEmail = vi.fn()
vi.mock('@/lib/email/send', () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
}))

vi.mock('@/lib/utils/slugify', () => ({
  slugify: vi.fn((text: string) => text.toLowerCase().replace(/\s+/g, '-')),
  uniqueSlug: vi.fn(async (text: string) => text.toLowerCase().replace(/\s+/g, '-')),
}))

import {
  cancelEvent,
  cancelEventAndRefundBookings,
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
  /**
   * Set up the standard 3-stage chain for a successful upsert:
   *   call 1: requireAdmin → profiles.role
   *   call 2: delete existing event_hosts
   *   call 3: insert new event_hosts (capturedInsertData is the payload)
   * Returns a getter for the captured insert payload.
   */
  function setupUpsertChain(): { getInsert: () => unknown } {
    let capturedInsertData: unknown = null
    authenticateAdmin()
    let callCount = 0
    mockFrom.mockImplementation(() => {
      callCount++
      if (callCount === 1) return mockChain({ data: { role: 'admin' } })
      if (callCount === 2) return mockChain({ error: null })
      if (callCount === 3) {
        const chain = mockChain({ error: null })
        chain.insert = vi.fn((data: unknown) => {
          capturedInsertData = data
          return chain
        })
        return chain
      }
      return mockChain({ data: null })
    })
    return { getInsert: () => capturedInsertData }
  }

  it('happy path — deletes existing then inserts 2 hosts with their per-host role labels and sort_order', async () => {
    const { getInsert } = setupUpsertChain()

    const result = await upsertEventHosts('evt-1', [
      { profileId: 'host-a', roleLabel: 'Host' },
      { profileId: 'host-b', roleLabel: 'Co-Host' },
    ])

    expect(result).toEqual({ success: true })
    expect(getInsert()).toEqual([
      { event_id: 'evt-1', profile_id: 'host-a', role_label: 'Host', sort_order: 0 },
      { event_id: 'evt-1', profile_id: 'host-b', role_label: 'Co-Host', sort_order: 1 },
    ])
  })

  it('empty hosts array deletes existing rows and skips the insert call', async () => {
    let insertCalls = 0
    let capturedDeleteTable = ''
    authenticateAdmin()
    let callCount = 0
    mockFrom.mockImplementation((table: string) => {
      callCount++
      if (callCount === 1) return mockChain({ data: { role: 'admin' } })
      if (callCount === 2) {
        capturedDeleteTable = table
        return mockChain({ error: null })
      }
      // If a third .from() ever runs, count it as an insert call so we can
      // assert it didn't happen.
      const chain = mockChain({ error: null })
      chain.insert = vi.fn(() => {
        insertCalls++
        return chain
      })
      return chain
    })

    const result = await upsertEventHosts('evt-1', [])

    expect(result).toEqual({ success: true })
    expect(capturedDeleteTable).toBe('event_hosts')
    expect(insertCalls).toBe(0)
  })

  it('falls back to "Host" when roleLabel is empty string', async () => {
    const { getInsert } = setupUpsertChain()

    await upsertEventHosts('evt-1', [{ profileId: 'host-a', roleLabel: '' }])

    expect(getInsert()).toEqual([
      { event_id: 'evt-1', profile_id: 'host-a', role_label: 'Host', sort_order: 0 },
    ])
  })

  it('falls back to "Host" when roleLabel is whitespace-only', async () => {
    const { getInsert } = setupUpsertChain()

    await upsertEventHosts('evt-1', [{ profileId: 'host-a', roleLabel: '   ' }])

    expect(getInsert()).toEqual([
      { event_id: 'evt-1', profile_id: 'host-a', role_label: 'Host', sort_order: 0 },
    ])
  })

  it('trims surrounding whitespace from roleLabel', async () => {
    const { getInsert } = setupUpsertChain()

    await upsertEventHosts('evt-1', [
      { profileId: 'host-a', roleLabel: '  Co-Host  ' },
    ])

    expect(getInsert()).toEqual([
      { event_id: 'evt-1', profile_id: 'host-a', role_label: 'Co-Host', sort_order: 0 },
    ])
  })

  it('accepts roleLabel of exactly 60 chars (cap boundary)', async () => {
    const { getInsert } = setupUpsertChain()
    const sixty = 'x'.repeat(60)

    const result = await upsertEventHosts('evt-1', [
      { profileId: 'host-a', roleLabel: sixty },
    ])

    expect(result).toEqual({ success: true })
    expect(getInsert()).toEqual([
      { event_id: 'evt-1', profile_id: 'host-a', role_label: sixty, sort_order: 0 },
    ])
  })

  it('rejects roleLabel longer than 60 chars and never deletes or inserts', async () => {
    const sixtyOne = 'y'.repeat(61)
    let dbCalls = 0
    authenticateAdmin()
    let callCount = 0
    mockFrom.mockImplementation(() => {
      callCount++
      if (callCount === 1) return mockChain({ data: { role: 'admin' } })
      // Validation should fail BEFORE any second .from() runs.
      dbCalls++
      return mockChain({ data: null })
    })

    const result = await upsertEventHosts('evt-1', [
      { profileId: 'host-a', roleLabel: sixtyOne },
    ])

    expect(result).toEqual({
      error: 'Host role label must be 60 characters or fewer',
    })
    expect(dbCalls).toBe(0)
  })

  it('returns error when eventId is empty', async () => {
    authenticateAdmin()
    let callCount = 0
    mockFrom.mockImplementation(() => {
      callCount++
      if (callCount === 1) return mockChain({ data: { role: 'admin' } })
      return mockChain({ data: null })
    })

    const result = await upsertEventHosts('', [
      { profileId: 'host-a', roleLabel: 'Host' },
    ])

    expect(result).toEqual({ error: 'Event ID is required' })
  })

  it('rejects an entry with a missing profileId', async () => {
    authenticateAdmin()
    let dbCalls = 0
    let callCount = 0
    mockFrom.mockImplementation(() => {
      callCount++
      if (callCount === 1) return mockChain({ data: { role: 'admin' } })
      dbCalls++
      return mockChain({ data: null })
    })

    const result = await upsertEventHosts('evt-1', [
      { profileId: '   ', roleLabel: 'Host' },
    ])

    expect(result).toEqual({ error: 'Host #1 is missing a profile id' })
    expect(dbCalls).toBe(0)
  })

  it('throws for unauthenticated user', async () => {
    unauthenticateUser()
    await expect(
      upsertEventHosts('evt-1', [{ profileId: 'host-a', roleLabel: 'Host' }]),
    ).rejects.toThrow('Authentication required')
  })

  it('throws for non-admin caller', async () => {
    mockMemberUser()
    await expect(
      upsertEventHosts('evt-1', [{ profileId: 'host-a', roleLabel: 'Host' }]),
    ).rejects.toThrow('Admin access required')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// cancelEventAndRefundBookings (refund-fee-deduction)
// ════════════════════════════════════════════════════════════════════════════

describe('cancelEventAndRefundBookings', () => {
  /**
   * Build a queued admin-client `from()` mock — each call returns the
   * next response in the queue. Mirrors how Supabase's builder is
   * chainable + await-able; tests pass a single `data` per call.
   */
  function queueAdminResponses(
    responses: Array<{ data?: unknown; error?: unknown }>,
  ) {
    let idx = 0
    mockAdminFrom.mockImplementation(() => {
      const response = responses[idx] ?? responses[responses.length - 1]
      idx++
      return mockChain(response)
    })
  }

  it('rejects unauthenticated callers via requireAdmin guard', async () => {
    unauthenticateUser()
    await expect(cancelEventAndRefundBookings('evt-1')).rejects.toThrow(
      'Authentication required',
    )
  })

  it('rejects non-admin callers via requireAdmin guard', async () => {
    mockMemberUser()
    await expect(cancelEventAndRefundBookings('evt-1')).rejects.toThrow(
      'Admin access required',
    )
  })

  it('returns error when eventId is empty', async () => {
    authenticateAdmin()
    mockFrom.mockImplementation(() => mockChain({ data: { role: 'admin' } }))
    const result = await cancelEventAndRefundBookings('')
    expect(result.success).toBe(false)
    expect(result.error).toBe('Event ID is required')
  })

  it('returns error when the event is not found', async () => {
    authenticateAdmin()
    mockFrom.mockImplementation(() => mockChain({ data: { role: 'admin' } }))
    queueAdminResponses([
      // events.select(...).single() → no row
      { data: null, error: { message: 'no rows' } },
    ])

    const result = await cancelEventAndRefundBookings('evt-missing')
    expect(result.success).toBe(false)
    expect(result.error).toBe('Event not found')
  })

  // Happy path — 3 confirmed paid bookings, all refunded full
  // (price + booking fee).
  it('refunds all confirmed paid bookings with price+fee', async () => {
    authenticateAdmin()
    mockFrom.mockImplementation(() => mockChain({ data: { role: 'admin' } }))

    // 1) events.select  → event row (is_cancelled=false)
    // 2) events.update  → is_cancelled flip (success)
    // 3) bookings.select → three confirmed paid bookings
    // 4-6) bookings.update × 3 (refund reconcile for each booking)
    queueAdminResponses([
      {
        data: {
          id: 'evt-1',
          slug: 'wine-night',
          title: 'Wine Night',
          date_time: '2026-05-07T19:00:00Z',
          is_cancelled: false,
          deleted_at: null,
        },
      },
      { error: null }, // update is_cancelled
      {
        data: [
          {
            id: 'bk-1',
            user_id: 'u1',
            status: 'confirmed',
            price_at_booking: 2000,
            booking_fee_pence: 60,
            stripe_payment_id: 'pi_1',
            refunded_amount_pence: 0,
            waitlist_position: null,
            profile: { full_name: 'A', email: 'a@example.com' },
          },
          {
            id: 'bk-2',
            user_id: 'u2',
            status: 'confirmed',
            price_at_booking: 2000,
            booking_fee_pence: 60,
            stripe_payment_id: 'pi_2',
            refunded_amount_pence: 0,
            waitlist_position: null,
            profile: { full_name: 'B', email: 'b@example.com' },
          },
          {
            id: 'bk-3',
            user_id: 'u3',
            status: 'confirmed',
            price_at_booking: 2000,
            booking_fee_pence: 60,
            stripe_payment_id: 'pi_3',
            refunded_amount_pence: 0,
            waitlist_position: null,
            profile: { full_name: 'C', email: 'c@example.com' },
          },
        ],
      },
      { error: null }, // bk-1 update
      { error: null }, // bk-2 update
      { error: null }, // bk-3 update
    ])

    mockStripeRefundCreate.mockResolvedValue({ id: 're_mock' })
    mockSendEmail.mockResolvedValue({ success: true, messageId: 'm1' })

    const result = await cancelEventAndRefundBookings('evt-1')

    expect(result.success).toBe(true)
    expect(result.summary).toBeTruthy()
    expect(result.summary!.totalBookings).toBe(3)
    expect(result.summary!.refundedCount).toBe(3)
    // Each refund is 2060p (price + fee) — locked decision 3.
    expect(result.summary!.refundedTotalPence).toBe(2060 * 3)
    expect(result.summary!.failedRefunds).toHaveLength(0)

    // Each refunds.create call must pass amount = price + fee.
    expect(mockStripeRefundCreate).toHaveBeenCalledTimes(3)
    const refundCalls = mockStripeRefundCreate.mock.calls
    for (const [args] of refundCalls) {
      expect(args).toMatchObject({
        amount: 2060,
        metadata: expect.objectContaining({
          source: 'admin_event_cancelled',
        }),
      })
    }
  })

  // Partial failure — middle booking's refund throws. The first and
  // third should still be processed; the failed one surfaces in
  // failedRefunds with the user email and Stripe error string.
  it('surfaces a partial-failure when one Stripe refund throws', async () => {
    authenticateAdmin()
    mockFrom.mockImplementation(() => mockChain({ data: { role: 'admin' } }))

    queueAdminResponses([
      {
        data: {
          id: 'evt-1',
          slug: 'wine-night',
          title: 'Wine Night',
          date_time: '2026-05-07T19:00:00Z',
          is_cancelled: false,
          deleted_at: null,
        },
      },
      { error: null },
      {
        data: [
          {
            id: 'bk-1', user_id: 'u1', status: 'confirmed',
            price_at_booking: 2000, booking_fee_pence: 60,
            stripe_payment_id: 'pi_1', refunded_amount_pence: 0,
            waitlist_position: null,
            profile: { full_name: 'A', email: 'a@example.com' },
          },
          {
            id: 'bk-2', user_id: 'u2', status: 'confirmed',
            price_at_booking: 2000, booking_fee_pence: 60,
            stripe_payment_id: 'pi_2', refunded_amount_pence: 0,
            waitlist_position: null,
            profile: { full_name: 'B', email: 'b@example.com' },
          },
          {
            id: 'bk-3', user_id: 'u3', status: 'confirmed',
            price_at_booking: 2000, booking_fee_pence: 60,
            stripe_payment_id: 'pi_3', refunded_amount_pence: 0,
            waitlist_position: null,
            profile: { full_name: 'C', email: 'c@example.com' },
          },
        ],
      },
      { error: null }, // bk-1 update (success)
      // bk-2's Stripe refund throws → no UPDATE issued for bk-2.
      { error: null }, // bk-3 update (success)
    ])

    mockStripeRefundCreate
      .mockResolvedValueOnce({ id: 're_1' })
      .mockRejectedValueOnce(new Error('card_declined'))
      .mockResolvedValueOnce({ id: 're_3' })
    mockSendEmail.mockResolvedValue({ success: true, messageId: 'm' })

    const result = await cancelEventAndRefundBookings('evt-1')

    expect(result.success).toBe(true)
    expect(result.summary!.refundedCount).toBe(2)
    expect(result.summary!.failedRefunds).toHaveLength(1)
    expect(result.summary!.failedRefunds[0]).toMatchObject({
      bookingId: 'bk-2',
      userEmail: 'b@example.com',
      error: expect.stringContaining('card_declined'),
    })
  })

  // The event is already cancelled — re-running the action should
  // still process bookings (resume after a partial-failure mid-loop).
  it('still iterates bookings when event.is_cancelled is already true', async () => {
    authenticateAdmin()
    mockFrom.mockImplementation(() => mockChain({ data: { role: 'admin' } }))

    queueAdminResponses([
      // is_cancelled = true already — skip the events.update step.
      {
        data: {
          id: 'evt-1',
          slug: 'wine-night',
          title: 'Wine Night',
          date_time: '2026-05-07T19:00:00Z',
          is_cancelled: true,
          deleted_at: null,
        },
      },
      // bookings.select
      {
        data: [
          {
            id: 'bk-1', user_id: 'u1', status: 'confirmed',
            price_at_booking: 2000, booking_fee_pence: 60,
            stripe_payment_id: 'pi_1', refunded_amount_pence: 0,
            waitlist_position: null,
            profile: { full_name: 'A', email: 'a@example.com' },
          },
        ],
      },
      { error: null }, // bk-1 update
    ])

    mockStripeRefundCreate.mockResolvedValue({ id: 're_resume' })
    mockSendEmail.mockResolvedValue({ success: true, messageId: 'm' })

    const result = await cancelEventAndRefundBookings('evt-1')
    expect(result.success).toBe(true)
    expect(result.summary!.refundedCount).toBe(1)
  })

  // Mixed bookings — confirmed/free, waitlisted, pending_payment all
  // get flipped to cancelled without a Stripe call.
  it('handles non-paid statuses (free / waitlisted / pending) without Stripe', async () => {
    authenticateAdmin()
    mockFrom.mockImplementation(() => mockChain({ data: { role: 'admin' } }))

    queueAdminResponses([
      {
        data: {
          id: 'evt-1',
          slug: 'run-club',
          title: 'Sunday Run Club',
          date_time: '2026-05-07T08:00:00Z',
          is_cancelled: false,
          deleted_at: null,
        },
      },
      { error: null }, // update is_cancelled
      {
        data: [
          {
            id: 'bk-free', user_id: 'u-free', status: 'confirmed',
            price_at_booking: 0, booking_fee_pence: 0,
            stripe_payment_id: null, refunded_amount_pence: 0,
            waitlist_position: null,
            profile: { full_name: 'F', email: 'f@example.com' },
          },
          {
            id: 'bk-wait', user_id: 'u-wait', status: 'waitlisted',
            price_at_booking: 2000, booking_fee_pence: 60,
            stripe_payment_id: null, refunded_amount_pence: 0,
            waitlist_position: 1,
            profile: { full_name: 'W', email: 'w@example.com' },
          },
          {
            id: 'bk-pend', user_id: 'u-pend', status: 'pending_payment',
            price_at_booking: 2000, booking_fee_pence: 60,
            stripe_payment_id: null, refunded_amount_pence: 0,
            waitlist_position: null,
            profile: { full_name: 'P', email: 'p@example.com' },
          },
        ],
      },
      { error: null }, // free update
      { error: null }, // waitlist update
      { error: null }, // pending update
    ])

    mockSendEmail.mockResolvedValue({ success: true, messageId: 'm' })

    const result = await cancelEventAndRefundBookings('evt-1')

    expect(result.success).toBe(true)
    expect(result.summary!.refundedCount).toBe(0)
    expect(result.summary!.cancelledFreeCount).toBe(1)
    expect(result.summary!.cancelledWaitlistCount).toBe(1)
    expect(result.summary!.cancelledPendingCount).toBe(1)
    // Stripe must NOT be touched for non-paid rows.
    expect(mockStripeRefundCreate).not.toHaveBeenCalled()
  })

  // Zero bookings — the action should still succeed (event flipped to
  // cancelled, summary all zeros).
  it('succeeds with zero affected bookings', async () => {
    authenticateAdmin()
    mockFrom.mockImplementation(() => mockChain({ data: { role: 'admin' } }))

    queueAdminResponses([
      {
        data: {
          id: 'evt-empty',
          slug: 'no-bookings',
          title: 'No Bookings Event',
          date_time: '2026-05-07T19:00:00Z',
          is_cancelled: false,
          deleted_at: null,
        },
      },
      { error: null },
      { data: [] },
    ])

    const result = await cancelEventAndRefundBookings('evt-empty')

    expect(result.success).toBe(true)
    expect(result.summary!.totalBookings).toBe(0)
    expect(result.summary!.refundedCount).toBe(0)
    expect(mockStripeRefundCreate).not.toHaveBeenCalled()
  })
})
