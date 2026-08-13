import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Coverage for the Stripe-failure rollback paths inside `createPaidCheckout`
 * and `claimWaitlistSpot` (src/app/events/[slug]/actions.ts).
 *
 * Prior to this migration/PR pair, both functions rolled the just-inserted
 * booking back with a raw `supabase.from('bookings').update({...})` call
 * against the user-scoped client — a direct write to `status` that the
 * bookings-write-authorization-hardening effort is closing off entirely.
 * Both call sites now repoint at the ALREADY-SHIPPED, ALREADY-TESTED
 * `abandon_pending_checkout` SECURITY DEFINER RPC (see
 * docs/SYSTEM-DESIGN-bookings-write-authorization-hardening.md §3.1 and
 * `abandon-pending-checkout.test.ts`, which covers the RPC wrapper's own
 * behaviour in depth). This file is the missing CALLER-side coverage: does
 * each function actually invoke the rollback, with the right args, when
 * Stripe blows up mid-checkout?
 *
 * Zero test coverage existed for this branch either direction before this
 * file (confirmed via grep by backend-developer).
 */

// ── Mocks ──────────────────────────────────────────────────────────────────

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

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>()
  return {
    ...actual,
    after: (fn: () => unknown | Promise<unknown>) => {
      void Promise.resolve(fn())
    },
  }
})

vi.mock('next/headers', () => ({
  headers: async () =>
    new Headers({ 'x-forwarded-host': 'localhost:6500', 'x-forwarded-proto': 'http' }),
}))

const mockSendEmail = vi.fn()
vi.mock('@/lib/email/send', () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
}))

const mockSentryCapture = vi.fn()
vi.mock('@sentry/nextjs', () => ({
  captureException: (...args: unknown[]) => mockSentryCapture(...args),
}))

// createAdminClient is used for ensureStripeCustomer's lazy-create AND for
// notifyWaitlistersOfOpenSpot — neither is reached on the failure paths
// under test here, but createPaidCheckout/claimWaitlistSpot both call
// createAdminClient() before the Stripe call, so it must exist.
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => {
    const chain: Record<string, unknown> = {}
    const methods = ['select', 'eq', 'is', 'single', 'maybeSingle', 'limit', 'order']
    for (const m of methods) {
      ;(chain as Record<string, ReturnType<typeof vi.fn>>)[m] = vi
        .fn()
        .mockReturnValue(chain)
    }
    ;(chain as Record<string, unknown>).then = (resolve: (v: unknown) => void) =>
      resolve({ data: [], error: null })
    return { from: vi.fn(() => chain) }
  },
}))

// The Stripe-failure trigger: ensureStripeCustomer resolves fine, but
// createBookingCheckoutSession throws (simulating a Stripe API outage /
// timeout / malformed response).
const mockEnsureStripeCustomer = vi.fn()
const mockCreateBookingCheckoutSession = vi.fn()
vi.mock('@/lib/stripe/checkout', () => ({
  ensureStripeCustomer: (...args: unknown[]) => mockEnsureStripeCustomer(...args),
  createBookingCheckoutSession: (...args: unknown[]) =>
    mockCreateBookingCheckoutSession(...args),
}))

import { createPaidCheckout, claimWaitlistSpot } from '../actions'

// ── Helpers ────────────────────────────────────────────────────────────────

function authenticateUser(userId = 'user-1') {
  mockGetUser.mockResolvedValue({ data: { user: { id: userId } }, error: null })
}

/**
 * Chainable mock mirroring Supabase's PostgREST builder. Every call
 * resolves to the same `response`.
 */
function mockSupabaseChain(response: { data?: unknown; error?: unknown }) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {}
  const methods = [
    'select', 'insert', 'update', 'delete',
    'eq', 'neq', 'is', 'single', 'maybeSingle',
    'order', 'limit',
  ]
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain)
  }
  chain.then = vi.fn((resolve: (v: unknown) => void) => resolve(response))
  mockFrom.mockReturnValue(chain)
  return chain
}

beforeEach(() => {
  vi.clearAllMocks()
  mockEnsureStripeCustomer.mockResolvedValue('cus_mock')
})

// ════════════════════════════════════════════════════════════════════════════
// createPaidCheckout — Stripe-failure rollback
// ════════════════════════════════════════════════════════════════════════════

describe('createPaidCheckout — Stripe-failure rollback', () => {
  // INVARIANT: if Stripe Checkout Session creation fails after
  // book_event_paid has already inserted a pending_payment row, that row
  // MUST be rolled back via the abandon_pending_checkout RPC (never a
  // direct table write) so the seat is freed for other members. A rollback
  // that silently no-ops would strand the row in pending_payment forever,
  // permanently occupying a capacity slot for a booking nobody can pay for.
  it('rolls back the fresh pending_payment booking via abandon_pending_checkout when Stripe throws', async () => {
    authenticateUser('user-1')

    let fromCallCount = 0
    mockFrom.mockImplementation(() => {
      fromCallCount++
      const chain: Record<string, ReturnType<typeof vi.fn>> = {}
      const methods = ['select', 'eq', 'neq', 'is', 'single', 'maybeSingle', 'order', 'limit', 'update']
      for (const m of methods) chain[m] = vi.fn().mockReturnValue(chain)

      if (fromCallCount === 1) {
        // Event fetch (fee calc)
        chain.then = vi.fn((resolve: (v: unknown) => void) =>
          resolve({ data: { title: 'Wine Tasting', slug: 'wine-tasting', price: 3500 }, error: null }),
        )
      } else {
        // Profile fetch for Stripe Customer
        chain.then = vi.fn((resolve: (v: unknown) => void) =>
          resolve({ data: { full_name: 'Charlotte Moreau', email: 'charlotte@example.com' }, error: null }),
        )
      }
      return chain
    })

    // book_event_paid → fresh pending_payment row.
    mockRpc.mockImplementation((fn: string) => {
      if (fn === 'book_event_paid') {
        return Promise.resolve({
          data: { booking_id: 'bk-pending', status: 'pending_payment', waitlist_position: null },
          error: null,
        })
      }
      if (fn === 'abandon_pending_checkout') {
        return Promise.resolve({
          data: { booking_id: 'bk-pending', status: 'cancelled' },
          error: null,
        })
      }
      throw new Error(`Unexpected RPC: ${fn}`)
    })

    // Stripe blows up mid-checkout.
    mockCreateBookingCheckoutSession.mockRejectedValueOnce(new Error('Stripe API timeout'))

    const result = await createPaidCheckout('evt-1')

    expect(result.success).toBe(false)
    expect(result.error).toBe('Could not start checkout. Please try again.')

    // INVARIANT: the rollback RPC must be called with the caller's OWN
    // user id (from the authenticated session), never any client-suppliable
    // value, and the event id already in scope — no bookingId/status is
    // passed, matching abandon_pending_checkout's own {p_user_id, p_event_id}
    // signature (the RPC re-derives which row to roll back server-side).
    expect(mockRpc).toHaveBeenCalledWith('abandon_pending_checkout', {
      p_user_id: 'user-1',
      p_event_id: 'evt-1',
    })
  })

  it('reports the generic error and does NOT throw when the rollback RPC itself errors (Stripe down AND DB unreachable)', async () => {
    // Double failure: Stripe fails, then the rollback RPC also fails. The
    // action must still return a clean error response to the caller
    // instead of propagating an unhandled rejection — the failure is
    // logged (console.error) for an operator to reconcile manually, not
    // swallowed silently and not crashed on.
    authenticateUser('user-1')
    let fromCallCount = 0
    mockFrom.mockImplementation(() => {
      fromCallCount++
      const chain: Record<string, ReturnType<typeof vi.fn>> = {}
      const methods = ['select', 'eq', 'neq', 'is', 'single', 'maybeSingle', 'order', 'limit', 'update']
      for (const m of methods) chain[m] = vi.fn().mockReturnValue(chain)
      if (fromCallCount === 1) {
        chain.then = vi.fn((resolve: (v: unknown) => void) =>
          resolve({ data: { title: 'Wine Tasting', slug: 'wine-tasting', price: 3500 }, error: null }),
        )
      } else {
        chain.then = vi.fn((resolve: (v: unknown) => void) =>
          resolve({ data: { full_name: 'Charlotte Moreau', email: 'charlotte@example.com' }, error: null }),
        )
      }
      return chain
    })

    mockRpc.mockImplementation((fn: string) => {
      if (fn === 'book_event_paid') {
        return Promise.resolve({
          data: { booking_id: 'bk-pending', status: 'pending_payment', waitlist_position: null },
          error: null,
        })
      }
      if (fn === 'abandon_pending_checkout') {
        return Promise.resolve({ data: null, error: { message: 'connection reset' } })
      }
      throw new Error(`Unexpected RPC: ${fn}`)
    })
    mockCreateBookingCheckoutSession.mockRejectedValueOnce(new Error('Stripe API timeout'))

    await expect(createPaidCheckout('evt-1')).resolves.toEqual({
      success: false,
      error: 'Could not start checkout. Please try again.',
    })
  })

  it('captures the Stripe failure via Sentry with surface=createPaidCheckout before rolling back', async () => {
    authenticateUser('user-1')
    let fromCallCount = 0
    mockFrom.mockImplementation(() => {
      fromCallCount++
      const chain: Record<string, ReturnType<typeof vi.fn>> = {}
      const methods = ['select', 'eq', 'neq', 'is', 'single', 'maybeSingle', 'order', 'limit', 'update']
      for (const m of methods) chain[m] = vi.fn().mockReturnValue(chain)
      if (fromCallCount === 1) {
        chain.then = vi.fn((resolve: (v: unknown) => void) =>
          resolve({ data: { title: 'Wine Tasting', slug: 'wine-tasting', price: 3500 }, error: null }),
        )
      } else {
        chain.then = vi.fn((resolve: (v: unknown) => void) =>
          resolve({ data: { full_name: 'Charlotte Moreau', email: 'charlotte@example.com' }, error: null }),
        )
      }
      return chain
    })
    mockRpc.mockImplementation((fn: string) => {
      if (fn === 'book_event_paid') {
        return Promise.resolve({
          data: { booking_id: 'bk-pending', status: 'pending_payment', waitlist_position: null },
          error: null,
        })
      }
      return Promise.resolve({ data: { booking_id: 'bk-pending', status: 'cancelled' }, error: null })
    })
    const stripeErr = new Error('Stripe API timeout')
    mockCreateBookingCheckoutSession.mockRejectedValueOnce(stripeErr)

    await createPaidCheckout('evt-1')

    expect(mockSentryCapture).toHaveBeenCalledWith(
      stripeErr,
      expect.objectContaining({
        tags: { surface: 'createPaidCheckout' },
        extra: expect.objectContaining({ bookingId: 'bk-pending', eventId: 'evt-1', userId: 'user-1' }),
      }),
    )
  })
})

// ════════════════════════════════════════════════════════════════════════════
// claimWaitlistSpot — Stripe-failure rollback
// ════════════════════════════════════════════════════════════════════════════

describe('claimWaitlistSpot — Stripe-failure rollback', () => {
  // INVARIANT: claim_waitlist_spot has already transitioned the caller's
  // booking from waitlisted -> pending_payment when Stripe fails. That
  // booking MUST be restored via abandon_pending_checkout (not cancelled
  // outright) so the member doesn't lose their place in the waitlist just
  // because Stripe hiccuped.
  it('restores the booking via abandon_pending_checkout when Stripe throws mid-claim', async () => {
    authenticateUser('user-1')

    let fromCallCount = 0
    mockFrom.mockImplementation(() => {
      fromCallCount++
      const chain: Record<string, ReturnType<typeof vi.fn>> = {}
      const methods = ['select', 'eq', 'neq', 'is', 'single', 'maybeSingle', 'order', 'limit', 'update']
      for (const m of methods) chain[m] = vi.fn().mockReturnValue(chain)

      if (fromCallCount === 1) {
        // Event fetch (fee calc)
        chain.then = vi.fn((resolve: (v: unknown) => void) =>
          resolve({ data: { title: 'Wine Tasting', slug: 'wine-tasting', price: 2000 }, error: null }),
        )
      } else {
        // Profile fetch for Stripe Customer
        chain.then = vi.fn((resolve: (v: unknown) => void) =>
          resolve({ data: { full_name: 'James Okafor', email: 'james@example.com' }, error: null }),
        )
      }
      return chain
    })

    mockRpc.mockImplementation((fn: string) => {
      if (fn === 'claim_waitlist_spot') {
        return Promise.resolve({
          data: { booking_id: 'bk-claim', status: 'pending_payment' },
          error: null,
        })
      }
      if (fn === 'abandon_pending_checkout') {
        return Promise.resolve({
          data: { booking_id: 'bk-claim', status: 'waitlisted' },
          error: null,
        })
      }
      throw new Error(`Unexpected RPC: ${fn}`)
    })

    mockCreateBookingCheckoutSession.mockRejectedValueOnce(new Error('Stripe API timeout'))

    const result = await claimWaitlistSpot('evt-1')

    expect(result.success).toBe(false)
    expect(result.error).toBe('Could not start checkout. Please try again.')

    // INVARIANT: rollback called with the caller's OWN user id from the
    // authenticated session — never any client-suppliable value.
    expect(mockRpc).toHaveBeenCalledWith('abandon_pending_checkout', {
      p_user_id: 'user-1',
      p_event_id: 'evt-1',
    })
  })

  it('does not throw when the rollback RPC itself errors after a Stripe failure on claim', async () => {
    authenticateUser('user-1')
    let fromCallCount = 0
    mockFrom.mockImplementation(() => {
      fromCallCount++
      const chain: Record<string, ReturnType<typeof vi.fn>> = {}
      const methods = ['select', 'eq', 'neq', 'is', 'single', 'maybeSingle', 'order', 'limit', 'update']
      for (const m of methods) chain[m] = vi.fn().mockReturnValue(chain)
      if (fromCallCount === 1) {
        chain.then = vi.fn((resolve: (v: unknown) => void) =>
          resolve({ data: { title: 'Wine Tasting', slug: 'wine-tasting', price: 2000 }, error: null }),
        )
      } else {
        chain.then = vi.fn((resolve: (v: unknown) => void) =>
          resolve({ data: { full_name: 'James Okafor', email: 'james@example.com' }, error: null }),
        )
      }
      return chain
    })

    mockRpc.mockImplementation((fn: string) => {
      if (fn === 'claim_waitlist_spot') {
        return Promise.resolve({
          data: { booking_id: 'bk-claim', status: 'pending_payment' },
          error: null,
        })
      }
      if (fn === 'abandon_pending_checkout') {
        return Promise.resolve({ data: null, error: { message: 'connection reset' } })
      }
      throw new Error(`Unexpected RPC: ${fn}`)
    })
    mockCreateBookingCheckoutSession.mockRejectedValueOnce(new Error('Stripe API timeout'))

    await expect(claimWaitlistSpot('evt-1')).resolves.toEqual({
      success: false,
      error: 'Could not start checkout. Please try again.',
    })
  })

  it('does NOT roll back (or call Stripe at all) when claim_waitlist_spot resolves the claim as a free-event confirm', async () => {
    // Sanity/negative case: the rollback path is reachable only via the
    // pending_payment (paid) branch. A free-event claim confirms directly
    // and must never touch Stripe or the rollback RPC.
    authenticateUser('user-1')
    mockSupabaseChain({ data: { title: 'Sunday Run Club', slug: 'sunday-run', price: 0 }, error: null })
    mockRpc.mockResolvedValueOnce({
      data: { booking_id: 'bk-free', status: 'confirmed' },
      error: null,
    })

    const result = await claimWaitlistSpot('evt-1')

    expect(result.success).toBe(true)
    expect(mockCreateBookingCheckoutSession).not.toHaveBeenCalled()
    expect(mockRpc).not.toHaveBeenCalledWith('abandon_pending_checkout', expect.anything())
  })
})
