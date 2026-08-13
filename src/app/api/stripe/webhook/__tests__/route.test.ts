import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { sendEmail } from '@/lib/email/send'

// ── Mocks ──────────────────────────────────────────────────────────────────
// All mocks must be set up before importing the route module.

const constructEventMock = vi.fn()
// refund-fee-deduction: webhook now retrieves the PaymentIntent to read
// the BalanceTransaction.fee and write it to bookings.stripe_fee_pence.
// Default to a valid-but-empty PaymentIntent so tests that don't care
// about the BalanceTransaction path still pass.
const paymentIntentsRetrieveMock = vi.fn()

vi.mock('@/lib/stripe/server', () => ({
  getStripeClient: () => ({
    webhooks: { constructEvent: constructEventMock },
    paymentIntents: { retrieve: paymentIntentsRetrieveMock },
  }),
}))

// Supabase admin client builder — chainable query mock.
function makeSupabaseMock() {
  const single = vi.fn()
  const maybeSingle = vi.fn()
  const chain: Record<string, unknown> = {
    update: vi.fn(() => chain),
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    is: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    // order() is used by sendPaidBookingConfirmationEmail's booking lookup
    // (route.ts: .order('created_at', ...).limit(1).maybeSingle()). Without
    // it the email path throws (caught-and-logged) and sendEmail is never
    // reached — invisible until a test asserts on sendEmail. Returning the
    // chain keeps the lookup fluent.
    order: vi.fn(() => chain),
    single,
    maybeSingle,
  }
  return {
    chain,
    single,
    maybeSingle,
    client: {
      from: vi.fn(() => chain),
    },
  }
}

let supabaseHandle: ReturnType<typeof makeSupabaseMock>

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => supabaseHandle.client,
}))

vi.mock('@/lib/email/send', () => ({
  sendEmail: vi.fn().mockResolvedValue({ success: true, messageId: 'mock' }),
}))

// ── Helpers ────────────────────────────────────────────────────────────────

async function importRoute() {
  vi.resetModules()
  supabaseHandle = makeSupabaseMock()
  const mod = await import('../route')
  return mod.POST
}

// The route handler's NextRequest parameter is structurally compatible
// with a plain Request for the APIs this route uses (text(), headers).
// Cast to satisfy the type checker.
function makeRequest(body: string, sig: string | null): import('next/server').NextRequest {
  const headers = new Headers()
  if (sig) headers.set('stripe-signature', sig)
  const req = new Request('http://localhost/api/stripe/webhook', {
    method: 'POST',
    body,
    headers,
  })
  return req as unknown as import('next/server').NextRequest
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('POST /api/stripe/webhook', () => {
  beforeEach(() => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test')
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_mock')
    constructEventMock.mockReset()
    // Default the PaymentIntent retrieve mock to "no expanded charge" so
    // tests that exercise non-BalanceTransaction paths don't accidentally
    // write stripe_fee_pence. Specific tests override.
    paymentIntentsRetrieveMock.mockReset()
    paymentIntentsRetrieveMock.mockResolvedValue({
      id: 'pi_default',
      latest_charge: null,
    })
    // sendEmail is a module-level vi.fn() created once by the vi.mock
    // factory; its call count accumulates across tests. Clear (not reset)
    // so the resolved value survives while the comp/paid cases can assert
    // call counts cleanly. No existing test asserts on it, so clearing is
    // a no-op for them.
    vi.mocked(sendEmail).mockClear()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('rejects when stripe-signature header is missing', async () => {
    const POST = await importRoute()
    const res = await POST(makeRequest('{}', null))
    expect(res.status).toBe(400)
  })

  it('rejects when the signature does not verify', async () => {
    const POST = await importRoute()
    constructEventMock.mockImplementation(() => {
      throw new Error('No signatures found matching the expected signature')
    })
    const res = await POST(makeRequest('{}', 't=1,v1=bad'))
    expect(res.status).toBe(401)
  })

  it('returns 500 when STRIPE_WEBHOOK_SECRET is not configured', async () => {
    vi.unstubAllEnvs()
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_mock')
    // STRIPE_WEBHOOK_SECRET deliberately unset
    const POST = await importRoute()
    const res = await POST(makeRequest('{}', 't=1,v1=anything'))
    expect(res.status).toBe(500)
  })

  it('ACKs 200 for an event type we do not handle', async () => {
    const POST = await importRoute()
    constructEventMock.mockReturnValue({
      type: 'customer.subscription.created',
      data: { object: {} },
    })
    const res = await POST(makeRequest('{}', 't=1,v1=sig'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ received: true })
  })

  it('confirms the matching booking on checkout.session.completed', async () => {
    const POST = await importRoute()

    // Arrange: the chain returns a confirmed booking row from the UPDATE.
    supabaseHandle = makeSupabaseMock()
    supabaseHandle.maybeSingle.mockResolvedValue({
      data: { id: 'b1', user_id: 'u1', event_id: 'e1' },
      error: null,
    })
    // The email-send path triggers two SELECTs (profile, event); both
    // resolve to minimal valid rows so the handler completes.
    supabaseHandle.single.mockResolvedValueOnce({
      data: { full_name: 'Charlotte', email: 'ch@example.com' },
      error: null,
    })
    supabaseHandle.single.mockResolvedValueOnce({
      data: {
        title: 'Wine & Wisdom',
        slug: 'wine-wisdom',
        date_time: '2026-05-07T19:00:00Z',
        venue_name: 'Cellar',
        venue_address: '1 Bank End',
        venue_revealed: true,
      },
      error: null,
    })

    constructEventMock.mockReturnValue({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_123',
          payment_status: 'paid',
          payment_intent: 'pi_456',
          metadata: { booking_id: 'b1' },
        },
      },
    })

    const res = await POST(makeRequest('{}', 't=1,v1=sig'))
    expect(res.status).toBe(200)

    // Assert: the UPDATE was gated on status=pending_payment (idempotency).
    expect(supabaseHandle.chain.update).toHaveBeenCalledWith({
      status: 'confirmed',
      stripe_payment_id: 'pi_456',
      // P2-7b: position is preserved through pending_payment so we can
      // restore it on Stripe failure; webhook clears it once the seat
      // is confirmed and queue position is no longer meaningful.
      waitlist_position: null,
      // admin-waitlist-promotion-payment §5 site #1: unconditionally
      // cleared on every confirm, whether or not this row was ever an
      // admin-created hold — harmless no-op for ordinary bookings
      // (already false/null), required so a hold-originated row doesn't
      // violate chk_bookings_admin_hold_requires_pending_payment the
      // instant status leaves pending_payment.
      is_admin_hold: false,
      admin_hold_expires_at: null,
    })
    expect(supabaseHandle.chain.eq).toHaveBeenCalledWith('id', 'b1')
    expect(supabaseHandle.chain.eq).toHaveBeenCalledWith('status', 'pending_payment')

    // zero-total-coupon §2.3 / §6.4 regression guard: the paid path MUST
    // NOT touch the money columns — the book_event_paid snapshot already
    // equals what Stripe charged (one line item, no coupon). The
    // toHaveBeenCalledWith above is exact, but make the intent explicit so
    // a future change that starts writing price_at_booking/booking_fee_pence
    // on the paid path fails loudly here.
    const paidPayload = (supabaseHandle.chain.update as ReturnType<typeof vi.fn>)
      .mock.calls[0][0] as Record<string, unknown>
    expect(paidPayload).toEqual(
      expect.not.objectContaining({ price_at_booking: expect.anything() }),
    )
    expect(paidPayload).toEqual(
      expect.not.objectContaining({ booking_fee_pence: expect.anything() }),
    )
    expect(Object.keys(paidPayload).sort()).toEqual(
      ['admin_hold_expires_at', 'is_admin_hold', 'status', 'stripe_payment_id', 'waitlist_position'].sort(),
    )

    // Paid path runs fee capture (PI present) and sends the email.
    expect(paymentIntentsRetrieveMock).toHaveBeenCalledWith(
      'pi_456',
      expect.objectContaining({
        expand: expect.arrayContaining(['latest_charge.balance_transaction']),
      }),
    )
    expect(vi.mocked(sendEmail)).toHaveBeenCalledTimes(1)
  })

  it('treats duplicate payment_intent (23505) as already-processed', async () => {
    const POST = await importRoute()

    supabaseHandle = makeSupabaseMock()
    // Simulate the UNIQUE constraint trip from a webhook re-delivery.
    supabaseHandle.maybeSingle.mockResolvedValue({
      data: null,
      error: { code: '23505', message: 'duplicate key value' },
    })

    constructEventMock.mockReturnValue({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_123',
          payment_status: 'paid',
          payment_intent: 'pi_456',
          metadata: { booking_id: 'b1' },
        },
      },
    })

    const res = await POST(makeRequest('{}', 't=1,v1=sig'))
    // Still 200 — Stripe must not retry a duplicate.
    expect(res.status).toBe(200)
  })

  it('no-ops when booking_id metadata is missing', async () => {
    const POST = await importRoute()

    supabaseHandle = makeSupabaseMock()
    constructEventMock.mockReturnValue({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_123',
          payment_status: 'paid',
          payment_intent: 'pi_456',
          metadata: {}, // no booking_id
        },
      },
    })

    const res = await POST(makeRequest('{}', 't=1,v1=sig'))
    expect(res.status).toBe(200)
    // No DB update attempted.
    expect(supabaseHandle.chain.update).not.toHaveBeenCalled()
  })

  it('ignores payment_status other than "paid"', async () => {
    // NOTE (zero-total-coupon §6.3a; gate redefined by
    // webhook-comp-detection-fix §3 — see comment block below): 'unpaid'
    // with status/amount_total both left undefined satisfies neither
    // isPaidSession (payment_status !== 'paid') nor isCompSession
    // (status !== 'complete') — a payment is expected but hasn't landed,
    // so confirming would oversell. This is NOT the comp shape (comp is
    // status==='complete' && amount_total===0, payment_status no longer
    // part of that gate as of the 2026-08-13 fix), so this test does not
    // contradict the £0-comp behaviour; it pins the still-rejected
    // 'unpaid'-with-no-other-signals case. See the dedicated comp suite
    // below for the £0-complete case that DOES confirm regardless of
    // payment_status, and the "genuinely-unpaid, NONZERO amount owed" test
    // for the real regression guard on a session with money still owed.
    const POST = await importRoute()

    supabaseHandle = makeSupabaseMock()
    constructEventMock.mockReturnValue({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_123',
          payment_status: 'unpaid',
          payment_intent: 'pi_456',
          metadata: { booking_id: 'b1' },
        },
      },
    })

    const res = await POST(makeRequest('{}', 't=1,v1=sig'))
    expect(res.status).toBe(200)
    expect(supabaseHandle.chain.update).not.toHaveBeenCalled()
    expect(vi.mocked(sendEmail)).not.toHaveBeenCalled()
  })

  it('returns 200 even when the DB handler throws (no Stripe retries for app bugs)', async () => {
    const POST = await importRoute()

    supabaseHandle = makeSupabaseMock()
    // Force the UPDATE to blow up unexpectedly.
    supabaseHandle.maybeSingle.mockRejectedValue(new Error('db is on fire'))

    constructEventMock.mockReturnValue({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_123',
          payment_status: 'paid',
          payment_intent: 'pi_456',
          metadata: { booking_id: 'b1' },
        },
      },
    })

    const res = await POST(makeRequest('{}', 't=1,v1=sig'))
    expect(res.status).toBe(200)
  })

  // ── zero-total comp (100%-off promotion code → £0) ─────────────────────
  //
  // docs/SYSTEM-DESIGN-zero-total-coupon-bookings.md §6. A full comp lands
  // as checkout.session.completed with payment_status='no_payment_required',
  // status='complete', amount_total=0, and payment_intent=null. The webhook
  // must confirm it — zeroing BOTH money columns together (the
  // chk_bookings_free_no_booking_fee CHECK trap, §2.3 / §8) — without
  // calling paymentIntents.retrieve (there is no PI / no Stripe fee).

  // Build a comp-shaped Checkout.Session with only the fields the handler
  // reads. Overrides let the genuinely-unpaid cases flip a single signal.
  function compSessionEvent(
    overrides: Partial<{
      payment_status: string
      status: string
      amount_total: number
      payment_intent: string | null
      metadata: Record<string, string>
      id: string
    }> = {},
  ) {
    return {
      type: 'checkout.session.completed',
      data: {
        object: {
          id: overrides.id ?? 'cs_comp',
          payment_status: overrides.payment_status ?? 'no_payment_required',
          status: overrides.status ?? 'complete',
          amount_total: overrides.amount_total ?? 0,
          payment_intent:
            'payment_intent' in overrides ? overrides.payment_intent : null,
          metadata:
            'metadata' in overrides
              ? overrides.metadata
              : { booking_id: 'b_comp' },
        },
      },
    }
  }

  it('comp (£0 100%-off): confirms with both money columns zeroed, no PI retrieve', async () => {
    // INVARIANT (zero-total-coupon §2.3 / §8 primary risk): a £0 comp
    // confirm MUST set price_at_booking=0 AND booking_fee_pence=0 in the
    // SAME UPDATE. Zeroing price while leaving the non-zero fee from
    // book_event_paid violates chk_bookings_free_no_booking_fee (23514),
    // the UPDATE fails, the row stays pending_payment, and the reaper
    // cancels it — the fix would look "unfixed". booking_fee_pence:0 is
    // the only unit-level guard for that trap.
    const POST = await importRoute()
    supabaseHandle = makeSupabaseMock()

    // The confirm UPDATE returns the row. The email path's booking lookup
    // also calls maybeSingle (shared mock) — it returns this same row, but
    // the handler reads price_at_booking defensively (undefined > 0 ===
    // false) so priceBreakdown is omitted and the email still sends.
    supabaseHandle.maybeSingle.mockResolvedValue({
      data: { id: 'b_comp', user_id: 'u1', event_id: 'e1' },
      error: null,
    })
    supabaseHandle.single.mockResolvedValueOnce({
      data: { full_name: 'Charlotte', email: 'ch@example.com' },
      error: null,
    })
    supabaseHandle.single.mockResolvedValueOnce({
      data: {
        title: 'Wine & Wisdom',
        slug: 'wine-wisdom',
        date_time: '2026-05-07T19:00:00Z',
        venue_name: 'Cellar',
        venue_address: '1 Bank End',
        venue_revealed: true,
      },
      error: null,
    })

    constructEventMock.mockReturnValue(compSessionEvent())

    const res = await POST(makeRequest('{}', 't=1,v1=sig'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ received: true })

    // The confirm UPDATE payload — exact shape (no extra/missing keys).
    expect(supabaseHandle.chain.update).toHaveBeenCalledWith({
      status: 'confirmed',
      stripe_payment_id: null,
      waitlist_position: null,
      price_at_booking: 0,
      booking_fee_pence: 0,
      // admin-waitlist-promotion-payment §5 site #1 — same unconditional
      // clear as the paid path above.
      is_admin_hold: false,
      admin_hold_expires_at: null,
    })
    // Explicit CHECK-trap guard (§8): assert booking_fee_pence:0 on its own
    // so the intent survives even if the exact-match above is later relaxed.
    const compPayload = (supabaseHandle.chain.update as ReturnType<typeof vi.fn>)
      .mock.calls[0][0] as Record<string, unknown>
    expect(compPayload.booking_fee_pence).toBe(0)
    expect(compPayload.price_at_booking).toBe(0)
    expect(compPayload.stripe_payment_id).toBeNull()

    // Optimistic idempotency guard retained verbatim.
    expect(supabaseHandle.chain.eq).toHaveBeenCalledWith('id', 'b_comp')
    expect(supabaseHandle.chain.eq).toHaveBeenCalledWith('status', 'pending_payment')

    // No PaymentIntent on a comp → fee capture is skipped entirely.
    expect(paymentIntentsRetrieveMock).not.toHaveBeenCalled()

    // Confirmation email still sent.
    expect(vi.mocked(sendEmail)).toHaveBeenCalledTimes(1)
  })

  it('comp re-delivery is idempotent: 0-row UPDATE no-ops, no email, 200', async () => {
    // INVARIANT (zero-total-coupon §4.2): comp idempotency rests ENTIRELY
    // on the .eq('status','pending_payment') guard (stripe_payment_id is
    // null, so the partial UNIQUE index can't dedupe). A second delivery's
    // UPDATE matches 0 rows → maybeSingle → null → handler returns at
    // `if (!updated) return`. No double-confirm, no second email.
    const POST = await importRoute()
    supabaseHandle = makeSupabaseMock()

    // Second delivery: the row is already confirmed, so the
    // status=pending_payment filter matches nothing.
    supabaseHandle.maybeSingle.mockResolvedValue({ data: null, error: null })

    constructEventMock.mockReturnValue(compSessionEvent())

    const res = await POST(makeRequest('{}', 't=1,v1=sig'))
    expect(res.status).toBe(200)

    // The UPDATE was attempted (optimistic guard fired) but matched no row.
    expect(supabaseHandle.chain.update).toHaveBeenCalledTimes(1)
    expect(supabaseHandle.chain.eq).toHaveBeenCalledWith('status', 'pending_payment')
    // No side-effects on the no-op path.
    expect(paymentIntentsRetrieveMock).not.toHaveBeenCalled()
    expect(vi.mocked(sendEmail)).not.toHaveBeenCalled()
  })

  it('genuinely-unpaid, NONZERO amount owed (payment_status=unpaid, amount_total=2060): rejected, no UPDATE, no email, 200', async () => {
    // webhook-comp-detection-fix §6 case 2 (regression guard for §3.2's
    // deliberate asymmetry). REWRITTEN 2026-08-13 — the previous version of
    // this test used compSessionEvent's default amount_total=0, which is a
    // £0/complete session and — under the REDESIGNED isCompSession gate
    // (status==='complete' && amount_total===0, no longer ANDed with
    // payment_status) — now correctly MATCHES isCompSession and gets
    // confirmed. That was never actually testing "genuinely unpaid"; it was
    // colliding with the fixed comp path once payment_status stopped being
    // part of the gate. The REAL risk this test must guard is a session
    // where money is still owed (a real, nonzero ticket price) and
    // settlement hasn't landed — that must still be rejected regardless of
    // the comp-detection relaxation, which is why amount_total is set to a
    // realistic nonzero ticket price here (not the £0 default).
    const POST = await importRoute()
    supabaseHandle = makeSupabaseMock()

    constructEventMock.mockReturnValue(
      compSessionEvent({
        payment_status: 'unpaid',
        amount_total: 2060,
        payment_intent: 'pi_x',
      }),
    )

    const res = await POST(makeRequest('{}', 't=1,v1=sig'))
    expect(res.status).toBe(200)
    expect(supabaseHandle.chain.update).not.toHaveBeenCalled()
    expect(paymentIntentsRetrieveMock).not.toHaveBeenCalled()
    expect(vi.mocked(sendEmail)).not.toHaveBeenCalled()
  })

  it('no_payment_required but status=open (not complete): rejected, no UPDATE, 200', async () => {
    // Gate sub-case (b), still correct post webhook-comp-detection-fix §3:
    // isCompSession requires status==='complete' (unchanged by the fix —
    // only the payment_status conjunct was dropped). no_payment_required
    // can surface on a non-complete session mid-lifecycle; we only fulfill
    // a *completed* session, so status='open' is rejected regardless of
    // payment_status.
    const POST = await importRoute()
    supabaseHandle = makeSupabaseMock()

    constructEventMock.mockReturnValue(
      compSessionEvent({ status: 'open' }),
    )

    const res = await POST(makeRequest('{}', 't=1,v1=sig'))
    expect(res.status).toBe(200)
    expect(supabaseHandle.chain.update).not.toHaveBeenCalled()
    expect(vi.mocked(sendEmail)).not.toHaveBeenCalled()
  })

  it('no_payment_required + complete but amount_total>0 (inconsistent): rejected, no UPDATE, 200', async () => {
    // Gate sub-case (c), still correct post webhook-comp-detection-fix §3:
    // isCompSession requires amount_total===0 (unchanged by the fix).
    // amount_total>0 alongside payment_status='no_payment_required' is an
    // inconsistent shape — not a genuine full comp — and payment_status
    // isn't 'paid' either, so isPaidSession is also false. Rejected.
    const POST = await importRoute()
    supabaseHandle = makeSupabaseMock()

    constructEventMock.mockReturnValue(
      compSessionEvent({ amount_total: 1500 }),
    )

    const res = await POST(makeRequest('{}', 't=1,v1=sig'))
    expect(res.status).toBe(200)
    expect(supabaseHandle.chain.update).not.toHaveBeenCalled()
    expect(vi.mocked(sendEmail)).not.toHaveBeenCalled()
  })

  it('comp path never issues the fee-capture UPDATE (.eq stripe_fee_pence, 0)', async () => {
    // zero-total-coupon §6.5 (focused): on the comp path captureStripeFee
    // is gated out, so the fee-capture UPDATE — identified by its
    // .eq('stripe_fee_pence', 0) first-write-wins guard — is never issued.
    const POST = await importRoute()
    supabaseHandle = makeSupabaseMock()

    supabaseHandle.maybeSingle.mockResolvedValue({
      data: { id: 'b_comp', user_id: 'u1', event_id: 'e1' },
      error: null,
    })
    supabaseHandle.single.mockResolvedValueOnce({
      data: { full_name: 'Charlotte', email: 'ch@example.com' },
      error: null,
    })
    supabaseHandle.single.mockResolvedValueOnce({
      data: {
        title: 'Wine & Wisdom',
        slug: 'wine-wisdom',
        date_time: '2026-05-07T19:00:00Z',
        venue_name: 'Cellar',
        venue_address: '1 Bank End',
        venue_revealed: true,
      },
      error: null,
    })

    constructEventMock.mockReturnValue(compSessionEvent())

    await POST(makeRequest('{}', 't=1,v1=sig'))

    // No fee-write UPDATE: scan every .eq call for the fee-capture guard.
    const eqCalls = (supabaseHandle.chain.eq as ReturnType<typeof vi.fn>).mock.calls
    const issuedFeeWrite = eqCalls.some(
      ([col]) => col === 'stripe_fee_pence',
    )
    expect(issuedFeeWrite).toBe(false)
    // And no UPDATE payload carried stripe_fee_pence either.
    const updateCalls = (supabaseHandle.chain.update as ReturnType<typeof vi.fn>).mock.calls
    const feePayload = updateCalls.find(
      (c) => 'stripe_fee_pence' in (c[0] as Record<string, unknown>),
    )
    expect(feePayload).toBeUndefined()
  })

  it('comp-shaped but missing booking_id metadata: hard-rejects, no UPDATE, 200', async () => {
    // zero-total-coupon §6.6: the new eligibility gate must not have moved
    // the metadata check — a comp-shaped session with no booking_id still
    // returns early before any UPDATE.
    const POST = await importRoute()
    supabaseHandle = makeSupabaseMock()

    constructEventMock.mockReturnValue(
      compSessionEvent({ metadata: {} }),
    )

    const res = await POST(makeRequest('{}', 't=1,v1=sig'))
    expect(res.status).toBe(200)
    expect(supabaseHandle.chain.update).not.toHaveBeenCalled()
    expect(paymentIntentsRetrieveMock).not.toHaveBeenCalled()
    expect(vi.mocked(sendEmail)).not.toHaveBeenCalled()
  })

  // ── comp-detection fix (payment_status no longer part of the gate) ────
  //
  // docs/SYSTEM-DESIGN-webhook-comp-detection-fix.md §6. Production
  // evidence: at least 13 genuine £0, 100%-off-promotion-code Checkout
  // Sessions came back from Stripe with payment_status='paid' (not
  // 'no_payment_required'), despite amount_total===0 and
  // payment_intent===null. The old triple-gate (payment_status ===
  // 'no_payment_required' AND status==='complete' AND amount_total===0)
  // missed every one of these — they fell through to the isPaidSession
  // branch, got confirmed, but never had their money columns zeroed. The
  // fix redefines isCompSession := status==='complete' && amount_total===0,
  // dropping payment_status entirely from the comp gate. isPaidSession
  // (payment_status==='paid') is UNCHANGED — see §3.2 of the design doc for
  // why relaxing that one too would reintroduce a real risk (delayed-
  // notification payment methods completing the Checkout flow before
  // settlement actually succeeds or fails).

  it('INVARIANT (the exact 13-row production bug): a £0 session reporting payment_status=paid still takes the comp-zeroing branch, never the bare-paid branch', async () => {
    // This is the case that was silently missing before the fix and is
    // exactly what stranded the 13 known production bookings: Stripe
    // returned payment_status='paid' for a genuine £0 promotion-code
    // checkout. Before the fix, isCompSession required payment_status===
    // 'no_payment_required', so this session satisfied ONLY isPaidSession
    // — confirmed, but price_at_booking/booking_fee_pence left at full
    // face value. After the fix, isCompSession no longer checks
    // payment_status at all, so amount_total===0 alone is enough to take
    // the zeroing branch, regardless of what payment_status says.
    const POST = await importRoute()
    supabaseHandle = makeSupabaseMock()

    supabaseHandle.maybeSingle.mockResolvedValue({
      data: { id: 'b_bug', user_id: 'u1', event_id: 'e1' },
      error: null,
    })
    supabaseHandle.single.mockResolvedValueOnce({
      data: { full_name: 'Charlotte', email: 'ch@example.com' },
      error: null,
    })
    supabaseHandle.single.mockResolvedValueOnce({
      data: {
        title: 'Wine & Wisdom',
        slug: 'wine-wisdom',
        date_time: '2026-05-07T19:00:00Z',
        venue_name: 'Cellar',
        venue_address: '1 Bank End',
        venue_revealed: true,
      },
      error: null,
    })

    const consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

    constructEventMock.mockReturnValue(
      compSessionEvent({
        id: 'cs_bug_repro',
        payment_status: 'paid', // the surprising, misleading signal
        status: 'complete',
        amount_total: 0,
        payment_intent: null, // Stripe never creates a PI for a £0 order
        metadata: { booking_id: 'b_bug' },
      }),
    )

    const res = await POST(makeRequest('{}', 't=1,v1=sig'))
    expect(res.status).toBe(200)

    // The comp-zeroing branch was taken: both money columns zeroed,
    // stripe_payment_id null, in the SAME UPDATE payload as the confirm.
    expect(supabaseHandle.chain.update).toHaveBeenCalledWith({
      status: 'confirmed',
      stripe_payment_id: null,
      waitlist_position: null,
      price_at_booking: 0,
      booking_fee_pence: 0,
      is_admin_hold: false,
      admin_hold_expires_at: null,
    })

    // No PaymentIntent was ever created for this session (payment_intent
    // stayed null) — the fee-capture lookup must never fire.
    expect(paymentIntentsRetrieveMock).not.toHaveBeenCalled()

    // Diagnostic telemetry (§3.3): the mismatch between amount_total===0
    // and a non-'no_payment_required' payment_status is logged, not
    // silently ignored — this is the exact signal that would have caught
    // the bug immediately had it existed before.
    const logged = consoleInfoSpy.mock.calls
      .map((call) => call.join(' '))
      .join('\n')
    expect(logged).toMatch(
      /comp session confirmed via amount_total===0 despite unexpected payment_status/i,
    )
    consoleInfoSpy.mockRestore()

    expect(vi.mocked(sendEmail)).toHaveBeenCalledTimes(1)
  })

  it('normal non-zero PAID session (payment_status=paid, real payment_intent, amount_total>0): records the payment_intent, does NOT zero price columns', async () => {
    // webhook-comp-detection-fix §6 item 4 / the task's own explicit ask:
    // confirm the ordinary, by-far-most-common path is unaffected by the
    // redefinition. Deliberately exercises status/amount_total EXPLICITLY
    // (unlike the earlier "confirms the matching booking" test, which
    // leaves them undefined) so this test fails loudly if a future change
    // ever makes isCompSession accidentally true for a real paid session.
    const POST = await importRoute()
    supabaseHandle = makeSupabaseMock()

    supabaseHandle.maybeSingle.mockResolvedValue({
      data: { id: 'b_paid', user_id: 'u1', event_id: 'e1' },
      error: null,
    })
    supabaseHandle.single.mockResolvedValueOnce({
      data: { full_name: 'James', email: 'james@example.com' },
      error: null,
    })
    supabaseHandle.single.mockResolvedValueOnce({
      data: {
        title: 'Supper Club',
        slug: 'supper-club',
        date_time: '2026-06-01T19:00:00Z',
        venue_name: 'The Kitchen',
        venue_address: '2 Bank End',
        venue_revealed: true,
      },
      error: null,
    })

    constructEventMock.mockReturnValue(
      compSessionEvent({
        id: 'cs_ordinary_paid',
        payment_status: 'paid',
        status: 'complete',
        amount_total: 2060, // real, nonzero ticket + fee total
        payment_intent: 'pi_ordinary',
        metadata: { booking_id: 'b_paid' },
      }),
    )

    const res = await POST(makeRequest('{}', 't=1,v1=sig'))
    expect(res.status).toBe(200)

    expect(supabaseHandle.chain.update).toHaveBeenCalledWith({
      status: 'confirmed',
      stripe_payment_id: 'pi_ordinary',
      waitlist_position: null,
      is_admin_hold: false,
      admin_hold_expires_at: null,
      // No price_at_booking / booking_fee_pence keys — only the comp
      // branch adds them.
    })
    const updatePayload = (supabaseHandle.chain.update as ReturnType<typeof vi.fn>)
      .mock.calls[0][0] as Record<string, unknown>
    expect(updatePayload).toEqual(
      expect.not.objectContaining({ price_at_booking: expect.anything() }),
    )
    expect(updatePayload).toEqual(
      expect.not.objectContaining({ booking_fee_pence: expect.anything() }),
    )

    // The real PaymentIntent is looked up for fee capture — unaffected by
    // the comp-detection redefinition.
    expect(paymentIntentsRetrieveMock).toHaveBeenCalledWith(
      'pi_ordinary',
      expect.objectContaining({
        expand: expect.arrayContaining(['latest_charge.balance_transaction']),
      }),
    )
  })

  // ── charge.refunded (P2-7b) ────────────────────────────────────────────

  function chargeRefundedEvent(opts: { refundId: string; paymentIntent: string; amount: number }) {
    return {
      type: 'charge.refunded',
      data: {
        object: {
          id: 'ch_123',
          payment_intent: opts.paymentIntent,
          refunds: {
            data: [
              {
                id: opts.refundId,
                amount: opts.amount,
                created: 1_700_000_000,
              },
            ],
          },
        },
      },
    }
  }

  it('charge.refunded: reconciles an admin-dashboard refund to its booking', async () => {
    const POST = await importRoute()
    supabaseHandle = makeSupabaseMock()

    // 1st maybeSingle: idempotency check (no existing row with this refund_id).
    // 2nd maybeSingle: find-by-payment-intent (returns the booking).
    supabaseHandle.maybeSingle
      .mockResolvedValueOnce({ data: null, error: null }) // idempotency: none
      .mockResolvedValueOnce({
        data: { id: 'b1', status: 'confirmed' },
        error: null,
      })

    constructEventMock.mockReturnValue(
      chargeRefundedEvent({ refundId: 're_abc', paymentIntent: 'pi_456', amount: 3500 }),
    )

    const res = await POST(makeRequest('{}', 't=1,v1=sig'))
    expect(res.status).toBe(200)

    // UPDATE sets status=cancelled and writes refund audit fields.
    const updateCalls = (supabaseHandle.chain.update as ReturnType<typeof vi.fn>).mock.calls
    expect(updateCalls.length).toBe(1)
    const payload = updateCalls[0][0]
    expect(payload.status).toBe('cancelled')
    expect(payload.stripe_refund_id).toBe('re_abc')
    expect(payload.refunded_amount_pence).toBe(3500)
    expect(payload.cancelled_at).toBeTruthy()
    expect(payload.refunded_at).toBeTruthy()
  })

  it('charge.refunded: no-ops when the refund id has already been reconciled', async () => {
    const POST = await importRoute()
    supabaseHandle = makeSupabaseMock()

    // Idempotency check returns an existing row — we've seen this refund before.
    supabaseHandle.maybeSingle.mockResolvedValueOnce({
      data: { id: 'b1' },
      error: null,
    })

    constructEventMock.mockReturnValue(
      chargeRefundedEvent({ refundId: 're_abc', paymentIntent: 'pi_456', amount: 3500 }),
    )

    const res = await POST(makeRequest('{}', 't=1,v1=sig'))
    expect(res.status).toBe(200)
    // No UPDATE should fire when we short-circuit on idempotency.
    expect(supabaseHandle.chain.update).not.toHaveBeenCalled()
  })

  it('charge.refunded: no-ops when no matching booking is found for the PaymentIntent', async () => {
    const POST = await importRoute()
    supabaseHandle = makeSupabaseMock()

    supabaseHandle.maybeSingle
      .mockResolvedValueOnce({ data: null, error: null }) // idempotency: none
      .mockResolvedValueOnce({ data: null, error: null }) // find-by-PI: none

    constructEventMock.mockReturnValue(
      chargeRefundedEvent({ refundId: 're_xyz', paymentIntent: 'pi_unknown', amount: 3500 }),
    )

    const res = await POST(makeRequest('{}', 't=1,v1=sig'))
    expect(res.status).toBe(200)
    expect(supabaseHandle.chain.update).not.toHaveBeenCalled()
  })

  it('charge.refunded: picks the latest refund when multiple are in the payload', async () => {
    const POST = await importRoute()
    supabaseHandle = makeSupabaseMock()

    supabaseHandle.maybeSingle
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({
        data: { id: 'b1', status: 'confirmed' },
        error: null,
      })

    constructEventMock.mockReturnValue({
      type: 'charge.refunded',
      data: {
        object: {
          id: 'ch_123',
          payment_intent: 'pi_456',
          refunds: {
            data: [
              { id: 're_old', amount: 1000, created: 1_500_000_000 },
              { id: 're_new', amount: 3500, created: 1_700_000_000 },
            ],
          },
        },
      },
    })

    const res = await POST(makeRequest('{}', 't=1,v1=sig'))
    expect(res.status).toBe(200)
    const payload = (supabaseHandle.chain.update as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(payload.stripe_refund_id).toBe('re_new')
    expect(payload.refunded_amount_pence).toBe(3500)
  })

  it('charge.refunded: no-ops when the payload has no refunds', async () => {
    const POST = await importRoute()
    supabaseHandle = makeSupabaseMock()

    constructEventMock.mockReturnValue({
      type: 'charge.refunded',
      data: {
        object: {
          id: 'ch_123',
          payment_intent: 'pi_456',
          refunds: { data: [] },
        },
      },
    })

    const res = await POST(makeRequest('{}', 't=1,v1=sig'))
    expect(res.status).toBe(200)
    expect(supabaseHandle.chain.update).not.toHaveBeenCalled()
  })

  // ── refund-fee-deduction: stripe_fee_pence capture ─────────────────────
  //
  // After confirming the booking row on checkout.session.completed, the
  // webhook retrieves the PaymentIntent with the BalanceTransaction
  // expansion and writes the actual processing fee to
  // bookings.stripe_fee_pence (reporting only — not used in refund math).

  it('writes stripe_fee_pence after confirming the booking', async () => {
    const POST = await importRoute()
    supabaseHandle = makeSupabaseMock()

    // First UPDATE returns the confirmed booking (status flip).
    // The second UPDATE (stripe_fee_pence write) awaits the chain
    // directly with no .maybeSingle() so the chain shape is enough.
    supabaseHandle.maybeSingle.mockResolvedValue({
      data: { id: 'b1', user_id: 'u1', event_id: 'e1' },
      error: null,
    })
    // The email-send path triggers SELECTs (profile, event, booking).
    supabaseHandle.single.mockResolvedValueOnce({
      data: { full_name: 'Charlotte', email: 'ch@example.com' },
      error: null,
    })
    supabaseHandle.single.mockResolvedValueOnce({
      data: {
        title: 'Wine & Wisdom',
        slug: 'wine-wisdom',
        date_time: '2026-05-07T19:00:00Z',
        venue_name: 'Cellar',
        venue_address: '1 Bank End',
        venue_revealed: true,
      },
      error: null,
    })

    // PaymentIntent.retrieve resolves with the expanded BalanceTransaction.
    paymentIntentsRetrieveMock.mockResolvedValueOnce({
      id: 'pi_456',
      latest_charge: {
        id: 'ch_789',
        balance_transaction: {
          id: 'txn_abc',
          // 41p — typical UK domestic card on a ~£20 charge.
          fee: 41,
        },
      },
    })

    constructEventMock.mockReturnValue({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_123',
          payment_status: 'paid',
          payment_intent: 'pi_456',
          metadata: { booking_id: 'b1' },
        },
      },
    })

    const res = await POST(makeRequest('{}', 't=1,v1=sig'))
    expect(res.status).toBe(200)

    // The retrieve call must request the expanded chain.
    expect(paymentIntentsRetrieveMock).toHaveBeenCalledWith(
      'pi_456',
      expect.objectContaining({
        expand: expect.arrayContaining(['latest_charge.balance_transaction']),
      }),
    )

    // The chain.update was called at least twice: once for the booking
    // confirmation, once for the stripe_fee_pence write. Find the call
    // with stripe_fee_pence in the payload.
    const updateCalls = (supabaseHandle.chain.update as ReturnType<typeof vi.fn>).mock.calls
    const feeWrite = updateCalls.find(
      (c) =>
        (c[0] as Record<string, unknown>).stripe_fee_pence === 41,
    )
    expect(feeWrite).toBeTruthy()
  })

  it('continues when BalanceTransaction retrieve throws (booking still confirmed)', async () => {
    const POST = await importRoute()
    supabaseHandle = makeSupabaseMock()

    supabaseHandle.maybeSingle.mockResolvedValue({
      data: { id: 'b1', user_id: 'u1', event_id: 'e1' },
      error: null,
    })
    supabaseHandle.single.mockResolvedValueOnce({
      data: { full_name: 'Charlotte', email: 'ch@example.com' },
      error: null,
    })
    supabaseHandle.single.mockResolvedValueOnce({
      data: {
        title: 'Wine & Wisdom',
        slug: 'wine-wisdom',
        date_time: '2026-05-07T19:00:00Z',
        venue_name: 'Cellar',
        venue_address: '1 Bank End',
        venue_revealed: true,
      },
      error: null,
    })

    paymentIntentsRetrieveMock.mockRejectedValueOnce(
      new Error('Stripe is down'),
    )

    constructEventMock.mockReturnValue({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_123',
          payment_status: 'paid',
          payment_intent: 'pi_456',
          metadata: { booking_id: 'b1' },
        },
      },
    })

    // The webhook must still return 200 and the booking-confirm UPDATE
    // must have fired. The fee-write UPDATE is silently skipped.
    const res = await POST(makeRequest('{}', 't=1,v1=sig'))
    expect(res.status).toBe(200)
    const updateCalls = (supabaseHandle.chain.update as ReturnType<typeof vi.fn>).mock.calls
    // The booking confirm payload includes status: 'confirmed'.
    const confirm = updateCalls.find(
      (c) => (c[0] as Record<string, unknown>).status === 'confirmed',
    )
    expect(confirm).toBeTruthy()
    // No fee-write occurred (the throw happened before the UPDATE).
    const feeWrite = updateCalls.find(
      (c) => 'stripe_fee_pence' in (c[0] as Record<string, unknown>),
    )
    expect(feeWrite).toBeUndefined()
  })

  it('skips fee write when latest_charge is missing from the PaymentIntent', async () => {
    const POST = await importRoute()
    supabaseHandle = makeSupabaseMock()

    supabaseHandle.maybeSingle.mockResolvedValue({
      data: { id: 'b1', user_id: 'u1', event_id: 'e1' },
      error: null,
    })
    supabaseHandle.single.mockResolvedValueOnce({
      data: { full_name: 'Charlotte', email: 'ch@example.com' },
      error: null,
    })
    supabaseHandle.single.mockResolvedValueOnce({
      data: {
        title: 'Wine & Wisdom',
        slug: 'wine-wisdom',
        date_time: '2026-05-07T19:00:00Z',
        venue_name: 'Cellar',
        venue_address: '1 Bank End',
        venue_revealed: true,
      },
      error: null,
    })

    paymentIntentsRetrieveMock.mockResolvedValueOnce({
      id: 'pi_456',
      latest_charge: null, // Stripe didn't expand it for some reason
    })

    constructEventMock.mockReturnValue({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_123',
          payment_status: 'paid',
          payment_intent: 'pi_456',
          metadata: { booking_id: 'b1' },
        },
      },
    })

    const res = await POST(makeRequest('{}', 't=1,v1=sig'))
    expect(res.status).toBe(200)
    const updateCalls = (supabaseHandle.chain.update as ReturnType<typeof vi.fn>).mock.calls
    const feeWrite = updateCalls.find(
      (c) => 'stripe_fee_pence' in (c[0] as Record<string, unknown>),
    )
    expect(feeWrite).toBeUndefined()
  })

  // ── admin-waitlist-promotion-payment: hold reconciliation ──────────────
  //
  // SYSTEM-DESIGN-admin-waitlist-promotion-payment.md §5 site #1. A
  // `pending_payment` row created by an admin promotion
  // (createAdminBookingHold / admin_promote_waitlist_to_hold) carries
  // is_admin_hold=true. When the member actually pays, this webhook must
  // reconcile it exactly like an ordinary paid booking — confirmed,
  // stripe_payment_id set — AND additionally flip is_admin_hold back to
  // false / admin_hold_expires_at back to null, or the row would violate
  // chk_bookings_admin_hold_requires_pending_payment the instant status
  // leaves pending_payment.

  it('INVARIANT: a hold-originated pending_payment row (is_admin_hold=true) is confirmed AND both hold columns are cleared', async () => {
    const POST = await importRoute()
    supabaseHandle = makeSupabaseMock()

    // The row being confirmed IS a hold (is_admin_hold=true,
    // admin_hold_expires_at=null — this PR's actual shape, since
    // holdExpiresAt is hardcoded null). The webhook's UPDATE doesn't
    // branch on the row's prior is_admin_hold value at all — it clears
    // both columns unconditionally — so the returned row here only needs
    // to prove the UPDATE payload the webhook SENDS, not echo back the
    // pre-image. What matters is that this scenario (a real hold, not an
    // ordinary checkout) is the one under test.
    supabaseHandle.maybeSingle.mockResolvedValue({
      data: { id: 'bk-hold', user_id: 'amy-1', event_id: 'evt-screening' },
      error: null,
    })
    supabaseHandle.single.mockResolvedValueOnce({
      data: { full_name: 'Amy Sangam', email: 'amy@example.com' },
      error: null,
    })
    supabaseHandle.single.mockResolvedValueOnce({
      data: {
        title: 'France vs Spain Screening',
        slug: 'france-vs-spain-screening',
        date_time: '2026-07-14T19:00:00Z',
        venue_name: 'The Pub',
        venue_address: '1 High St',
        venue_revealed: true,
      },
      error: null,
    })

    constructEventMock.mockReturnValue({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_hold_paid',
          payment_status: 'paid',
          payment_intent: 'pi_hold_paid',
          metadata: { booking_id: 'bk-hold' },
        },
      },
    })

    const res = await POST(makeRequest('{}', 't=1,v1=sig'))
    expect(res.status).toBe(200)

    expect(supabaseHandle.chain.update).toHaveBeenCalledWith({
      status: 'confirmed',
      stripe_payment_id: 'pi_hold_paid',
      waitlist_position: null,
      is_admin_hold: false,
      admin_hold_expires_at: null,
    })
    // Confirmed via the SAME optimistic guard as any other booking — the
    // webhook has no special-cased "hold" code path, which is precisely
    // the point (one UPDATE payload, unconditionally correct for both
    // ordinary and hold-originated rows).
    expect(supabaseHandle.chain.eq).toHaveBeenCalledWith('id', 'bk-hold')
    expect(supabaseHandle.chain.eq).toHaveBeenCalledWith('status', 'pending_payment')
  })

  it("defensive gap check: the .eq('status','pending_payment') guard still protects an ALREADY-confirmed row from being re-processed", async () => {
    // The architect flagged this as the core defensive risk to prove
    // (spec, webhook reconciliation section): if a Checkout Session were
    // somehow created against a row that is already 'confirmed' — not
    // the code path this PR ships (createAdminBookingHold only ever
    // creates a session for a row the RPC just flipped to
    // pending_payment), but worth proving the guard holds regardless of
    // HOW such a session came to exist. The .eq('status',
    // 'pending_payment') filter means the UPDATE matches zero rows, so
    // the webhook can never re-confirm (or double-process side effects
    // for) an already-confirmed booking.
    const POST = await importRoute()
    supabaseHandle = makeSupabaseMock()

    // Simulates the filter matching nothing: the row exists but is not
    // in pending_payment, so the optimistic-guarded UPDATE affects 0 rows
    // and maybeSingle() resolves null — identical wire behaviour to the
    // "already processed" cases covered elsewhere in this file.
    supabaseHandle.maybeSingle.mockResolvedValue({ data: null, error: null })

    constructEventMock.mockReturnValue({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_already_confirmed',
          payment_status: 'paid',
          payment_intent: 'pi_already_confirmed',
          metadata: { booking_id: 'bk-already-confirmed' },
        },
      },
    })

    const consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

    const res = await POST(makeRequest('{}', 't=1,v1=sig'))
    expect(res.status).toBe(200)

    // The UPDATE was attempted (the guard itself is what protects, not a
    // pre-check) but the .eq('status','pending_payment') filter is
    // demonstrably present on every attempt.
    const eqCalls = (supabaseHandle.chain.eq as ReturnType<typeof vi.fn>).mock.calls
    const hasStatusGuard = eqCalls.some(
      ([col, val]) => col === 'status' && val === 'pending_payment',
    )
    expect(hasStatusGuard).toBe(true)

    // No confirmation email fires for a no-op — the row was never
    // (re-)confirmed by this delivery.
    expect(vi.mocked(sendEmail)).not.toHaveBeenCalled()

    // The "no row matched" breadcrumb is logged (same operator signal as
    // the admin-mid-checkout-race suite) so a genuinely unexpected
    // already-confirmed collision is still discoverable in logs.
    const logged = consoleInfoSpy.mock.calls.flat().join(' ')
    expect(logged).toMatch(/no pending_payment booking matched/i)
    consoleInfoSpy.mockRestore()
  })
})
