import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Coverage for `abandonPendingCheckout` (src/app/events/[slug]/actions.ts).
 * This function previously had ZERO test coverage in the repo — this file
 * covers both its pre-existing 'book'/'claim' behaviour (regression
 * safety net), the 'admin_hold' option added by
 * SYSTEM-DESIGN-admin-waitlist-promotion-payment.md §5 site #2, and the
 * 'admin_remediation' option added by that same doc's same-day Addendum
 * (§Addendum-D / fix #2 in the PR description) — THE actual bug that was
 * found and fixed mid-implementation: a generic `from=admin_hold` would
 * have wrongly sent a payment-remediation abandon to `waitlisted` instead
 * of back to `confirmed`, silently recreating the exact
 * confirmed-without-payment incident this whole feature exists to fix.
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

  it("INVARIANT: from: 'admin_remediation' -> rolls back to 'confirmed' (NOT 'waitlisted', NOT 'cancelled') AND clears both hold columns", async () => {
    // THE bug that got fixed mid-implementation (task brief: "a generic
    // from=admin_hold would have wrongly sent a payment-remediation
    // abandon to waitlisted instead of back to confirmed"). This member's
    // booking was CONFIRMED (unpaid) this whole cycle via an admin
    // payment-remediation hold — they were never on the waitlist. If they
    // click "<- Back" out of Stripe, rolling back to 'waitlisted' here
    // would silently recreate a DIFFERENT bad state (a real member with a
    // real seat, incorrectly told they need to wait for one), and rolling
    // back to 'cancelled' would take away a seat they are legitimately
    // entitled to. 'confirmed' (unpaid, exactly where they started) is
    // the only honest rollback.
    authenticateUser('user-1')
    const chain = mockUpdateChain({ data: null, error: null })

    const result = await abandonPendingCheckout('evt-1', { from: 'admin_remediation' })

    expect(result.success).toBe(true)
    expect(chain.update).toHaveBeenCalledWith({
      status: 'confirmed',
      is_admin_hold: false,
      admin_hold_expires_at: null,
    })
  })

  it("CROSS-CHECK: all four 'from' values map to genuinely distinct rollback statuses where the spec says so (book/cancelled, claim/waitlisted, admin_hold/waitlisted, admin_remediation/confirmed)", async () => {
    // Guards against the specific regression this test file exists to
    // catch: a copy-paste that leaves 'admin_hold' and 'admin_remediation'
    // sharing the same rollback status (they must NOT — see the INVARIANT
    // test above), while 'claim' and 'admin_hold' correctly DO share
    // 'waitlisted' (that part is intentional, per spec §5 site #2).
    authenticateUser('user-1')

    async function rollbackStatusFor(from?: 'book' | 'claim' | 'admin_hold' | 'admin_remediation') {
      const chain = mockUpdateChain({ data: null, error: null })
      await abandonPendingCheckout('evt-1', from ? { from } : undefined)
      const payload = (chain.update as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
        status: string
      }
      return payload.status
    }

    expect(await rollbackStatusFor('book')).toBe('cancelled')
    expect(await rollbackStatusFor('claim')).toBe('waitlisted')
    expect(await rollbackStatusFor('admin_hold')).toBe('waitlisted')
    expect(await rollbackStatusFor('admin_remediation')).toBe('confirmed')

    // The one pair that must NEVER match — this is the exact bug shape.
    const claimStatus = await rollbackStatusFor('claim')
    const remediationStatus = await rollbackStatusFor('admin_remediation')
    expect(remediationStatus).not.toBe(claimStatus)
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

  it("clears both columns on the 'admin_remediation' path too (required — the row would otherwise violate chk_bookings_admin_hold_requires_pending_payment the instant status leaves pending_payment)", async () => {
    authenticateUser('user-1')
    const chain = mockUpdateChain({ data: null, error: null })

    await abandonPendingCheckout('evt-1', { from: 'admin_remediation' })

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
