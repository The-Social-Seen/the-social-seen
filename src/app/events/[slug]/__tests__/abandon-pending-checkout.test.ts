import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Coverage for `abandonPendingCheckout` (src/app/events/[slug]/actions.ts).
 *
 * ── Why this file was rewritten (again) ─────────────────────────────────
 *
 * Round 1: this function trusted the caller-supplied `options.from` string
 * directly for the rollback decision — a live P0 vulnerability (a member
 * could spoof `?from=admin_remediation` and get a free confirmed ticket).
 *
 * Round 2: fixed by deriving `rollbackStatus` from three tamper-proof
 * columns (`is_admin_hold`, `cancelled_at`, `waitlist_position`) fetched via
 * a plain TS SELECT-then-UPDATE against the user-scoped client. That fix's
 * OWN trust model was then found tamperable via a direct REST `PATCH` of
 * `is_admin_hold`/`admin_hold_expires_at` — closed by
 * `20260812171530_revoke_bookings_admin_hold_column_write.sql`, which
 * REVOKEs UPDATE on those two columns from `authenticated`/`anon`.
 *
 * Round 3 (this file): that REVOKE broke Round 2's implementation, because
 * its UPDATE unconditionally named both revoked columns in its SET clause
 * via the user-scoped client. The fix moves the ENTIRE lookup + branch +
 * write into a new `SECURITY DEFINER` RPC, `public.abandon_pending_checkout
 * (p_user_id uuid, p_event_id uuid)` (see
 * `supabase/migrations/20260812180000_abandon_pending_checkout_rpc.sql`,
 * covered separately at the SQL-text level in
 * `src/lib/supabase/__tests__/migration-abandon-pending-checkout-rpc.test.ts`).
 *
 * `abandonPendingCheckout` is now a thin wrapper: auth check, call the RPC,
 * map its jsonb response onto `ActionResult`, run the (never-trusted)
 * `options.from` diagnostic comparison, revalidate. This file's job shrinks
 * to match — it mocks `supabase.rpc('abandon_pending_checkout', ...)`
 * instead of `.from('bookings')` table calls, and no longer needs to
 * exercise the 5-way branch logic itself (that's the SQL test file's job
 * now). The security invariant this file still must defend: the RPC is
 * called with ONLY `{p_user_id, p_event_id}` — never `options.from` or any
 * other client-supplied hint — and the RPC's real returned `status` (never
 * the `from` hint) is what the function returns to the caller.
 */

const mockGetUser = vi.fn()
const mockRpc = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(() =>
    Promise.resolve({
      auth: { getUser: mockGetUser },
      from: vi.fn(),
      rpc: mockRpc,
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

beforeEach(() => {
  vi.clearAllMocks()
})

// ════════════════════════════════════════════════════════════════════════════
// Auth
// ════════════════════════════════════════════════════════════════════════════

describe('abandonPendingCheckout — auth', () => {
  it('INVARIANT: an unauthenticated caller is rejected before the RPC is ever called', async () => {
    unauthenticateUser()

    const result = await abandonPendingCheckout('evt-1', { from: 'admin_remediation' })

    expect(result).toEqual({ success: false, error: 'Authentication required' })
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it('an auth.getUser() error (not just a null user) is also treated as unauthenticated', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'session expired' },
    })

    const result = await abandonPendingCheckout('evt-1')

    expect(result).toEqual({ success: false, error: 'Authentication required' })
    expect(mockRpc).not.toHaveBeenCalled()
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Input validation
// ════════════════════════════════════════════════════════════════════════════

describe('abandonPendingCheckout — input validation', () => {
  it('returns an error when eventId is empty, without checking auth or calling the RPC', async () => {
    const result = await abandonPendingCheckout('')

    expect(result).toEqual({ success: false, error: 'Event ID is required' })
    expect(mockGetUser).not.toHaveBeenCalled()
    expect(mockRpc).not.toHaveBeenCalled()
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Happy path — RPC called with the correct, minimal args
// ════════════════════════════════════════════════════════════════════════════

describe('abandonPendingCheckout — happy path', () => {
  it('calls the RPC with exactly {p_user_id, p_event_id} — no from/status/hint parameter of any kind', async () => {
    authenticateUser('user-1')
    mockRpc.mockResolvedValue({
      data: { booking_id: 'bk-1', status: 'cancelled' },
      error: null,
    })

    await abandonPendingCheckout('evt-1', { from: 'admin_remediation' })

    expect(mockRpc).toHaveBeenCalledTimes(1)
    expect(mockRpc).toHaveBeenCalledWith('abandon_pending_checkout', {
      p_user_id: 'user-1',
      p_event_id: 'evt-1',
    })
    // Belt-and-braces: the exact call args object must have exactly these
    // two keys — a future regression that threads `from` (or anything
    // else) into the RPC call would be caught here even if it were an
    // additional, extra key alongside the two required ones.
    const callArgs = mockRpc.mock.calls[0][1] as Record<string, unknown>
    expect(Object.keys(callArgs).sort()).toEqual(['p_event_id', 'p_user_id'])
  })

  it('returns {success: true, status} echoing the RPC-reported status, for each of the three possible statuses', async () => {
    for (const status of ['cancelled', 'waitlisted', 'confirmed'] as const) {
      authenticateUser('user-1')
      mockRpc.mockResolvedValue({
        data: { booking_id: 'bk-1', status },
        error: null,
      })

      const result = await abandonPendingCheckout('evt-1')

      expect(result).toEqual({ success: true, status })
    }
  })

  it('scopes the RPC call to the authenticated caller\'s own user id, never anyone else\'s', async () => {
    authenticateUser('user-42')
    mockRpc.mockResolvedValue({
      data: { booking_id: 'bk-1', status: 'cancelled' },
      error: null,
    })

    await abandonPendingCheckout('evt-1')

    expect(mockRpc).toHaveBeenCalledWith('abandon_pending_checkout', {
      p_user_id: 'user-42',
      p_event_id: 'evt-1',
    })
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Idempotent no-op — no matching pending_payment row
// ════════════════════════════════════════════════════════════════════════════

describe('abandonPendingCheckout — idempotent no-op', () => {
  it('RPC signals no matching row (booking_id: null, status: null) → returns {success: true} with NO status key', async () => {
    // This exact contract is depended on by BookingCancelledHandler.tsx,
    // which falls through to its default "Payment cancelled" toast copy
    // whenever `result.status` is undefined (see the component's ternary —
    // `resultStatus === 'waitlisted' ? ... : resultStatus === 'confirmed'
    // ? ... : <default>`). Returning `status: null` verbatim instead of
    // omitting the key would still satisfy that ternary today, but the
    // component test file
    // (BookingCancelledHandler.test.tsx — "no status on the result...
    // falls back to the generic 'payment cancelled' toast copy") and this
    // migration's design doc (§4, "Response mapping") both pin the
    // no-`status`-key shape explicitly, so we assert it precisely here
    // rather than merely asserting falsy.
    authenticateUser('user-1')
    mockRpc.mockResolvedValue({
      data: { booking_id: null, status: null },
      error: null,
    })

    const result = await abandonPendingCheckout('evt-1', { from: 'admin_remediation' })

    expect(result).toEqual({ success: true })
    expect('status' in result).toBe(false)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Errors — transport-level and RPC business-logic errors are surfaced, not
// swallowed
// ════════════════════════════════════════════════════════════════════════════

describe('abandonPendingCheckout — error handling', () => {
  it('a transport-level RPC error (e.g. a Postgres exception) is mapped to a generic, non-leaking error message', async () => {
    authenticateUser('user-1')
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'connection terminated unexpectedly' },
    })

    const result = await abandonPendingCheckout('evt-1')

    expect(result).toEqual({ success: false, error: 'Could not release the booking' })
  })

  it('does not throw when the RPC transport error has no message property', async () => {
    authenticateUser('user-1')
    mockRpc.mockResolvedValue({ data: null, error: {} })

    await expect(abandonPendingCheckout('evt-1')).resolves.toEqual({
      success: false,
      error: 'Could not release the booking',
    })
  })

  it('an RPC business-logic error (data.error, e.g. the RPC\'s own auth.uid() mismatch guard) is passed through, not swallowed', async () => {
    authenticateUser('user-1')
    mockRpc.mockResolvedValue({
      data: { error: 'Unauthorised' },
      error: null,
    })

    const result = await abandonPendingCheckout('evt-1')

    expect(result).toEqual({ success: false, error: 'Unauthorised' })
  })
})

// ════════════════════════════════════════════════════════════════════════════
// options.from — diagnostics only, never sent to the RPC, never influences
// the result
// ════════════════════════════════════════════════════════════════════════════

describe('abandonPendingCheckout — options.from is diagnostics-only', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('logs a console.warn diagnostic when the spoofed from disagrees with the RPC-derived status, but the RETURNED result is driven entirely by the RPC', async () => {
    // Simulates a member spoofing ?from=admin_remediation (implies
    // 'confirmed') on an ordinary self-booked row. The RPC (the real
    // security boundary now) derives 'cancelled' regardless — this test
    // pins that the TS wrapper echoes the RPC's real value and merely logs
    // the mismatch, never acts on `from`.
    authenticateUser('user-1')
    mockRpc.mockResolvedValue({
      data: { booking_id: 'bk-1', status: 'cancelled' },
      error: null,
    })

    const result = await abandonPendingCheckout('evt-1', { from: 'admin_remediation' })

    expect(result).toEqual({ success: true, status: 'cancelled' })
    expect(warnSpy).toHaveBeenCalledWith(
      '[abandonPendingCheckout] client-supplied "from" hint did not match server-derived rollback',
      expect.objectContaining({
        from: 'admin_remediation',
        derivedRollbackStatus: 'cancelled',
        bookingId: 'bk-1',
      }),
    )
  })

  it('does not warn when the from hint happens to agree with the RPC-derived status', async () => {
    authenticateUser('user-1')
    mockRpc.mockResolvedValue({
      data: { booking_id: 'bk-1', status: 'cancelled' },
      error: null,
    })

    await abandonPendingCheckout('evt-1', { from: 'book' })

    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('does not warn (and does not throw) when options.from is omitted entirely', async () => {
    authenticateUser('user-1')
    mockRpc.mockResolvedValue({
      data: { booking_id: 'bk-1', status: 'confirmed' },
      error: null,
    })

    const result = await abandonPendingCheckout('evt-1')

    expect(result).toEqual({ success: true, status: 'confirmed' })
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('does not warn on the idempotent no-op branch even with a from hint present (no status to compare against)', async () => {
    authenticateUser('user-1')
    mockRpc.mockResolvedValue({
      data: { booking_id: null, status: null },
      error: null,
    })

    const result = await abandonPendingCheckout('evt-1', { from: 'claim' })

    expect(result).toEqual({ success: true })
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('SECURITY: from is read for logging only — it is never included in the RPC call args, in ANY branch (happy path, no-op, or error)', async () => {
    authenticateUser('user-1')
    for (const rpcResponse of [
      { data: { booking_id: 'bk-1', status: 'waitlisted' }, error: null },
      { data: { booking_id: null, status: null }, error: null },
      { data: { error: 'Unauthorised' }, error: null },
    ]) {
      mockRpc.mockClear()
      mockRpc.mockResolvedValue(rpcResponse)

      await abandonPendingCheckout('evt-1', { from: 'admin_reinstate' })

      expect(mockRpc).toHaveBeenCalledWith('abandon_pending_checkout', {
        p_user_id: 'user-1',
        p_event_id: 'evt-1',
      })
      const callArgs = mockRpc.mock.calls[0][1] as Record<string, unknown>
      expect(callArgs).not.toHaveProperty('from')
      expect(callArgs).not.toHaveProperty('options')
      expect(callArgs).not.toHaveProperty('status')
    }
  })
})
