import { test, expect } from '@playwright/test'
import {
  createTestEvent,
  createTestUser,
  fillEventToCapacity,
  purgeRun,
} from './helpers/fixtures'
import { getAdminClient, getE2EAnonKey, getE2EUrl } from './helpers/supabase'

/**
 * Automated port of the 12 scenarios from
 * docs/BOOKING-RPCS-TEST-PLAN.md. Each scenario seeds its own state,
 * calls the RPC via PostgREST with a user JWT, and asserts the
 * returned jsonb shape.
 *
 * The RPCs enforce `p_user_id = auth.uid()` — so every call uses the
 * user's access token, not the service-role key. Running as an
 * authenticated caller is the production security boundary; testing
 * as service-role would bypass the guard and prove nothing.
 */

async function callRpc<T = unknown>(
  rpc: 'book_event' | 'book_event_paid' | 'claim_waitlist_spot',
  args: Record<string, string>,
  accessToken: string,
): Promise<T> {
  const res = await fetch(`${getE2EUrl()}/rest/v1/rpc/${rpc}`, {
    method: 'POST',
    headers: {
      apikey: getE2EAnonKey(),
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  })
  if (!res.ok) {
    throw new Error(
      `${rpc} returned HTTP ${res.status}: ${await res.text().catch(() => '<no body>')}`,
    )
  }
  return (await res.json()) as T
}

type RpcResult = {
  error?: string
  booking_id?: string
  status?: string
  waitlist_position?: number | null
}

test.describe('Booking RPCs — 12 scenarios', () => {
  test.afterAll(async () => {
    await purgeRun(getAdminClient())
  })

  // ── Scenario 1 ─────────────────────────────────────────────────────────
  test('1: unverified user cannot book — "Verify your email"', async () => {
    const admin = getAdminClient()
    const user = await createTestUser(admin, { emailVerified: false, tag: 's1' })
    const event = await createTestEvent(admin, { tag: 's1' })

    const result = await callRpc<RpcResult>(
      'book_event',
      { p_user_id: user.id, p_event_id: event.id },
      user.accessToken,
    )

    expect(result.error).toMatch(/verify your email/i)
    expect(result.booking_id).toBeUndefined()
  })

  // ── Scenario 2 ─────────────────────────────────────────────────────────
  test('2: suspended user cannot book — "Account is not active"', async () => {
    const admin = getAdminClient()
    const user = await createTestUser(admin, { status: 'suspended', tag: 's2' })
    const event = await createTestEvent(admin, { tag: 's2' })

    const result = await callRpc<RpcResult>(
      'book_event',
      { p_user_id: user.id, p_event_id: event.id },
      user.accessToken,
    )

    expect(result.error).toMatch(/suspended/i)
  })

  // ── Scenario 3 ─────────────────────────────────────────────────────────
  test('3: banned user cannot book — "Account has been closed"', async () => {
    const admin = getAdminClient()
    const user = await createTestUser(admin, { status: 'banned', tag: 's3' })
    const event = await createTestEvent(admin, { tag: 's3' })

    const result = await callRpc<RpcResult>(
      'book_event',
      { p_user_id: user.id, p_event_id: event.id },
      user.accessToken,
    )

    expect(result.error).toMatch(/closed/i)
  })

  // ── Scenario 4 ─────────────────────────────────────────────────────────
  test('4: verified active user books a free event with capacity — confirmed', async () => {
    const admin = getAdminClient()
    const user = await createTestUser(admin, { tag: 's4' })
    const event = await createTestEvent(admin, { tag: 's4', capacity: 5 })

    const result = await callRpc<RpcResult>(
      'book_event',
      { p_user_id: user.id, p_event_id: event.id },
      user.accessToken,
    )

    expect(result.status).toBe('confirmed')
    expect(result.booking_id).toBeTruthy()
    expect(result.waitlist_position).toBeNull()
  })

  // ── Scenario 5 ─────────────────────────────────────────────────────────
  test('5: booking a full free event is waitlisted with correct position', async () => {
    const admin = getAdminClient()
    const event = await createTestEvent(admin, { tag: 's5', capacity: 2 })
    await fillEventToCapacity(admin, event, 2, 's5-fill')

    const user = await createTestUser(admin, { tag: 's5' })
    const result = await callRpc<RpcResult>(
      'book_event',
      { p_user_id: user.id, p_event_id: event.id },
      user.accessToken,
    )

    expect(result.status).toBe('waitlisted')
    expect(result.waitlist_position).toBe(1)
  })

  // ── Scenario 6 ─────────────────────────────────────────────────────────
  test('6: book_event rejects paid events — "Use book_event_paid"', async () => {
    const admin = getAdminClient()
    const user = await createTestUser(admin, { tag: 's6' })
    const event = await createTestEvent(admin, { tag: 's6', price: 2500 })

    const result = await callRpc<RpcResult>(
      'book_event',
      { p_user_id: user.id, p_event_id: event.id },
      user.accessToken,
    )

    expect(result.error).toMatch(/book_event_paid/i)
  })

  // ── Scenario 7 ─────────────────────────────────────────────────────────
  test('7: book_event_paid on a paid event with capacity — pending_payment', async () => {
    const admin = getAdminClient()
    const user = await createTestUser(admin, { tag: 's7' })
    const event = await createTestEvent(admin, { tag: 's7', price: 2500, capacity: 5 })

    const result = await callRpc<RpcResult>(
      'book_event_paid',
      { p_user_id: user.id, p_event_id: event.id },
      user.accessToken,
    )

    expect(result.status).toBe('pending_payment')
    expect(result.booking_id).toBeTruthy()
  })

  // ── Scenario 8 ─────────────────────────────────────────────────────────
  test('8: booking a cancelled event — "Event is cancelled"', async () => {
    const admin = getAdminClient()
    const user = await createTestUser(admin, { tag: 's8' })
    const event = await createTestEvent(admin, { tag: 's8', isCancelled: true })

    const result = await callRpc<RpcResult>(
      'book_event',
      { p_user_id: user.id, p_event_id: event.id },
      user.accessToken,
    )

    expect(result.error).toMatch(/cancelled/i)
  })

  // ── Scenario 9 ─────────────────────────────────────────────────────────
  test('9: booking a soft-deleted event — "Event not found"', async () => {
    const admin = getAdminClient()
    const user = await createTestUser(admin, { tag: 's9' })
    const event = await createTestEvent(admin, { tag: 's9', softDeleted: true })

    const result = await callRpc<RpcResult>(
      'book_event',
      { p_user_id: user.id, p_event_id: event.id },
      user.accessToken,
    )

    expect(result.error).toMatch(/not found/i)
  })

  // ── Scenario 10 ────────────────────────────────────────────────────────
  test('10: concurrent bookings for the last seat — exactly one confirmed', async () => {
    const admin = getAdminClient()
    const event = await createTestEvent(admin, { tag: 's10', capacity: 1 })

    const [userA, userB] = await Promise.all([
      createTestUser(admin, { tag: 's10a' }),
      createTestUser(admin, { tag: 's10b' }),
    ])

    // Fire both RPC calls in parallel. FOR UPDATE in book_event should
    // serialize them: one confirmed, one waitlisted (position 1).
    const [resA, resB] = await Promise.all([
      callRpc<RpcResult>(
        'book_event',
        { p_user_id: userA.id, p_event_id: event.id },
        userA.accessToken,
      ),
      callRpc<RpcResult>(
        'book_event',
        { p_user_id: userB.id, p_event_id: event.id },
        userB.accessToken,
      ),
    ])

    const statuses = [resA.status, resB.status].sort()
    expect(statuses).toEqual(['confirmed', 'waitlisted'])

    // Reality-check: exactly one confirmed row in the DB.
    const { count } = await admin
      .from('bookings')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', event.id)
      .eq('status', 'confirmed')
    expect(count).toBe(1)
  })

  // ── Scenario 11 ────────────────────────────────────────────────────────
  test('11: claim_waitlist_spot promotes position-1 waitlister when a seat frees', async () => {
    const admin = getAdminClient()
    const event = await createTestEvent(admin, { tag: 's11', capacity: 1 })

    // Seat filler (will cancel), and our waitlisted user.
    const filler = await createTestUser(admin, { tag: 's11-fill' })
    const { error: fillErr } = await admin.from('bookings').insert({
      user_id: filler.id,
      event_id: event.id,
      status: 'confirmed',
      price_at_booking: 0,
    })
    if (fillErr) throw fillErr

    const waiter = await createTestUser(admin, { tag: 's11-waiter' })
    const { error: waitErr } = await admin.from('bookings').insert({
      user_id: waiter.id,
      event_id: event.id,
      status: 'waitlisted',
      waitlist_position: 1,
      price_at_booking: 0,
    })
    if (waitErr) throw waitErr

    // Filler cancels — frees the seat.
    const { error: cancelErr } = await admin
      .from('bookings')
      .update({ status: 'cancelled' })
      .eq('user_id', filler.id)
      .eq('event_id', event.id)
    if (cancelErr) throw cancelErr

    // Waiter claims.
    const result = await callRpc<RpcResult>(
      'claim_waitlist_spot',
      { p_user_id: waiter.id, p_event_id: event.id },
      waiter.accessToken,
    )

    // Free event: transition goes straight to confirmed. Paid events
    // would transition to pending_payment + return a checkout URL, but
    // this scenario uses a free event.
    //
    // Note: `claim_waitlist_spot` doesn't enforce position-1-first
    // ordering at the DB layer — it only checks capacity. First-click-
    // wins ordering is app-level (the Server Action races on
    // claim_waitlist_spot, the slowest lose). This test covers the
    // single-waiter happy path; multi-waiter racing belongs in a
    // future scenario.
    expect(result.status).toBe('confirmed')
  })

  // ── Scenario 12 ────────────────────────────────────────────────────────
  test('12: claim_waitlist_spot rejects when no seat has freed — "No spot available"', async () => {
    const admin = getAdminClient()
    const event = await createTestEvent(admin, { tag: 's12', capacity: 1 })

    const filler = await createTestUser(admin, { tag: 's12-fill' })
    const { error: fillErr } = await admin.from('bookings').insert({
      user_id: filler.id,
      event_id: event.id,
      status: 'confirmed',
      price_at_booking: 0,
    })
    if (fillErr) throw fillErr

    const waiter = await createTestUser(admin, { tag: 's12-waiter' })
    const { error: waitErr } = await admin.from('bookings').insert({
      user_id: waiter.id,
      event_id: event.id,
      status: 'waitlisted',
      waitlist_position: 1,
      price_at_booking: 0,
    })
    if (waitErr) throw waitErr

    const result = await callRpc<RpcResult>(
      'claim_waitlist_spot',
      { p_user_id: waiter.id, p_event_id: event.id },
      waiter.accessToken,
    )

    // The RPC returns "Someone else just claimed this spot. You're still
    // on the waitlist." — match the actual copy rather than the generic
    // "no spot available" intent from the test plan.
    expect(result.error).toMatch(/claimed|waitlist/i)
  })
})
