/**
 * Tests for CSV injection prevention in admin export functions.
 *
 * sanitizeCsvCell() is a private helper inside admin/actions.ts, so its
 * behaviour is verified through the public exportMembersCSV() function.
 * Each dangerous leading character that would be interpreted as a formula
 * by spreadsheet software must be prefixed with a single-quote (').
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

import { exportMembersCSV } from '../admin/actions'

// ── Helpers ────────────────────────────────────────────────────────────────

function makeChain(response: { data?: unknown; error?: unknown }) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {}
  for (const m of ['select', 'eq', 'neq', 'is', 'or', 'order', 'single', 'insert', 'update', 'delete', 'in', 'limit', 'gt', 'gte', 'lte', 'maybeSingle']) {
    chain[m] = vi.fn().mockReturnValue(chain)
  }
  chain.then = vi.fn((resolve: (v: unknown) => void) => resolve(response))
  return chain
}

/**
 * Sets up admin auth + a profiles query returning the given rows.
 * Call 1 (from requireAdmin): profiles role check → admin
 * Call 2 (from exportMembersCSV): profiles data
 */
function mockAdminWithProfiles(profiles: unknown[]) {
  mockGetUser.mockResolvedValue({ data: { user: { id: 'admin-1' } }, error: null })
  let call = 0
  mockFrom.mockImplementation(() => {
    call++
    if (call === 1) return makeChain({ data: { role: 'admin' } })
    return makeChain({ data: profiles, error: null })
  })
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('exportMembersCSV — CSV injection prevention', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('prefixes = (formula trigger) with a single-quote in name field', async () => {
    mockAdminWithProfiles([
      { full_name: '=CMD("rm -rf /")', email: 'safe@example.com', job_title: '', company: '', created_at: '2026-01-01' },
    ])
    const csv = await exportMembersCSV()
    expect(csv).toContain(`"'=CMD("`)
  })

  it('prefixes + (formula trigger) in email field', async () => {
    mockAdminWithProfiles([
      { full_name: 'Normal Name', email: '+1234@attacker.com', job_title: '', company: '', created_at: '2026-01-01' },
    ])
    const csv = await exportMembersCSV()
    expect(csv).toContain(`"'+1234@attacker.com"`)
  })

  it('prefixes - (formula trigger) in job_title field', async () => {
    mockAdminWithProfiles([
      { full_name: 'Normal Name', email: 'safe@example.com', job_title: '-1+1', company: '', created_at: '2026-01-01' },
    ])
    const csv = await exportMembersCSV()
    expect(csv).toContain(`"'-1+1"`)
  })

  it('prefixes @ (formula trigger) in company field', async () => {
    mockAdminWithProfiles([
      { full_name: 'Normal Name', email: 'safe@example.com', job_title: 'Engineer', company: '@SUM(A1:A10)', created_at: '2026-01-01' },
    ])
    const csv = await exportMembersCSV()
    expect(csv).toContain(`"'@SUM(A1:A10)"`)
  })

  it('does not modify safe plain text values', async () => {
    mockAdminWithProfiles([
      { full_name: 'Charlotte Moreau', email: 'charlotte@example.com', job_title: 'Product Manager', company: 'Acme Ltd', created_at: '2026-01-01' },
    ])
    const csv = await exportMembersCSV()
    expect(csv).toContain('"Charlotte Moreau"')
    expect(csv).toContain('"charlotte@example.com"')
    expect(csv).toContain('"Product Manager"')
    expect(csv).toContain('"Acme Ltd"')
    // No spurious single-quote prefix on safe values
    expect(csv).not.toContain("\"'Charlotte")
    expect(csv).not.toContain("\"'charlotte")
  })

  it('includes the correct CSV header row', async () => {
    mockAdminWithProfiles([])
    const csv = await exportMembersCSV()
    expect(csv.startsWith('Name,Email,Job Title,Company,Joined')).toBe(true)
  })

  it('returns only the header when there are no members', async () => {
    mockAdminWithProfiles([])
    const csv = await exportMembersCSV()
    expect(csv).toBe('Name,Email,Job Title,Company,Joined')
  })

  it('handles null/undefined profile fields without crashing', async () => {
    mockAdminWithProfiles([
      { full_name: null, email: null, job_title: null, company: null, created_at: '2026-01-01' },
    ])
    const csv = await exportMembersCSV()
    // Empty string cells for null values
    expect(csv).toContain('","')
  })
})
