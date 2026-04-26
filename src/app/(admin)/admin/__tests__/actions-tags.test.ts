// W5 — saveEventTags Server Action coverage.
//
// Focuses on the multi-tag collision guard (defence in depth) flagged by
// W2+W3 code review. The picker UI prevents the same tag in both slots
// at all; this Server Action enforces the same invariant server-side so
// a malformed payload can't slip past.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetUser = vi.fn()
const mockFrom = vi.fn()
const mockRpc = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(() =>
    Promise.resolve({
      auth: { getUser: mockGetUser },
      from: mockFrom,
      rpc: mockRpc,
    }),
  ),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

import { saveEventTags } from '../actions'

// ── Helpers ──────────────────────────────────────────────────────────────────

function authenticateAdmin(userId = 'admin-1') {
  mockGetUser.mockResolvedValue({
    data: { user: { id: userId } },
    error: null,
  })
}

function authenticateMember(userId = 'user-1') {
  mockGetUser.mockResolvedValue({
    data: { user: { id: userId } },
    error: null,
  })
}

function mockChain(response: { data?: unknown; error?: unknown; count?: number | null }) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {}
  const methods = [
    'select',
    'insert',
    'update',
    'delete',
    'eq',
    'neq',
    'is',
    'single',
    'maybeSingle',
    'in',
  ]
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain)
  }
  chain.then = vi.fn((resolve: (v: unknown) => void) => resolve(response))
  return chain
}

/**
 * Set up `from()` dispatcher.
 *   1st call → requireAdmin reading `profiles.role`
 *   2nd+    → table-keyed responses ('tags', 'event_tags', etc.)
 */
function mockAdminWithTables(
  responses: Record<string, { data?: unknown; error?: unknown }>,
) {
  authenticateAdmin()
  let firstCall = true
  const tableChains: Record<string, ReturnType<typeof mockChain>> = {}
  for (const [table, resp] of Object.entries(responses)) {
    tableChains[table] = mockChain(resp)
  }
  mockFrom.mockImplementation((table: string) => {
    if (firstCall) {
      firstCall = false
      return mockChain({ data: { role: 'admin' } })
    }
    return tableChains[table] ?? mockChain({ data: null, error: null })
  })
  return tableChains
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ── Validation ───────────────────────────────────────────────────────────────

describe('saveEventTags — validation', () => {
  it('rejects when eventId is not a uuid', async () => {
    authenticateAdmin()
    mockFrom.mockReturnValueOnce(mockChain({ data: { role: 'admin' } }))
    const result = await saveEventTags(
      'not-a-uuid',
      'drinks-bars',
      [],
    )
    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
  })

  it('rejects when no primary slug is supplied', async () => {
    authenticateAdmin()
    mockFrom.mockReturnValueOnce(mockChain({ data: { role: 'admin' } }))
    const result = await saveEventTags(
      'e1000000-0000-0000-0000-000000000001',
      '',
      ['theatre-comedy'],
    )
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/pick a primary tag/i)
  })

  it('rejects when primary slug is interest-only (not in PRIMARY_ELIGIBLE_TAG_SLUGS)', async () => {
    authenticateAdmin()
    mockFrom.mockReturnValueOnce(mockChain({ data: { role: 'admin' } }))
    const result = await saveEventTags(
      'e1000000-0000-0000-0000-000000000001',
      'interest-technology',
      [],
    )
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/allowed list/i)
  })
})

// ── Collision guard (defence in depth — see W5 prompt) ──────────────────────

describe('saveEventTags — multi-tag collision guard', () => {
  it('rejects when the primary slug ALSO appears in secondaries', async () => {
    authenticateAdmin()
    mockFrom.mockReturnValueOnce(mockChain({ data: { role: 'admin' } }))

    const result = await saveEventTags(
      'e1000000-0000-0000-0000-000000000001',
      'drinks-bars',
      ['theatre-comedy', 'drinks-bars'],
    )

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/can.*both primary and secondary/i)
  })

  it('does NOT call DELETE/INSERT on event_tags when the collision check trips', async () => {
    // Wire all tables — if the collision check were skipped we'd see
    // these chains' .delete and .insert invoked.
    const chains = mockAdminWithTables({
      tags: {
        data: [{ id: 'tag-uuid', slug: 'drinks-bars' }],
        error: null,
      },
      event_tags: { data: null, error: null },
    })

    await saveEventTags(
      'e1000000-0000-0000-0000-000000000001',
      'drinks-bars',
      ['drinks-bars'],
    )

    // No table operations should have run — the guard short-circuits
    // before either query.
    expect(chains.tags.in).not.toHaveBeenCalled()
    expect(chains.event_tags.delete).not.toHaveBeenCalled()
    expect(chains.event_tags.insert).not.toHaveBeenCalled()
  })
})

// ── Auth boundary ────────────────────────────────────────────────────────────

describe('saveEventTags — auth boundary', () => {
  it('throws when caller is not authenticated', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'Not authenticated' },
    })
    await expect(
      saveEventTags(
        'e1000000-0000-0000-0000-000000000001',
        'drinks-bars',
        [],
      ),
    ).rejects.toThrow(/authentication required/i)
  })

  it('throws when caller is a non-admin member', async () => {
    authenticateMember()
    mockFrom.mockReturnValueOnce(mockChain({ data: { role: 'member' } }))

    await expect(
      saveEventTags(
        'e1000000-0000-0000-0000-000000000001',
        'drinks-bars',
        [],
      ),
    ).rejects.toThrow(/admin access required/i)
  })
})

// ── Happy path ───────────────────────────────────────────────────────────────

describe('saveEventTags — happy path', () => {
  it('resolves slugs to tag UUIDs, deletes existing event_tags, then INSERTs primary + secondaries', async () => {
    const chains = mockAdminWithTables({
      tags: {
        data: [
          { id: 'uuid-drinks', slug: 'drinks-bars' },
          { id: 'uuid-theatre', slug: 'theatre-comedy' },
        ],
        error: null,
      },
      event_tags: { data: null, error: null },
    })

    const result = await saveEventTags(
      'e1000000-0000-0000-0000-000000000001',
      'drinks-bars',
      ['theatre-comedy'],
    )

    expect(result).toEqual({ success: true })

    // Tags lookup batched — `.in('slug', [...])` called once.
    expect(chains.tags.in).toHaveBeenCalledTimes(1)
    expect(chains.tags.in).toHaveBeenCalledWith(
      'slug',
      expect.arrayContaining(['drinks-bars', 'theatre-comedy']),
    )

    // Old rows cleared, new rows written.
    expect(chains.event_tags.delete).toHaveBeenCalledTimes(1)
    expect(chains.event_tags.insert).toHaveBeenCalledWith([
      {
        event_id: 'e1000000-0000-0000-0000-000000000001',
        tag_id: 'uuid-drinks',
        is_primary: true,
      },
      {
        event_id: 'e1000000-0000-0000-0000-000000000001',
        tag_id: 'uuid-theatre',
        is_primary: false,
      },
    ])
  })

  it('de-duplicates secondary slugs before INSERT (malformed payload guard)', async () => {
    const chains = mockAdminWithTables({
      tags: {
        data: [
          { id: 'uuid-drinks', slug: 'drinks-bars' },
          { id: 'uuid-theatre', slug: 'theatre-comedy' },
        ],
        error: null,
      },
      event_tags: { data: null, error: null },
    })

    await saveEventTags(
      'e1000000-0000-0000-0000-000000000001',
      'drinks-bars',
      ['theatre-comedy', 'theatre-comedy'],
    )

    // Insert should carry primary + ONE theatre-comedy secondary, not two.
    const insertedRows = chains.event_tags.insert.mock.calls[0]?.[0] as Array<{
      tag_id: string
      is_primary: boolean
    }>
    const secondaries = insertedRows.filter((r) => !r.is_primary)
    expect(secondaries.length).toBe(1)
  })

  it('refuses to write when the tags lookup returns fewer rows than requested slugs', async () => {
    // Asking for two slugs but DB returns only one — this means the seed
    // is missing a tag (Migration 2 was supposed to create all 23). The
    // action refuses rather than write a half-resolved payload.
    const chains = mockAdminWithTables({
      tags: {
        data: [{ id: 'uuid-drinks', slug: 'drinks-bars' }],
        error: null,
      },
      event_tags: { data: null, error: null },
    })

    const result = await saveEventTags(
      'e1000000-0000-0000-0000-000000000001',
      'drinks-bars',
      ['theatre-comedy'],
    )

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/failed to resolve tags/i)
    expect(chains.event_tags.delete).not.toHaveBeenCalled()
    expect(chains.event_tags.insert).not.toHaveBeenCalled()
  })
})
