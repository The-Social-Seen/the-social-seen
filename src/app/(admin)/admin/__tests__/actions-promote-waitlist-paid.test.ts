import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Coverage for `promoteFromWaitlist`'s PAID-event branch specifically
 * (SYSTEM-DESIGN-admin-waitlist-promotion-payment.md §4.1). Split into its
 * own file — following this directory's existing convention of many
 * focused `actions-*.test.ts` files rather than growing the large shared
 * `actions.test.ts` — because it needs its own top-level mock of
 * `@/lib/bookings/admin-hold`, which the shared file's other describe
 * blocks have no reason to carry.
 *
 * This file tests the Server Action's OWN branching/wiring logic
 * (does it call createAdminBookingHold with the right args? does it
 * correctly propagate success/failure? does it skip the free-path
 * capacity logic entirely on the paid branch?). createAdminBookingHold's
 * OWN internals (RPC call, Stripe, the rollback) are covered directly in
 * src/lib/bookings/__tests__/admin-hold.test.ts — deliberately not
 * re-tested here, mirroring how claimWaitlistSpot's tests in
 * events/[slug]/__tests__/actions.test.ts mock @/lib/stripe/checkout
 * wholesale rather than re-testing Stripe internals.
 */

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

const mockCreateAdminBookingHold = vi.fn()
vi.mock('@/lib/bookings/admin-hold', () => ({
  createAdminBookingHold: (...args: unknown[]) => mockCreateAdminBookingHold(...args),
}))

import { revalidatePath } from 'next/cache'
import { promoteFromWaitlist } from '../actions'

// ── Helpers (mirrors actions.test.ts / actions-moderation.test.ts) ─────────

function authenticateAdmin(userId = 'admin-1') {
  mockGetUser.mockResolvedValue({ data: { user: { id: userId } }, error: null })
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

/** First from() call is always requireAdmin's profiles.role read. */
function mockAdminWithSequence(
  responses: Array<{ data?: unknown; error?: unknown; count?: number | null }>,
  userId = 'admin-1',
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

beforeEach(() => {
  vi.clearAllMocks()
})

// ════════════════════════════════════════════════════════════════════════════
// Branch selection: price !== 0 routes to createAdminBookingHold
// ════════════════════════════════════════════════════════════════════════════

describe('promoteFromWaitlist — paid-event branch selection', () => {
  it('calls createAdminBookingHold for a paid event (price !== 0), NEVER touches the free-path confirm UPDATE', async () => {
    mockAdminWithSequence([
      { data: { id: 'bk-1', event_id: 'evt-1', user_id: 'u-1', status: 'waitlisted' } },
      { data: { id: 'evt-1', slug: 'wine-tasting', capacity: 20, price: 2000 } },
      { data: { full_name: 'Amy Sangam' } }, // promotedName fetch (paid branch's own)
    ])
    mockCreateAdminBookingHold.mockResolvedValue({
      success: true,
      status: 'pending_payment',
      checkoutUrl: 'https://checkout.stripe.test/cs_mock',
      holdExpiresAt: null,
    })

    const result = await promoteFromWaitlist('bk-1')

    expect(mockCreateAdminBookingHold).toHaveBeenCalledTimes(1)
    expect(result.success).toBe(true)
    // The free-path's status='confirmed' UPDATE must never fire on this
    // branch — assert no update call carries that payload shape.
    const allChainReturns = (mockFrom as ReturnType<typeof vi.fn>).mock.results
    // (Sanity via call count instead of chain inspection: paid-success
    // path issues exactly 3 supabase.from() calls after the admin-role
    // check — booking fetch, event fetch, promotedName profile fetch.
    // The free path would additionally issue a 4th "count seats" call
    // and a 5th "update booking" call before ever reaching profile
    // fetch, so a 3-call total is itself proof the free-path code never
    // ran.)
    expect(allChainReturns.length).toBe(4) // admin-role-check + 3 above
  })

  it('hardcodes holdExpiresAt: null for every paid promotion in this PR (systemic-slice cron is deliberately out of scope)', async () => {
    // Per the task brief: "do not add tests expecting an auto-revert-
    // after-4-hours behavior to exist yet — it doesn't, by design."
    // computeHoldExpiresAt exists (src/lib/bookings/admin-hold.ts) but is
    // NOT called from promoteFromWaitlist yet — pin the literal null.
    mockAdminWithSequence([
      { data: { id: 'bk-1', event_id: 'evt-1', user_id: 'u-1', status: 'waitlisted' } },
      { data: { id: 'evt-1', slug: 'wine-tasting', capacity: 20, price: 2000 } },
      { data: { full_name: 'Amy Sangam' } },
    ])
    mockCreateAdminBookingHold.mockResolvedValue({
      success: true,
      status: 'pending_payment',
      checkoutUrl: 'https://checkout.stripe.test/cs_mock',
      holdExpiresAt: null,
    })

    await promoteFromWaitlist('bk-1')

    expect(mockCreateAdminBookingHold).toHaveBeenCalledWith(
      expect.anything(), // the user-scoped supabase client from requireAdmin()
      'bk-1',
      { holdExpiresAt: null },
    )
  })

  it('does NOT call createAdminBookingHold for a free event (price === 0)', async () => {
    mockAdminWithSequence([
      { data: { id: 'bk-1', event_id: 'evt-1', user_id: 'u-1', status: 'waitlisted' } },
      { data: { id: 'evt-1', slug: 'run-club', capacity: 20, price: 0 } },
      { count: 5 },
      { error: null },
      { data: { full_name: 'Charlotte' } },
    ])

    const result = await promoteFromWaitlist('bk-1')

    expect(mockCreateAdminBookingHold).not.toHaveBeenCalled()
    expect(result.success).toBe(true)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Success response shape
// ════════════════════════════════════════════════════════════════════════════

describe('promoteFromWaitlist — paid-event success response', () => {
  it('returns {success:true, status:"pending_payment", promotedName, holdExpiresAt} on success', async () => {
    mockAdminWithSequence([
      { data: { id: 'bk-1', event_id: 'evt-1', user_id: 'u-1', status: 'waitlisted' } },
      { data: { id: 'evt-1', slug: 'wine-tasting', capacity: 20, price: 2000 } },
      { data: { full_name: 'Amy Sangam' } },
    ])
    mockCreateAdminBookingHold.mockResolvedValue({
      success: true,
      status: 'pending_payment',
      checkoutUrl: 'https://checkout.stripe.test/cs_mock',
      holdExpiresAt: null,
    })

    const result = await promoteFromWaitlist('bk-1')

    expect(result).toEqual({
      success: true,
      promotedName: 'Amy Sangam',
      status: 'pending_payment',
      holdExpiresAt: null,
    })
  })

  it('falls back to "Member" as promotedName when the profile fetch fails', async () => {
    mockAdminWithSequence([
      { data: { id: 'bk-1', event_id: 'evt-1', user_id: 'u-1', status: 'waitlisted' } },
      { data: { id: 'evt-1', slug: 'wine-tasting', capacity: 20, price: 2000 } },
      { data: null, error: { message: 'not found' } },
    ])
    mockCreateAdminBookingHold.mockResolvedValue({
      success: true,
      status: 'pending_payment',
      checkoutUrl: 'https://checkout.stripe.test/cs_mock',
      holdExpiresAt: null,
    })

    const result = await promoteFromWaitlist('bk-1')

    expect(result.promotedName).toBe('Member')
  })

  it('revalidates /admin/events, /events/<slug>, and /bookings on success', async () => {
    mockAdminWithSequence([
      { data: { id: 'bk-1', event_id: 'evt-1', user_id: 'u-1', status: 'waitlisted' } },
      { data: { id: 'evt-1', slug: 'wine-tasting', capacity: 20, price: 2000 } },
      { data: { full_name: 'Amy Sangam' } },
    ])
    mockCreateAdminBookingHold.mockResolvedValue({
      success: true,
      status: 'pending_payment',
      checkoutUrl: 'https://checkout.stripe.test/cs_mock',
      holdExpiresAt: null,
    })

    await promoteFromWaitlist('bk-1')

    expect(revalidatePath).toHaveBeenCalledWith('/admin/events')
    expect(revalidatePath).toHaveBeenCalledWith('/events/wine-tasting')
    expect(revalidatePath).toHaveBeenCalledWith('/bookings')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Failure propagation
// ════════════════════════════════════════════════════════════════════════════

describe('promoteFromWaitlist — paid-event failure propagation', () => {
  it('propagates createAdminBookingHold\'s error VERBATIM (e.g. the capacity-fix regression message)', async () => {
    mockAdminWithSequence([
      { data: { id: 'bk-1', event_id: 'evt-1', user_id: 'u-1', status: 'waitlisted' } },
      { data: { id: 'evt-1', slug: 'wine-tasting', capacity: 20, price: 2000 } },
    ])
    mockCreateAdminBookingHold.mockResolvedValue({
      success: false,
      error: 'Event is at full capacity — cannot promote',
    })

    const result = await promoteFromWaitlist('bk-1')

    expect(result).toEqual({ error: 'Event is at full capacity — cannot promote' })
  })

  it('does NOT fetch a promotedName profile or revalidate anything when createAdminBookingHold fails', async () => {
    mockAdminWithSequence([
      { data: { id: 'bk-1', event_id: 'evt-1', user_id: 'u-1', status: 'waitlisted' } },
      { data: { id: 'evt-1', slug: 'wine-tasting', capacity: 20, price: 2000 } },
    ])
    mockCreateAdminBookingHold.mockResolvedValue({
      success: false,
      error: 'Could not start checkout. Please try again.',
    })

    await promoteFromWaitlist('bk-1')

    // Only 2 real supabase.from() calls after the admin-role check
    // (booking fetch, event fetch) — the promotedName profile fetch that
    // follows a SUCCESSFUL hold must not have fired.
    const allChainReturns = (mockFrom as ReturnType<typeof vi.fn>).mock.results
    expect(allChainReturns.length).toBe(3) // admin-role-check + 2 above
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('does NOT fall through to the free-path capacity check / confirm UPDATE when the paid branch fails', async () => {
    mockAdminWithSequence([
      { data: { id: 'bk-1', event_id: 'evt-1', user_id: 'u-1', status: 'waitlisted' } },
      { data: { id: 'evt-1', slug: 'wine-tasting', capacity: 20, price: 2000 } },
    ])
    mockCreateAdminBookingHold.mockResolvedValue({
      success: false,
      error: 'Something went wrong. Please try again.',
    })

    const result = await promoteFromWaitlist('bk-1')

    // If the free-path ran too, result would carry success:true from the
    // (mis-sequenced) fallthrough — pin the actual error-only shape.
    expect(result).toEqual({ error: 'Something went wrong. Please try again.' })
    expect(result).not.toHaveProperty('success')
  })
})
