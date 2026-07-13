import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Coverage for `abandonPendingCheckout` (src/app/events/[slug]/actions.ts).
 * This function previously had ZERO test coverage in the repo — this file
 * covers both its pre-existing 'book'/'claim' behaviour (regression
 * safety net) and the new 'admin_hold' option added by
 * SYSTEM-DESIGN-admin-waitlist-promotion-payment.md §5 site #2.
 */

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

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { abandonPendingCheckout } from '../actions'

// ── Helpers ────────────────────────────────────────────────────────────────

function authenticateUser(userId = 'user-1') {
  mockGetUser.mockResolvedValue({ data: { user: { id: userId } }, error: null })
}

function unauthenticateUser() {
  mockGetUser.mockResolvedValue({
    data: { user: null },
    error: { message: 'Not authenticated' },
  })
}

/**
 * Chainable mock mirroring the PostgREST builder pattern used throughout
 * this codebase's tests. Captures every `.eq(...)` call so tests can
 * assert the exact filter set applied to the UPDATE.
 */
function mockUpdateChain(response: { data?: unknown; error?: unknown }) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {}
  const methods = ['update', 'eq', 'is']
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain)
  }
  chain.then = vi.fn((resolve: (v: unknown) => void) => resolve(response))
  mockFrom.mockReturnValue(chain)
  return chain
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ════════════════════════════════════════════════════════════════════════════
// Input validation / auth
// ════════════════════════════════════════════════════════════════════════════

describe('abandonPendingCheckout — validation and auth', () => {
  it('returns an error when eventId is empty', async () => {
    const result = await abandonPendingCheckout('')
    expect(result.success).toBe(false)
    expect(result.error).toBe('Event ID is required')
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('returns an error when the user is not authenticated', async () => {
    unauthenticateUser()
    const result = await abandonPendingCheckout('evt-1')
    expect(result.success).toBe(false)
    expect(result.error).toBe('Authentication required')
    expect(mockFrom).not.toHaveBeenCalled()
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Rollback status per `from` value
// ════════════════════════════════════════════════════════════════════════════

describe('abandonPendingCheckout — rollback status per `from` value', () => {
  it("from omitted (default) → rolls back to 'cancelled'", async () => {
    authenticateUser('user-1')
    const chain = mockUpdateChain({ data: null, error: null })

    const result = await abandonPendingCheckout('evt-1')

    expect(result.success).toBe(true)
    expect(chain.update).toHaveBeenCalledWith({
      status: 'cancelled',
      is_admin_hold: false,
      admin_hold_expires_at: null,
    })
  })

  it("from: 'book' → rolls back to 'cancelled' (explicit form of the default)", async () => {
    authenticateUser('user-1')
    const chain = mockUpdateChain({ data: null, error: null })

    await abandonPendingCheckout('evt-1', { from: 'book' })

    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'cancelled' }),
    )
  })

  it("from: 'claim' → rolls back to 'waitlisted' (preserves waitlist queue position)", async () => {
    authenticateUser('user-1')
    const chain = mockUpdateChain({ data: null, error: null })

    await abandonPendingCheckout('evt-1', { from: 'claim' })

    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'waitlisted' }),
    )
  })

  it("INVARIANT: from: 'admin_hold' → rolls back to 'waitlisted' (NOT 'cancelled') AND clears both hold columns", async () => {
    // This is the core new-behaviour test (spec §5 site #2). An admin
    // promoted this member off the waitlist and sent them a payment
    // link; if they click "← Back" out of Stripe, they must land back on
    // the waitlist at their frozen position — losing their spot entirely
    // because Stripe hiccuped (or they just wanted more time to decide)
    // would be a strictly worse outcome than the bug this whole feature
    // fixes.
    authenticateUser('user-1')
    const chain = mockUpdateChain({ data: null, error: null })

    const result = await abandonPendingCheckout('evt-1', { from: 'admin_hold' })

    expect(result.success).toBe(true)
    expect(chain.update).toHaveBeenCalledWith({
      status: 'waitlisted',
      is_admin_hold: false,
      admin_hold_expires_at: null,
    })
  })

  it('an unrecognised `from` string falls back to the default cancelled behaviour (defensive)', async () => {
    authenticateUser('user-1')
    const chain = mockUpdateChain({ data: null, error: null })

    // @ts-expect-error — deliberately passing an invalid value to prove
    // the ternary's fallback branch, not just its two named cases.
    await abandonPendingCheckout('evt-1', { from: 'something-unexpected' })

    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'cancelled' }),
    )
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Hold-column clearing (chk_bookings_admin_hold_requires_pending_payment
// safety net) — every branch must clear both columns unconditionally.
// ════════════════════════════════════════════════════════════════════════════

describe('abandonPendingCheckout — is_admin_hold / admin_hold_expires_at are ALWAYS cleared', () => {
  it("clears both columns even on the 'book' (default) path, where they were already false/null (harmless no-op)", async () => {
    authenticateUser('user-1')
    const chain = mockUpdateChain({ data: null, error: null })

    await abandonPendingCheckout('evt-1', { from: 'book' })

    const payload = (chain.update as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<
      string,
      unknown
    >
    expect(payload.is_admin_hold).toBe(false)
    expect(payload.admin_hold_expires_at).toBeNull()
  })

  it("clears both columns on the 'claim' path too", async () => {
    authenticateUser('user-1')
    const chain = mockUpdateChain({ data: null, error: null })

    await abandonPendingCheckout('evt-1', { from: 'claim' })

    const payload = (chain.update as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<
      string,
      unknown
    >
    expect(payload.is_admin_hold).toBe(false)
    expect(payload.admin_hold_expires_at).toBeNull()
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Row scoping / authorisation
// ════════════════════════════════════════════════════════════════════════════

describe('abandonPendingCheckout — row scoping', () => {
  it('INVARIANT: the UPDATE is scoped to the CALLER\'s own user_id — cannot be pointed at another user\'s booking', async () => {
    authenticateUser('user-1')
    const chain = mockUpdateChain({ data: null, error: null })

    await abandonPendingCheckout('evt-1')

    expect(chain.eq).toHaveBeenCalledWith('user_id', 'user-1')
  })

  it('the UPDATE is scoped to the given event_id', async () => {
    authenticateUser('user-1')
    const chain = mockUpdateChain({ data: null, error: null })

    await abandonPendingCheckout('evt-42')

    expect(chain.eq).toHaveBeenCalledWith('event_id', 'evt-42')
  })

  it('the UPDATE is guarded by status = pending_payment (idempotent optimistic guard)', async () => {
    authenticateUser('user-1')
    const chain = mockUpdateChain({ data: null, error: null })

    await abandonPendingCheckout('evt-1')

    expect(chain.eq).toHaveBeenCalledWith('status', 'pending_payment')
  })

  it('the UPDATE excludes soft-deleted rows (deleted_at IS NULL)', async () => {
    authenticateUser('user-1')
    const chain = mockUpdateChain({ data: null, error: null })

    await abandonPendingCheckout('evt-1')

    expect(chain.is).toHaveBeenCalledWith('deleted_at', null)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Idempotency / error handling
// ════════════════════════════════════════════════════════════════════════════

describe('abandonPendingCheckout — idempotency and errors', () => {
  it('a repeat call that matches zero rows (already resolved) still returns success (no-op is not an error)', async () => {
    authenticateUser('user-1')
    // Supabase resolves with no error even when zero rows match a bare
    // .update().eq()... chain (no .select() to report affected rows).
    mockUpdateChain({ data: null, error: null })

    const result = await abandonPendingCheckout('evt-1', { from: 'admin_hold' })

    expect(result).toEqual({ success: true })
  })

  it('returns a generic error and does not throw when the UPDATE itself errors', async () => {
    authenticateUser('user-1')
    mockUpdateChain({ data: null, error: { message: 'db unreachable' } })

    const result = await abandonPendingCheckout('evt-1')

    expect(result.success).toBe(false)
    expect(result.error).toBe('Could not release the booking')
  })
})
