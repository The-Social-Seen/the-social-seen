import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Chainable query builder mock ─────────────────────────────────────────────
//
// PostgREST chains `.eq().not().order()` and resolves at any awaited terminator.
// The builder returns itself for every chain method and exposes a `then` so
// the entire chain is awaitable as a thenable.

interface MockQueryBuilder {
  select: ReturnType<typeof vi.fn>
  eq: ReturnType<typeof vi.fn>
  not: ReturnType<typeof vi.fn>
  order: ReturnType<typeof vi.fn>
  then: (resolve: (v: unknown) => void, reject: (v: unknown) => void) => Promise<unknown>
  mockResolve: (data: unknown) => void
  mockReject: (message: string, code?: string) => void
}

function createQueryBuilder(): MockQueryBuilder {
  let _result: { data: unknown; error: unknown } = { data: null, error: null }
  const builder = {} as MockQueryBuilder
  const chainMethods: (keyof MockQueryBuilder)[] = ['select', 'eq', 'not', 'order']
  for (const method of chainMethods) {
    ;(builder[method] as ReturnType<typeof vi.fn>) = vi.fn(() => builder)
  }
  builder.then = (resolve, reject) =>
    Promise.resolve(_result).then(resolve, reject)
  builder.mockResolve = (data: unknown) => {
    _result = { data, error: null }
  }
  builder.mockReject = (message: string, code?: string) => {
    _result = { data: null, error: { message, code: code ?? 'ERROR' } }
  }
  return builder
}

let tagsBuilder: MockQueryBuilder

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(() =>
    Promise.resolve({
      from: vi.fn(() => tagsBuilder),
    }),
  ),
}))

import { getRegistrationInterestTags } from '../tags'

// ── Fixtures ───────────────────────────────────────────────────────────────

// Two primary-eligible tags from the canonical 15-row taxonomy. Used as the
// happy-path response — the action expects the DB to apply the filters
// (is_active + NOT slug LIKE 'interest-%') so this fixture represents the
// already-filtered result, not the raw 23-row table.
const PRIMARY_ELIGIBLE_ROWS = [
  {
    id: 'tag-uuid-drinks-bars',
    slug: 'drinks-bars',
    label: 'Drinks & Bars',
    parent_id: null,
    sort_order: 10,
    is_active: true,
    created_at: '2026-04-01T00:00:00Z',
    updated_at: '2026-04-01T00:00:00Z',
  },
  {
    id: 'tag-uuid-theatre-comedy',
    slug: 'theatre-comedy',
    label: 'Theatre & Comedy',
    parent_id: null,
    sort_order: 60,
    is_active: true,
    created_at: '2026-04-01T00:00:00Z',
    updated_at: '2026-04-01T00:00:00Z',
  },
]

// ── Tests ──────────────────────────────────────────────────────────────────

describe('getRegistrationInterestTags', () => {
  beforeEach(() => {
    tagsBuilder = createQueryBuilder()
  })

  it('returns only primary-eligible tags (interest-* slugs excluded via NOT LIKE)', async () => {
    // The function trusts the DB to apply `NOT slug LIKE 'interest-%'`.
    // Pin the contract by asserting the filter was sent to supabase AND
    // the resulting rows pass straight through. Hand-coding interest-*
    // rows into the mock would test the mock, not the function — so the
    // fixture represents what supabase returns AFTER the filter runs.
    tagsBuilder.mockResolve(PRIMARY_ELIGIBLE_ROWS)

    const result = await getRegistrationInterestTags()

    // Filter is the security boundary — every returned slug must be
    // primary-eligible.
    expect(tagsBuilder.not).toHaveBeenCalledWith('slug', 'like', 'interest-%')
    expect(result).toHaveLength(2)
    expect(result.every((t) => !t.slug.startsWith('interest-'))).toBe(true)
    expect(result.map((t) => t.slug)).toEqual(['drinks-bars', 'theatre-comedy'])
  })

  it('filters by is_active = true', async () => {
    tagsBuilder.mockResolve(PRIMARY_ELIGIBLE_ROWS)

    await getRegistrationInterestTags()

    // Inactive primary tags must never reach the registration grid.
    expect(tagsBuilder.eq).toHaveBeenCalledWith('is_active', true)
  })

  it('orders by sort_order ascending (sort happens at the DB layer)', async () => {
    // The function delegates ordering to the supabase query rather than
    // sorting client-side. Assert the chain call rather than the result
    // ordering — feeding unsorted mock data and expecting sorted output
    // would test the mock, not the function.
    tagsBuilder.mockResolve(PRIMARY_ELIGIBLE_ROWS)

    await getRegistrationInterestTags()

    expect(tagsBuilder.order).toHaveBeenCalledWith('sort_order', {
      ascending: true,
    })
  })

  it('returns the supabase result unchanged (function is a thin passthrough)', async () => {
    // If the DB happens to return rows in a particular order, the
    // function must not reshape them. Pinning this guards against an
    // accidental client-side .sort() / .filter() that would mask a
    // future schema change.
    tagsBuilder.mockResolve(PRIMARY_ELIGIBLE_ROWS)

    const result = await getRegistrationInterestTags()

    expect(result).toEqual(PRIMARY_ELIGIBLE_ROWS)
  })

  it('returns [] when supabase returns an error', async () => {
    // Defensive contract: the form would crash if it received
    // `undefined`. The query helper logs and returns an empty array
    // instead, letting the chip grid render in an empty state.
    tagsBuilder.mockReject('relation "tags" does not exist')

    const result = await getRegistrationInterestTags()

    expect(result).toEqual([])
  })

  it('returns [] when supabase returns null data with no error', async () => {
    // Edge case: supabase can return `data: null` without surfacing an
    // explicit error (e.g. RLS-filtered to zero rows on some schemas).
    // The function coalesces to [].
    tagsBuilder.mockResolve(null)

    const result = await getRegistrationInterestTags()

    expect(result).toEqual([])
  })
})
