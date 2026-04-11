/**
 * Tests for CSV injection prevention in exportEventAttendeesCSV.
 *
 * sanitizeCsvCell() is a private helper inside admin/actions.ts, so its
 * behaviour is verified through the public exportEventAttendeesCSV() function.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Supabase mock ──────────────────────────────────────────────────────────

const mockGetUser = vi.fn()
const mockFrom = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(() =>
    Promise.resolve({
      auth: { getUser: mockGetUser },
      from: mockFrom,
    })
  ),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/utils/slugify', () => ({
  slugify: vi.fn((s: string) => s.toLowerCase()),
  uniqueSlug: vi.fn(async (s: string) => s.toLowerCase()),
}))

import { exportEventAttendeesCSV } from '../admin/actions'

// ── Helpers ────────────────────────────────────────────────────────────────

function makeChain(response: { data?: unknown; error?: unknown }) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {}
  for (const m of ['select', 'eq', 'neq', 'is', 'or', 'order', 'single', 'insert', 'update', 'delete', 'in', 'limit', 'gt', 'gte', 'lte', 'maybeSingle']) {
    chain[m] = vi.fn().mockReturnValue(chain)
  }
  chain.then = vi.fn((resolve: (v: unknown) => void) => resolve(response))
  return chain
}

function mockAdminWithBookings(bookings: unknown[]) {
  mockGetUser.mockResolvedValue({ data: { user: { id: 'admin-1' } }, error: null })
  let call = 0
  mockFrom.mockImplementation(() => {
    call++
    if (call === 1) return makeChain({ data: { role: 'admin' } })
    return makeChain({ data: bookings, error: null })
  })
}

function mockMemberUser() {
  mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
  mockFrom.mockImplementation(() => makeChain({ data: { role: 'member' } }))
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('exportEventAttendeesCSV — CSV injection prevention', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('T2-1: prefixes = (formula trigger) with single-quote in name field', async () => {
    mockAdminWithBookings([
      { booked_at: '2026-01-01T10:00:00Z', profile: { full_name: '=CMD("rm -rf /")', email: 'safe@example.com' } },
    ])
    const csv = await exportEventAttendeesCSV('evt-1')
    expect(csv).toContain(`"'=CMD(`)
  })

  it('T2-2: prefixes + (formula trigger) with single-quote in email field', async () => {
    mockAdminWithBookings([
      { booked_at: '2026-01-01T10:00:00Z', profile: { full_name: 'Normal Name', email: '+1234@attacker.com' } },
    ])
    const csv = await exportEventAttendeesCSV('evt-1')
    expect(csv).toContain(`"'+1234@attacker.com"`)
  })

  it('T2-3: CSV header line is exactly Name,Email,Booked At', async () => {
    mockAdminWithBookings([])
    const csv = await exportEventAttendeesCSV('evt-1')
    expect(csv.startsWith('Name,Email,Booked At')).toBe(true)
  })

  // NOTE: This test mocks Supabase. RLS enforcement is in supabase/migrations/ — verify there.
  it('T2-4: non-admin member role → requireAdmin throws', async () => {
    mockMemberUser()
    await expect(exportEventAttendeesCSV('evt-1')).rejects.toThrow('Admin access required')
  })
})
