/**
 * Tests for ILIKE wildcard escaping in admin member search.
 *
 * escapeIlike() is a private helper inside admin/actions.ts; its behaviour is
 * verified by inspecting the argument passed to the Supabase `.or()` query
 * method when getAdminMembers() is called with special characters.
 *
 * Without escaping, a search for "100%" would match every row (% is a
 * PostgreSQL wildcard). With escaping it matches only the literal string "100%".
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

import { getAdminMembers } from '../admin/actions'

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Build a chainable mock and expose `orSpy` so tests can assert on the
 * argument passed to .or() during the profiles query.
 */
function makeSpyChain(response: { data?: unknown; error?: unknown }) {
  const orSpy = vi.fn()
  const chain: Record<string, ReturnType<typeof vi.fn>> = {}
  for (const m of ['select', 'eq', 'neq', 'is', 'order', 'single', 'insert', 'update', 'delete', 'in', 'limit', 'gt', 'gte', 'lte', 'maybeSingle']) {
    chain[m] = vi.fn().mockReturnValue(chain)
  }
  // or() records its argument and returns the chain so building continues
  chain.or = orSpy.mockReturnValue(chain)
  chain.then = vi.fn((resolve: (v: unknown) => void) => resolve(response))
  return { chain, orSpy }
}

function makeChain(response: { data?: unknown; error?: unknown }) {
  return makeSpyChain(response).chain
}

/**
 * Sets up admin auth and returns the orSpy from the second from() call
 * (the profiles query) so tests can assert on ILIKE terms.
 */
function mockAdminSearch(profileRows: unknown[] = [], bookingRows: unknown[] = []) {
  mockGetUser.mockResolvedValue({ data: { user: { id: 'admin-1' } }, error: null })

  const { chain: profileChain, orSpy } = makeSpyChain({ data: profileRows, error: null })
  const bookingChain = makeChain({ data: bookingRows, error: null })

  let call = 0
  mockFrom.mockImplementation(() => {
    call++
    if (call === 1) return makeChain({ data: { role: 'admin' } }) // requireAdmin
    if (call === 2) return profileChain                            // profiles query
    return bookingChain                                            // bookings query
  })

  return orSpy
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('getAdminMembers — ILIKE wildcard escaping', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('escapes % wildcard in search term', async () => {
    const orSpy = mockAdminSearch()
    await getAdminMembers('%')
    expect(orSpy).toHaveBeenCalledWith(
      expect.stringContaining('\\%')
    )
  })

  it('escapes _ wildcard in search term', async () => {
    const orSpy = mockAdminSearch()
    await getAdminMembers('_')
    expect(orSpy).toHaveBeenCalledWith(
      expect.stringContaining('\\_')
    )
  })

  it('escapes both % and _ in a mixed search term (john%doe)', async () => {
    const orSpy = mockAdminSearch()
    await getAdminMembers('john%doe')
    const [term] = orSpy.mock.calls[0] as [string]
    // The literal % from the user input must appear escaped as \%
    expect(term).toContain('john\\%doe')
    // The raw unescaped input must not appear verbatim in the middle of the term
    expect(term).not.toContain('john%doe')
  })

  it('wraps the escaped term with % for partial matching', async () => {
    const orSpy = mockAdminSearch()
    await getAdminMembers('alice')
    const [term] = orSpy.mock.calls[0] as [string]
    // Term should be wrapped: %alice%
    expect(term).toContain('%alice%')
  })

  it('does not alter normal search text without special characters', async () => {
    const orSpy = mockAdminSearch()
    await getAdminMembers('normal')
    const [term] = orSpy.mock.calls[0] as [string]
    expect(term).toContain('%normal%')
    expect(term).not.toContain('\\')
  })

  it('builds an or() query covering full_name and email columns', async () => {
    const orSpy = mockAdminSearch()
    await getAdminMembers('james')
    const [term] = orSpy.mock.calls[0] as [string]
    expect(term).toContain('full_name.ilike.')
    expect(term).toContain('email.ilike.')
  })

  it('skips the or() call entirely when search is empty', async () => {
    const orSpy = mockAdminSearch()
    await getAdminMembers('')
    expect(orSpy).not.toHaveBeenCalled()
  })

  it('skips the or() call when search is only whitespace', async () => {
    const orSpy = mockAdminSearch()
    await getAdminMembers('   ')
    expect(orSpy).not.toHaveBeenCalled()
  })
})
