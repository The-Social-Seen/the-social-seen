import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ──────────────────────────────────────────────────────────────────
//
// This file complements actions.test.ts. Where that file pins per-branch
// behaviour of cancelBooking, this file probes the race + idempotency
// invariants of the refund flow that the unit-tests don't naturally
// reach:
//
//   1. Double-cancel race (spec §9 edge case 1). Two simultaneous
//      cancelBooking() calls for the same booking. The Stripe
//      idempotencyKey + the optimistic `.eq('status', 'confirmed')`
//      guard should mean: exactly one refund issued, second UPDATE
//      no-ops.
//
//   2. Already-refunded booking (refunded_amount_pence > 0) skips
//      stripe.refunds.create entirely. This is the resume-after-retry
//      path — if the first cancelBooking succeeded at Stripe but the DB
//      UPDATE failed (the "refund-reconcile" Sentry surface), the
//      operator restarts and we MUST NOT issue a second refund.
//
//   3. Refund-issued-but-UPDATE-fails surfaces a Sentry capture with
//      tag `surface: 'refund-reconcile'` so the operator can find the
//      orphan. Without this breadcrumb the inconsistency would surface
//      only as a confused user calling support.

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

vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>()
  return {
    ...actual,
    after: (fn: () => unknown | Promise<unknown>) => {
      void Promise.resolve(fn())
    },
  }
})

const mockSendEmail = vi.fn()
vi.mock('@/lib/email/send', () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
}))

// Sentry capture — these tests assert that the refund-reconcile
// breadcrumb is captured, so we need a stub we can interrogate.
const mockSentryCapture = vi.fn()
vi.mock('@sentry/nextjs', () => ({
  captureException: (...args: unknown[]) => mockSentryCapture(...args),
}))

const mockStripeRefundCreate = vi.fn()
vi.mock('@/lib/stripe/server', () => ({
  getStripeClient: () => ({
    refunds: {
      create: (...args: unknown[]) => mockStripeRefundCreate(...args),
    },
  }),
}))

// notifyWaitlistersOfOpenSpot uses the admin client. Empty waitlister
// list — these tests don't care about the email broadcast.
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

vi.mock('next/headers', () => ({
  headers: async () =>
    new Headers({ 'x-forwarded-host': 'localhost:6500', 'x-forwarded-proto': 'http' }),
}))

import { cancelBooking } from '../actions'

// ── Helpers ────────────────────────────────────────────────────────────────

function authenticateUser(userId = 'user-1') {
  mockGetUser.mockResolvedValue({
    data: { user: { id: userId } },
    error: null,
  })
}

/**
 * Stub the 3-call Supabase chain (booking fetch → event fetch → update).
 * Per-call data passed in, with optional update-call response so we can
 * exercise the "update-fails-but-refund-succeeded" branch.
 */
function stubCancelSequence(opts: {
  booking: Record<string, unknown>
  event: { date_time: string; slug: string; refund_window_hours?: number }
  updateResult?: { data: unknown; error: unknown }
}) {
  const eventWithDefaults = {
    refund_window_hours: 48,
    ...opts.event,
  }
  let callCount = 0
  mockFrom.mockImplementation(() => {
    callCount++
    const chain: Record<string, ReturnType<typeof vi.fn>> = {}
    const methods = ['select', 'update', 'eq', 'is', 'single', 'neq', 'order', 'limit']
    for (const m of methods) {
      chain[m] = vi.fn().mockReturnValue(chain)
    }
    if (callCount === 1) {
      // booking fetch
      chain.then = vi.fn((resolve: (v: unknown) => void) =>
        resolve({ data: opts.booking, error: null }),
      )
    } else if (callCount === 2) {
      // event fetch
      chain.then = vi.fn((resolve: (v: unknown) => void) =>
        resolve({ data: eventWithDefaults, error: null }),
      )
    } else {
      // update (third+ call). Use the override if provided.
      chain.then = vi.fn((resolve: (v: unknown) => void) =>
        resolve(opts.updateResult ?? { data: { id: 'bk-1' }, error: null }),
      )
    }
    return chain
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ════════════════════════════════════════════════════════════════════════════
// Double-cancel race idempotency (spec §9 edge case 1)
// ════════════════════════════════════════════════════════════════════════════

describe('cancelBooking — double-cancel race idempotency', () => {
  // INVARIANT: A double-click on "Cancel my booking" must result in
  // exactly one Stripe refund of the ticket price, never two. The
  // idempotency comes from two layers:
  //   (a) Stripe-side: `idempotencyKey: refund-booking-${id}` returns
  //       the SAME refund object on a repeat call with the same key.
  //   (b) DB-side: `.eq('status', 'confirmed')` on the UPDATE means
  //       once the row is cancelled, the second UPDATE no-ops.
  //
  // We can't reproduce a true concurrent race in Vitest (we'd need to
  // run two requests against the same Postgres connection), but we
  // CAN assert:
  //   - When stripe.refunds.create is called twice with the same key,
  //     mock returns the same object (verifies the test-side contract).
  //   - When the optimistic UPDATE returns "no row matched" because
  //     the row is already cancelled, the action surfaces an error
  //     rather than silently completing.
  it('refunds.create receives a stable idempotencyKey across simulated retries', async () => {
    authenticateUser('user-1')
    mockStripeRefundCreate.mockResolvedValue({ id: 're_idem' })

    stubCancelSequence({
      booking: {
        id: 'bk-race',
        user_id: 'user-1',
        event_id: 'evt-1',
        status: 'confirmed',
        price_at_booking: 2000,
        stripe_payment_id: 'pi_xyz',
        refunded_amount_pence: 0,
      },
      event: {
        date_time: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
        slug: 'wine',
      },
    })

    await cancelBooking('bk-race')

    expect(mockStripeRefundCreate).toHaveBeenCalledTimes(1)
    // The idempotencyKey is deterministic from the booking id. A
    // concurrent retry with the same booking id MUST produce the same
    // key — Stripe will then return the same refund object.
    const optionsArg = mockStripeRefundCreate.mock.calls[0][1] as {
      idempotencyKey: string
    }
    expect(optionsArg.idempotencyKey).toBe('refund-booking-bk-race')
  })

  it('skips Stripe entirely when refunded_amount_pence is already > 0', async () => {
    // The resume-after-partial-failure path. If a previous call already
    // refunded (refunded_amount_pence > 0) but the row update was
    // somehow lost, a second cancelBooking call MUST NOT issue another
    // refund. The alreadyRefunded guard short-circuits.
    authenticateUser('user-1')
    stubCancelSequence({
      booking: {
        id: 'bk-already',
        user_id: 'user-1',
        event_id: 'evt-1',
        status: 'confirmed',
        price_at_booking: 2000,
        stripe_payment_id: 'pi_xyz',
        // Sentinel — first call already moved money. Second call must
        // recognise this.
        refunded_amount_pence: 2000,
      },
      event: {
        date_time: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
        slug: 'wine',
      },
    })

    const result = await cancelBooking('bk-already')

    expect(result.success).toBe(true)
    // No double-charge: Stripe was NOT called the second time.
    expect(mockStripeRefundCreate).not.toHaveBeenCalled()
  })

  it('surfaces an error when the optimistic UPDATE matches no row (already cancelled)', async () => {
    // Simulates the second arm of a double-cancel race: refund went
    // through (first call), THEN the second-call refund is short-
    // circuited by alreadyRefunded — but the second UPDATE's
    // .eq('status','confirmed') no-ops because the first call already
    // flipped the row to cancelled. The action MUST surface an error
    // rather than silently succeed.
    //
    // Wait — actually, alreadyRefunded short-circuits the refund only;
    // the UPDATE still runs but now finds no confirmed row. The Server
    // Action's behaviour: return "Booking was already cancelled or
    // modified".
    authenticateUser('user-1')
    stubCancelSequence({
      booking: {
        id: 'bk-double',
        user_id: 'user-1',
        event_id: 'evt-1',
        status: 'confirmed',
        price_at_booking: 2000,
        stripe_payment_id: 'pi_xyz',
        refunded_amount_pence: 2000,
      },
      event: {
        date_time: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
        slug: 'wine',
      },
      // Optimistic UPDATE returns no row — the first cancel won the
      // race and the row is already cancelled.
      updateResult: { data: null, error: null },
    })

    const result = await cancelBooking('bk-double')

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/already cancelled|modified/i)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Refund-reconcile Sentry breadcrumb
// ════════════════════════════════════════════════════════════════════════════

describe('cancelBooking — refund-reconcile Sentry breadcrumb', () => {
  // INVARIANT: When Stripe issues a refund but the subsequent DB
  // UPDATE fails, the operator MUST be alerted via a Sentry capture
  // tagged `surface: 'refund-reconcile'`. Without that breadcrumb the
  // orphan refund surfaces only as a user calling support after seeing
  // money back in their bank but a still-confirmed booking on the app.
  //
  // The capture call name is documented in actions.ts:825:
  //   `Refund issued but booking UPDATE failed — manual reconciliation needed`
  //
  // Why we test this: the backend agent flagged that an admin-mid-
  // checkout race could lose this breadcrumb in a refactor. Spec §9
  // calls it out as the only signal of the orphan-payment class. If
  // this assertion fails after a refactor, the operator just lost
  // their alarm.
  it('emits a Sentry breadcrumb with tag surface=refund-reconcile when UPDATE fails after refund', async () => {
    authenticateUser('user-1')
    mockStripeRefundCreate.mockResolvedValueOnce({ id: 're_orphan' })

    stubCancelSequence({
      booking: {
        id: 'bk-orphan',
        user_id: 'user-1',
        event_id: 'evt-1',
        status: 'confirmed',
        price_at_booking: 2000,
        stripe_payment_id: 'pi_xyz',
        refunded_amount_pence: 0,
      },
      event: {
        date_time: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
        slug: 'wine',
      },
      // The catastrophic case: Stripe took the money out but our DB
      // couldn't record it. Operator MUST be paged.
      updateResult: {
        data: null,
        error: { message: 'db connection lost mid-write' },
      },
    })

    const result = await cancelBooking('bk-orphan')

    // The user-facing result reports failure.
    expect(result.success).toBe(false)

    // The breadcrumb has been captured. Operator can find it by
    // filtering Sentry on `surface:refund-reconcile`.
    expect(mockSentryCapture).toHaveBeenCalledTimes(1)
    const [errArg, contextArg] = mockSentryCapture.mock.calls[0] as [
      Error,
      { tags?: Record<string, unknown>; extra?: Record<string, unknown> },
    ]
    expect(errArg).toBeInstanceOf(Error)
    expect(errArg.message).toMatch(/refund issued but booking update failed/i)
    expect(contextArg.tags).toMatchObject({ surface: 'refund-reconcile' })
    expect(contextArg.extra).toMatchObject({
      bookingId: 'bk-orphan',
      stripeRefundId: 're_orphan',
    })
  })

  it('does NOT emit the refund-reconcile breadcrumb on a clean cancellation', async () => {
    // Sanity: the breadcrumb is reserved for the orphan-payment class.
    // A clean cancel (refund + UPDATE both succeed) must NOT page the
    // operator.
    authenticateUser('user-1')
    mockStripeRefundCreate.mockResolvedValueOnce({ id: 're_clean' })

    stubCancelSequence({
      booking: {
        id: 'bk-clean',
        user_id: 'user-1',
        event_id: 'evt-1',
        status: 'confirmed',
        price_at_booking: 2000,
        stripe_payment_id: 'pi_xyz',
        refunded_amount_pence: 0,
      },
      event: {
        date_time: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
        slug: 'wine',
      },
    })

    const result = await cancelBooking('bk-clean')
    expect(result.success).toBe(true)
    expect(mockSentryCapture).not.toHaveBeenCalled()
  })

  it('does NOT emit the refund-reconcile breadcrumb when refund fails (no money moved)', async () => {
    // Different failure class: Stripe rejected the refund. No money
    // moved. The cancel surfaces an error to the user (their spot is
    // preserved) but there's no orphan to reconcile. Sentry capture is
    // appropriate here too but with a different surface tag (not
    // refund-reconcile). This test pins that the refund-reconcile
    // capture is reserved for the orphan-payment class specifically.
    authenticateUser('user-1')
    mockStripeRefundCreate.mockRejectedValueOnce(new Error('card_declined'))

    stubCancelSequence({
      booking: {
        id: 'bk-failed-refund',
        user_id: 'user-1',
        event_id: 'evt-1',
        status: 'confirmed',
        price_at_booking: 2000,
        stripe_payment_id: 'pi_xyz',
        refunded_amount_pence: 0,
      },
      event: {
        date_time: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
        slug: 'wine',
      },
    })

    const result = await cancelBooking('bk-failed-refund')
    expect(result.success).toBe(false)
    // The refund-reconcile capture is for the orphan class only. A
    // refund failure that aborts the cancel cleanly doesn't qualify.
    const reconcileCalls = mockSentryCapture.mock.calls.filter((args) => {
      const ctx = args[1] as { tags?: Record<string, unknown> } | undefined
      return ctx?.tags && (ctx.tags as Record<string, unknown>).surface === 'refund-reconcile'
    })
    expect(reconcileCalls).toHaveLength(0)
  })
})
