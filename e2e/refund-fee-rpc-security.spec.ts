import { test, expect } from '@playwright/test'
import {
  createTestEvent,
  createTestUser,
  purgeRun,
} from './helpers/fixtures'
import {
  getAdminClient,
  getE2EAnonKey,
  getE2EUrl,
} from './helpers/supabase'

/**
 * Security edge-case coverage for the refund-fee-deduction RPCs. The
 * formula + happy-path columns + Server-Action paths are already pinned
 * by Vitest. This suite exercises the security boundaries that only the
 * real Postgres + RLS stack can express:
 *
 *   1. Anon SELECT on bookings.booking_fee_pence / .stripe_fee_pence is
 *      blocked at the table level (no anon SELECT on bookings at all).
 *   2. An authenticated user calling book_event_paid with a NEGATIVE fee
 *      is rejected by the early guard (clean JSON error, not a raw
 *      23514 constraint violation).
 *   3. book_event_paid called against a FREE event (price = 0) is
 *      rejected by the explicit early-return guard — never gets to the
 *      INSERT where the CHECK chk_bookings_free_no_booking_fee would
 *      also catch it.
 *   4. Direct INSERT of a free booking with a non-zero booking_fee_pence
 *      trips the CHECK constraint. Defence-in-depth: the RPC blocks the
 *      legit path; the constraint blocks every other path.
 *
 * Pattern mirrors booking-rpcs.spec.ts — RPCs called via PostgREST with
 * the seeded user's access token, never the service role.
 */

async function callRpc<T = unknown>(
  rpc: 'book_event_paid' | 'claim_waitlist_spot',
  args: Record<string, unknown>,
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
}

test.describe('refund-fee-deduction RPC security boundaries', () => {
  // Mirrors the booking-rpcs and auth suites — local Supabase + PostgREST
  // are sometimes slow under CI load. Two retries absorb that without
  // masking a real regression (memory: project_flaky_e2e_daily_notifications).
  test.describe.configure({ retries: 2 })

  test.afterAll(async () => {
    await purgeRun(getAdminClient())
  })

  // ── Scenario 1: anon cannot read booking_fee_pence / stripe_fee_pence ───
  //
  // The migration 20260517000001 deliberately did NOT add an anon GRANT
  // (per the secure-by-default rule documented in CLAUDE.md and the
  // migration header). Bookings have no anon SELECT policy at all, so
  // an anon-context query MUST come back empty (not "filtered to rows
  // anon can read" — there is no such set). This catches a regression
  // where someone adds an anon SELECT policy "to make profile counts
  // work" without realising it now exposes payment internals.
  test('1: anon SELECT on bookings.booking_fee_pence returns no rows', async () => {
    const admin = getAdminClient()

    // Seed an event + paid booking via admin so we KNOW there's at least
    // one row in the table that an anon SELECT could theoretically see.
    const user = await createTestUser(admin, { tag: 'sec1-owner' })
    const event = await createTestEvent(admin, {
      tag: 'sec1',
      price: 2000,
      capacity: 5,
    })
    const { error: insertErr } = await admin.from('bookings').insert({
      user_id: user.id,
      event_id: event.id,
      status: 'confirmed',
      price_at_booking: 2000,
      booking_fee_pence: 60,
      stripe_fee_pence: 41,
    })
    if (insertErr) throw insertErr

    // Now query with ONLY the anon key, no Authorization header. PostgREST
    // honours RLS — without auth.uid() the user-owned bookings row is
    // invisible.
    const res = await fetch(
      `${getE2EUrl()}/rest/v1/bookings?select=booking_fee_pence,stripe_fee_pence`,
      {
        method: 'GET',
        headers: {
          apikey: getE2EAnonKey(),
          // No Authorization header — pure anon context.
        },
      },
    )
    expect(res.ok).toBe(true)
    const rows = (await res.json()) as Array<Record<string, unknown>>

    // The seeded row exists in the DB but anon cannot see it. Empty
    // result = RLS doing its job. If a future "improvement" adds
    // an anon SELECT this test fails.
    expect(Array.isArray(rows)).toBe(true)
    expect(rows.length).toBe(0)
  })

  // ── Scenario 2: another authenticated user can't read MY fee fields ──
  //
  // Even with a valid JWT, the bookings_select policy is row-owner-only
  // (or admin). User B querying bookings for User A's event must come
  // back empty.
  test('2: authenticated user cannot read another user\'s booking_fee_pence', async () => {
    const admin = getAdminClient()

    const owner = await createTestUser(admin, { tag: 'sec2-owner' })
    const peeker = await createTestUser(admin, { tag: 'sec2-peeker' })
    const event = await createTestEvent(admin, {
      tag: 'sec2',
      price: 2000,
      capacity: 5,
    })
    await admin.from('bookings').insert({
      user_id: owner.id,
      event_id: event.id,
      status: 'confirmed',
      price_at_booking: 2000,
      booking_fee_pence: 60,
    })

    // Peeker authenticates. Tries to read bookings for the owner's event.
    const res = await fetch(
      `${getE2EUrl()}/rest/v1/bookings?select=booking_fee_pence&event_id=eq.${event.id}`,
      {
        headers: {
          apikey: getE2EAnonKey(),
          Authorization: `Bearer ${peeker.accessToken}`,
        },
      },
    )
    expect(res.ok).toBe(true)
    const rows = (await res.json()) as Array<Record<string, unknown>>
    expect(rows.length).toBe(0)
  })

  // ── Scenario 3: book_event_paid rejects negative fee ──
  //
  // The function-level guard returns `{ error: 'Invalid booking fee' }`
  // before INSERT. Without the guard, the column CHECK would still fire
  // but as a raw 23514 (which the Server Action would surface as
  // "Something went wrong" — useless to a debugger).
  test('3: book_event_paid rejects negative booking fee', async () => {
    const admin = getAdminClient()
    const user = await createTestUser(admin, { tag: 'sec3' })
    const event = await createTestEvent(admin, {
      tag: 'sec3',
      price: 2000,
      capacity: 5,
    })

    const result = await callRpc<RpcResult>(
      'book_event_paid',
      {
        p_user_id: user.id,
        p_event_id: event.id,
        p_booking_fee_pence: -100,
      },
      user.accessToken,
    )

    expect(result.error).toMatch(/invalid booking fee/i)
    expect(result.booking_id).toBeUndefined()
  })

  // ── Scenario 4: book_event_paid rejects free-event paid booking ──
  //
  // book_event_paid has an explicit `IF v_price = 0 THEN ... ELSE` guard
  // that surfaces "Use book_event for free events". This is the early-
  // return guard; the column CHECK chk_bookings_free_no_booking_fee
  // would also catch it at INSERT, but the guard gives a meaningful
  // error string.
  test('4: book_event_paid rejects free event with non-zero fee', async () => {
    const admin = getAdminClient()
    const user = await createTestUser(admin, { tag: 'sec4' })
    // Free event — price 0.
    const event = await createTestEvent(admin, {
      tag: 'sec4',
      price: 0,
      capacity: 5,
    })

    const result = await callRpc<RpcResult>(
      'book_event_paid',
      {
        p_user_id: user.id,
        p_event_id: event.id,
        p_booking_fee_pence: 60,
      },
      user.accessToken,
    )

    // The early-return guard fires. Spec text matches exactly so a
    // future copy change surfaces here.
    expect(result.error).toMatch(/use book_event for free events/i)
    expect(result.booking_id).toBeUndefined()
  })

  // ── Scenario 5: CHECK chk_bookings_free_no_booking_fee — direct INSERT ─
  //
  // Defence in depth. Even if some future code path bypasses the RPC
  // guard (admin tool, manual SQL, future cron), the table-level CHECK
  // must still fire and refuse the bad row. We use the service role to
  // attempt the INSERT — without the CHECK, it would succeed.
  test('5: CHECK fires on direct INSERT of free booking with non-zero fee', async () => {
    const admin = getAdminClient()
    const user = await createTestUser(admin, { tag: 'sec5' })
    const event = await createTestEvent(admin, {
      tag: 'sec5',
      price: 0,
      capacity: 5,
    })

    const { error } = await admin.from('bookings').insert({
      user_id: user.id,
      event_id: event.id,
      status: 'confirmed',
      price_at_booking: 0,
      booking_fee_pence: 50,
    })

    // The constraint name is `chk_bookings_free_no_booking_fee`; the
    // Postgres error message usually includes it. We assert the row
    // didn't sneak in either way.
    expect(error).toBeTruthy()
    expect(error?.message ?? '').toMatch(/chk_bookings_free_no_booking_fee|check constraint/i)

    // Reality-check: no row was actually inserted.
    const { count } = await admin
      .from('bookings')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('event_id', event.id)
    expect(count).toBe(0)
  })

  // ── Scenario 6: CHECK chk_bookings_booking_fee_non_negative ──
  //
  // The non-negative CHECK is also defence-in-depth — the RPC guard
  // returns "Invalid booking fee" first. We test it by bypassing the
  // RPC entirely.
  test('6: CHECK fires on direct INSERT of negative booking_fee_pence', async () => {
    const admin = getAdminClient()
    const user = await createTestUser(admin, { tag: 'sec6' })
    const event = await createTestEvent(admin, {
      tag: 'sec6',
      price: 2000,
      capacity: 5,
    })

    const { error } = await admin.from('bookings').insert({
      user_id: user.id,
      event_id: event.id,
      status: 'confirmed',
      price_at_booking: 2000,
      booking_fee_pence: -1,
    })

    expect(error).toBeTruthy()
    expect(error?.message ?? '').toMatch(/chk_bookings_booking_fee_non_negative|check constraint/i)
  })

  // ── Scenario 7: claim_waitlist_spot rejects negative fee ──
  //
  // Mirrors scenario 3 but for the waitlist-claim RPC. Same guard
  // shape, same error message.
  test('7: claim_waitlist_spot rejects negative booking fee', async () => {
    const admin = getAdminClient()
    const user = await createTestUser(admin, { tag: 'sec7' })
    const event = await createTestEvent(admin, {
      tag: 'sec7',
      price: 2000,
      capacity: 1,
    })

    // Seed a waitlist row so the function gets past the existence check.
    await admin.from('bookings').insert({
      user_id: user.id,
      event_id: event.id,
      status: 'waitlisted',
      waitlist_position: 1,
      price_at_booking: 2000,
      booking_fee_pence: 60,
    })

    const result = await callRpc<RpcResult>(
      'claim_waitlist_spot',
      {
        p_user_id: user.id,
        p_event_id: event.id,
        p_booking_fee_pence: -50,
      },
      user.accessToken,
    )

    expect(result.error).toMatch(/invalid booking fee/i)
  })
})
