/**
 * Server-Action coverage for the member-mobile-phone feature — the phone
 * merge + PII boundary across the three admin list actions
 * (`getEventBookings`, `getAdminMembers`, `exportEventAttendeesCSV`) and the
 * shared `fetchPhoneMap` helper they all go through.
 *
 * ── What is NEW here vs. the pre-existing coupled tests ──────────────────────
 *  - csv-attendees.test.ts already pins the CSV header + name/email injection
 *    guard + the non-admin reject (T2-*). This file adds the Mobile-cell
 *    injection guard, the null-Mobile cell, the confirmed-only scope, the
 *    single-RPC-call contract, and the unauthenticated reject.
 *  - actions-get-members.test.ts already pins the no-phone-in-select GRANT
 *    guard. This file adds the positive merge (phone populated from the RPC),
 *    the null fallback, the one-RPC-call contract, and the auth rejects.
 *  - getEventBookings had NO dedicated test for the phone merge — added in full
 *    here (merge onto profile.phone_number, null fallback, single RPC call,
 *    auth rejects).
 *
 * ── INVARIANT this file defends ──────────────────────────────────────────────
 * `phone_number` is admin-only PII. It must (a) only ever reach these surfaces
 * via the `admin_get_user_phones` RPC — NEVER a `.select()` — (b) be merged by
 * id with a `?? null` fallback so an absent/soft-deleted member shows no phone
 * (literal `null`, not `''` / not `"null"`), (c) be CSV-injection-guarded on
 * export, and (d) be unreachable by unauthenticated or non-admin callers (the
 * action throws before any data is shaped).
 *
 * NOTE: these tests mock Supabase. The DB-layer admin gate on the RPC itself is
 * asserted statically in
 * src/lib/supabase/__tests__/migration-admin-get-user-phones.test.ts; the
 * column-GRANT revoke in migration-w1-demographics.test.ts. Together those plus
 * this file cover the data contract end-to-end at the layers available without
 * a live DB.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Supabase mock (identical shape to the sibling coupled tests) ─────────────

const mockGetUser = vi.fn()
const mockFrom = vi.fn()
const mockRpc = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(() =>
    Promise.resolve({
      auth: { getUser: mockGetUser },
      from: mockFrom,
      rpc: mockRpc,
    })
  ),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/utils/slugify', () => ({
  slugify: vi.fn((s: string) => s.toLowerCase()),
  uniqueSlug: vi.fn(async (s: string) => s.toLowerCase()),
}))

import {
  getEventBookings,
  getAdminMembers,
  exportEventAttendeesCSV,
} from '../admin/actions'

// ── Chainable PostgREST builder mock ─────────────────────────────────────────

function makeChain(response: { data?: unknown; error?: unknown }) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {}
  for (const m of [
    'select', 'eq', 'neq', 'is', 'or', 'order', 'single', 'maybeSingle',
    'insert', 'update', 'delete', 'in', 'limit', 'gt', 'gte', 'lte',
  ]) {
    chain[m] = vi.fn().mockReturnValue(chain)
  }
  chain.then = vi.fn((resolve: (v: unknown) => void) =>
    resolve({ error: null, ...response })
  )
  return chain
}

/**
 * Admin caller whose first `.from('profiles')` is the requireAdmin role
 * lookup; every subsequent `.from(...)` returns `tableData`. The RPC is stubbed
 * with `phones` so the phone merge runs.
 */
function mockAdmin(tableData: unknown[], phones: unknown[] = []) {
  mockGetUser.mockResolvedValue({ data: { user: { id: 'admin-1' } }, error: null })
  let call = 0
  mockFrom.mockImplementation(() => {
    call++
    if (call === 1) return makeChain({ data: { role: 'admin' } })
    return makeChain({ data: tableData, error: null })
  })
  mockRpc.mockResolvedValue({ data: phones, error: null })
}

function mockMember() {
  mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
  mockFrom.mockImplementation(() => makeChain({ data: { role: 'member' } }))
  mockRpc.mockResolvedValue({ data: [], error: null })
}

function mockUnauthenticated() {
  mockGetUser.mockResolvedValue({
    data: { user: null },
    error: { message: 'no session' },
  })
  mockFrom.mockImplementation(() => makeChain({ data: null }))
  mockRpc.mockResolvedValue({ data: [], error: null })
}

/** Convenience: the single admin_get_user_phones rpc call (or undefined). */
function phoneRpcCalls() {
  return mockRpc.mock.calls.filter((c) => c[0] === 'admin_get_user_phones')
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ════════════════════════════════════════════════════════════════════════════
// getEventBookings — phone merge onto profile.phone_number
// ════════════════════════════════════════════════════════════════════════════

describe('getEventBookings — phone merge', () => {
  const bookingRow = (id: string, profileId: string, name = 'Charlotte') => ({
    id,
    status: 'confirmed',
    waitlist_position: null,
    price_at_booking: 0,
    booking_fee_pence: 0,
    stripe_fee_pence: 0,
    booked_at: '2026-04-10T12:00:00.000Z',
    created_at: '2026-04-10T12:00:00.000Z',
    stripe_payment_id: null,
    stripe_refund_id: null,
    refunded_amount_pence: null,
    cancelled_at: null,
    cancellation_reason: null,
    profile: { id: profileId, full_name: name, email: `${name}@x.com`, avatar_url: null },
  })

  it('merges the RPC phone onto each row.profile.phone_number', async () => {
    mockAdmin(
      [bookingRow('bk-1', 'usr-1', 'Charlotte'), bookingRow('bk-2', 'usr-2', 'James')],
      [
        { user_id: 'usr-1', phone_number: '+447700900111' },
        { user_id: 'usr-2', phone_number: '07700 900222' },
      ]
    )
    const rows = await getEventBookings('evt-1')
    expect(rows[0].profile?.phone_number).toBe('+447700900111')
    expect(rows[1].profile?.phone_number).toBe('07700 900222')
  })

  it('INVARIANT: an attendee the RPC did NOT return gets phone_number === null (not "" / not "null")', async () => {
    mockAdmin(
      [bookingRow('bk-1', 'usr-1'), bookingRow('bk-2', 'usr-2', 'James')],
      // usr-2 omitted: e.g. soft-deleted profile → RPC returns no row for it.
      [{ user_id: 'usr-1', phone_number: '+447700900111' }]
    )
    const rows = await getEventBookings('evt-1')
    expect(rows[1].profile?.phone_number).toBeNull()
    // Guard the exact-null contract from SYSTEM-DESIGN §4.1 against the two
    // sloppy stand-ins a future refactor might introduce.
    expect(rows[1].profile?.phone_number).not.toBe('')
    expect(rows[1].profile?.phone_number).not.toBe('null')
  })

  it('INVARIANT: a member with phone_number NULL from the RPC also collapses to null', async () => {
    // The RPC returns a row (id present) but value null — must not become the
    // string "null" or "".
    mockAdmin([bookingRow('bk-1', 'usr-1')], [{ user_id: 'usr-1', phone_number: null }])
    const rows = await getEventBookings('evt-1')
    expect(rows[0].profile?.phone_number).toBeNull()
  })

  it('INVARIANT: makes EXACTLY ONE admin_get_user_phones RPC call (no N+1), keyed by the attendee ids', async () => {
    mockAdmin(
      [bookingRow('bk-1', 'usr-1'), bookingRow('bk-2', 'usr-2', 'James')],
      []
    )
    await getEventBookings('evt-1')
    const calls = phoneRpcCalls()
    expect(calls).toHaveLength(1)
    expect(calls[0][0]).toBe('admin_get_user_phones')
    expect(calls[0][1]).toEqual({ target_user_ids: ['usr-1', 'usr-2'] })
  })

  it('de-dupes ids before the RPC when a user appears on multiple booking rows', async () => {
    // A member can have e.g. a cancelled + a confirmed row → same id twice.
    mockAdmin(
      [bookingRow('bk-1', 'usr-1'), bookingRow('bk-2', 'usr-1')],
      [{ user_id: 'usr-1', phone_number: '+447700900111' }]
    )
    await getEventBookings('evt-1')
    expect(phoneRpcCalls()[0][1]).toEqual({ target_user_ids: ['usr-1'] })
  })

  it('throws (does not silently blank phones) when the phone RPC errors', async () => {
    // fail-closed: surfaces an authz/infra regression rather than masking it.
    mockGetUser.mockResolvedValue({ data: { user: { id: 'admin-1' } }, error: null })
    let call = 0
    mockFrom.mockImplementation(() => {
      call++
      if (call === 1) return makeChain({ data: { role: 'admin' } })
      return makeChain({ data: [bookingRow('bk-1', 'usr-1')], error: null })
    })
    mockRpc.mockResolvedValue({ data: null, error: { message: 'forbidden' } })
    await expect(getEventBookings('evt-1')).rejects.toThrow(
      /Failed to fetch member phone numbers: forbidden/
    )
  })

  it('SECURITY: rejects a non-admin (member-role) caller before any merge', async () => {
    mockMember()
    await expect(getEventBookings('evt-1')).rejects.toThrow('Admin access required')
    expect(phoneRpcCalls()).toHaveLength(0)
  })

  it('SECURITY: rejects an unauthenticated caller', async () => {
    mockUnauthenticated()
    await expect(getEventBookings('evt-1')).rejects.toThrow('Authentication required')
    expect(phoneRpcCalls()).toHaveLength(0)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// getAdminMembers — phone merge onto MemberWithStats.phone_number
// ════════════════════════════════════════════════════════════════════════════

describe('getAdminMembers — phone merge', () => {
  const profileRow = (id: string, name = 'Charlotte') => ({
    id,
    email: `${name}@x.com`,
    full_name: name,
    role: 'member',
    status: 'active',
    created_at: '2026-01-15T00:00:00.000Z',
  })

  it('populates member.phone_number from the RPC result', async () => {
    mockAdmin(
      // profiles list (call 2) AND bookings (call 3) both resolve to this; the
      // bookings rows just won't match the stats shape, which is fine here.
      [profileRow('usr-1', 'Charlotte')],
      [{ user_id: 'usr-1', phone_number: '+447700900111' }]
    )
    const members = await getAdminMembers()
    expect(members).toHaveLength(1)
    expect(members[0].phone_number).toBe('+447700900111')
  })

  it('INVARIANT: a member absent from the RPC result gets phone_number === null', async () => {
    mockAdmin([profileRow('usr-1'), profileRow('usr-2', 'James')], [
      { user_id: 'usr-1', phone_number: '+447700900111' },
      // usr-2 absent
    ])
    const members = await getAdminMembers()
    const james = members.find((m) => m.id === 'usr-2')!
    expect(james.phone_number).toBeNull()
    expect(james.phone_number).not.toBe('')
    expect(james.phone_number).not.toBe('null')
  })

  it('INVARIANT: makes EXACTLY ONE admin_get_user_phones RPC call (members list can be ~1,000 rows — no N+1)', async () => {
    mockAdmin([profileRow('usr-1'), profileRow('usr-2', 'James')], [])
    await getAdminMembers()
    const calls = phoneRpcCalls()
    expect(calls).toHaveLength(1)
    expect(calls[0][1]).toEqual({ target_user_ids: ['usr-1', 'usr-2'] })
  })

  it('INVARIANT: phone_number is NOT in the .select() string — the merge MUST go via the RPC', async () => {
    // Re-asserts the load-bearing guard (also in actions-get-members.test.ts)
    // from this file so the merge-coupling can never be "fixed" by a future
    // diff that adds phone_number to the select and removes the RPC — which
    // would raise 42501 in prod and re-broaden the GRANT pressure.
    mockGetUser.mockResolvedValue({ data: { user: { id: 'admin-1' } }, error: null })
    let call = 0
    let listSelectArg: string | undefined
    mockFrom.mockImplementation((table: string) => {
      call++
      if (call === 1) return makeChain({ data: { role: 'admin' } })
      if (table === 'profiles') {
        const chain = makeChain({ data: [profileRow('usr-1')], error: null })
        // Capture the select() arg, still returning the chain so the builder
        // continues (every chain method returns `chain`).
        chain.select = vi.fn((arg: string) => {
          listSelectArg = arg
          return chain
        })
        return chain
      }
      return makeChain({ data: [], error: null })
    })
    mockRpc.mockResolvedValue({ data: [], error: null })

    await getAdminMembers()
    expect(typeof listSelectArg).toBe('string')
    expect(listSelectArg).not.toContain('phone_number')
    // And the RPC was nonetheless used as the source of truth.
    expect(phoneRpcCalls()).toHaveLength(1)
  })

  it('SECURITY: rejects a non-admin (member-role) caller before any merge', async () => {
    mockMember()
    await expect(getAdminMembers()).rejects.toThrow('Admin access required')
    expect(phoneRpcCalls()).toHaveLength(0)
  })

  it('SECURITY: rejects an unauthenticated caller', async () => {
    mockUnauthenticated()
    await expect(getAdminMembers()).rejects.toThrow('Authentication required')
    expect(phoneRpcCalls()).toHaveLength(0)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// exportEventAttendeesCSV — Mobile column, injection guard, scope
// ════════════════════════════════════════════════════════════════════════════

describe('exportEventAttendeesCSV — Mobile column + CSV-injection guard', () => {
  const csvBookingRow = (profileId: string, name = 'Charlotte') => ({
    booked_at: '2026-01-01T10:00:00Z',
    profile: { id: profileId, full_name: name, email: `${name}@example.com` },
  })

  it('header is exactly "Name,Email,Mobile,Booked At" (Mobile is column 3)', async () => {
    mockAdmin([])
    const csv = await exportEventAttendeesCSV('evt-1')
    expect(csv.split('\n')[0]).toBe('Name,Email,Mobile,Booked At')
  })

  it('INVARIANT: a +-leading phone is apostrophe-guarded in the Mobile cell ("\'+<digits>") — CSV formula-injection defence', async () => {
    mockAdmin([csvBookingRow('usr-1')], [{ user_id: 'usr-1', phone_number: '+447700900123' }])
    const csv = await exportEventAttendeesCSV('evt-1')
    // The Mobile cell is the THIRD quoted field. Assert the exact guarded
    // value AND its column position.
    expect(csv).toContain(`"'+447700900123"`)
    const dataRow = csv.split('\n')[1]
    const cells = dataRow.split('","')
    expect(cells).toHaveLength(4)
    expect(cells[2]).toBe(`'+447700900123`) // 3rd cell (Mobile), apostrophe-guarded
  })

  it('a phone stored WITHOUT a leading + passes through unguarded (digit lead char is safe)', async () => {
    mockAdmin([csvBookingRow('usr-1')], [{ user_id: 'usr-1', phone_number: '447700900123' }])
    const csv = await exportEventAttendeesCSV('evt-1')
    const cells = csv.split('\n')[1].split('","')
    expect(cells[2]).toBe('447700900123') // no apostrophe — first char is a digit
  })

  it('INVARIANT: a null phone renders an EMPTY Mobile cell (no phantom apostrophe)', async () => {
    // RPC returns no row for usr-1 → mobile null → r.mobile ?? '' →
    // sanitizeCsvCell('') === '' → empty quoted cell.
    mockAdmin([csvBookingRow('usr-1')], [])
    const csv = await exportEventAttendeesCSV('evt-1')
    const cells = csv.split('\n')[1].split('","')
    expect(cells[2]).toBe('') // empty Mobile cell
    expect(csv).toContain(`,"",`) // the empty quoted cell appears verbatim
  })

  it('INVARIANT: confirmed-only scope is preserved (status filter is "confirmed")', async () => {
    // Capture the .eq() args on the bookings query to prove the export does
    // NOT broaden to waitlisted/cancelled when adding the Mobile column.
    mockGetUser.mockResolvedValue({ data: { user: { id: 'admin-1' } }, error: null })
    let call = 0
    let bookingsChain: ReturnType<typeof makeChain> | undefined
    mockFrom.mockImplementation(() => {
      call++
      if (call === 1) return makeChain({ data: { role: 'admin' } })
      bookingsChain = makeChain({ data: [], error: null })
      return bookingsChain
    })
    mockRpc.mockResolvedValue({ data: [], error: null })

    await exportEventAttendeesCSV('evt-1')
    const eqArgs = bookingsChain!.eq.mock.calls
    expect(eqArgs).toContainEqual(['status', 'confirmed'])
    // And it must NOT also filter for a non-confirmed status.
    expect(eqArgs).not.toContainEqual(['status', 'waitlisted'])
    expect(eqArgs).not.toContainEqual(['status', 'cancelled'])
  })

  it('INVARIANT: makes EXACTLY ONE admin_get_user_phones RPC call for the attendee set', async () => {
    mockAdmin(
      [csvBookingRow('usr-1', 'Charlotte'), csvBookingRow('usr-2', 'James')],
      []
    )
    await exportEventAttendeesCSV('evt-1')
    const calls = phoneRpcCalls()
    expect(calls).toHaveLength(1)
    expect(calls[0][1]).toEqual({ target_user_ids: ['usr-1', 'usr-2'] })
  })

  it('SECURITY: rejects an unauthenticated caller (complements the non-admin reject in csv-attendees.test.ts)', async () => {
    mockUnauthenticated()
    await expect(exportEventAttendeesCSV('evt-1')).rejects.toThrow('Authentication required')
    expect(phoneRpcCalls()).toHaveLength(0)
  })
})
