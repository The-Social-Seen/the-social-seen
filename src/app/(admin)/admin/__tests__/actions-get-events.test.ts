// getAdminEvents coverage — locks in the PRIMARY_TAG_EMBED + attachPrimaryTag
// contract that the post-F1b-app /admin/events listing depends on. The
// regression these tests guard against is the missing-embed bug recorded
// in docs/AUDIT.md: EventsTable was migrated to read primary_tag.label
// while the admin query still did `select('*')`, so the listing crashed
// with `Cannot read properties of undefined`.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PRIMARY_TAG_EMBED } from '@/lib/supabase/queries/events'

// ── Supabase mock ──────────────────────────────────────────────────────────

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

import { getAdminEvents } from '../actions'

// ── Helpers ────────────────────────────────────────────────────────────────

function authenticateAdmin(userId = 'admin-1') {
  mockGetUser.mockResolvedValue({
    data: { user: { id: userId } },
    error: null,
  })
}

/**
 * Build a chainable mock that mirrors Supabase's PostgREST builder pattern.
 * Each method returns the chain itself so callers can keep chaining; the
 * terminal `.then` resolves with the supplied response when awaited.
 */
function mockChain(response: { data?: unknown; error?: unknown; count?: number | null }) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {}
  const methods = [
    'select', 'insert', 'update', 'delete',
    'eq', 'neq', 'is', 'single', 'maybeSingle',
    'order', 'limit', 'gt', 'gte', 'lte', 'or', 'in',
  ]
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain)
  }
  chain.then = vi.fn((resolve: (v: unknown) => void) => resolve(response))
  return chain
}

/**
 * Mirror the realistic shape of an event_with_stats row after the
 * inner-join + `.eq('event_tags.is_primary', true)` filter has run.
 * The minimal columns are stand-ins for the full row shape — the fields
 * EventsTable reads (primary_tag, title, etc.) come through correctly,
 * the rest are passed through unchanged by attachPrimaryTag.
 */
function adminEventRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'evt-cultural',
    slug: 'cultural-event',
    title: 'A Galleries Crawl',
    short_description: 'Bloomsbury museums in one afternoon',
    description: 'A guided afternoon through the Bloomsbury museums.',
    date_time: '2026-06-01T13:00:00.000Z',
    end_time: '2026-06-01T17:00:00.000Z',
    venue_name: 'Bloomsbury',
    venue_address: '1 Russell Square, London',
    postcode: 'WC1B 5BE',
    venue_revealed: true,
    price: 0,
    capacity: 20,
    image_url: null,
    dress_code: null,
    refund_window_hours: 48,
    is_published: true,
    is_cancelled: false,
    deleted_at: null,
    confirmed_count: 4,
    revenue_collected: 0,
    avg_rating: 0,
    review_count: 0,
    spots_left: 16,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ════════════════════════════════════════════════════════════════════════════
// Test 1 — happy path: primary_tag is lifted onto the row
// ════════════════════════════════════════════════════════════════════════════

describe('getAdminEvents — primary_tag embed', () => {
  it('returns rows with primary_tag populated from the event_tags!inner join', async () => {
    authenticateAdmin()

    // The realistic post-filter PostgREST shape: the SQL
    // `.eq('event_tags.is_primary', true)` restricts the embed array to
    // just the primary row. The fixture deliberately includes a
    // secondary row at index 1 to make the assertion meaningful — even
    // if the upstream filter ever loosens, attachPrimaryTag picks
    // event_tags[0], so the test fails loudly if the primary stops
    // landing first.
    const row = adminEventRow({
      event_tags: [
        {
          is_primary: true,
          tags: { slug: 'galleries-museums', label: 'Galleries & Museums' },
        },
        {
          is_primary: false,
          tags: { slug: 'cultural-after-dark', label: 'Cultural After Dark' },
        },
      ],
    })

    let firstCall = true
    mockFrom.mockImplementation((table: string) => {
      if (firstCall) {
        // requireAdmin → profiles.role
        firstCall = false
        return mockChain({ data: { role: 'admin' } })
      }
      if (table === 'event_with_stats') {
        return mockChain({ data: [row], error: null })
      }
      return mockChain({ data: null, error: null })
    })

    const events = await getAdminEvents()

    expect(events).toHaveLength(1)
    expect(events[0].primary_tag).toEqual({
      slug: 'galleries-museums',
      label: 'Galleries & Museums',
    })
    expect(events[0].title).toBe('A Galleries Crawl')
    // The raw embed should NOT leak through onto the returned row —
    // attachPrimaryTag strips it before returning.
    expect(Object.keys(events[0])).not.toContain('event_tags')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Test 2 — data-integrity throw: missing embed surfaces, not silent undefined
// ════════════════════════════════════════════════════════════════════════════

describe('getAdminEvents — missing-primary throw', () => {
  it('rejects with the F1a data-integrity message when event_tags is empty', async () => {
    authenticateAdmin()

    // Empty embed simulates a future regression: query shape lost the
    // `event_tags!inner` join, or a row genuinely has no primary tag
    // (data corruption). Either way, attachPrimaryTag's runtime throw
    // is the regression guard — the message string is part of the
    // contract, so this test locks it in. Softening the throw to a
    // return-null fallback in a future "cleanup" would silently
    // reintroduce the original `event.primary_tag.label` undefined bug;
    // this assertion fails loudly when that happens.
    const row = adminEventRow({ event_tags: [] })

    let firstCall = true
    mockFrom.mockImplementation((table: string) => {
      if (firstCall) {
        firstCall = false
        return mockChain({ data: { role: 'admin' } })
      }
      if (table === 'event_with_stats') {
        return mockChain({ data: [row], error: null })
      }
      return mockChain({ data: null, error: null })
    })

    await expect(getAdminEvents()).rejects.toThrow(
      'Event row missing primary tag (F1a data integrity)',
    )
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Test: revenue_collected from event_with_stats survives the row decoder
// ════════════════════════════════════════════════════════════════════════════

describe('getAdminEvents — revenue_collected pass-through', () => {
  it('preserves revenue_collected on the returned EventWithStats (no field drop)', async () => {
    // Guard against a future "row decoder" change accidentally stripping
    // revenue_collected. The migration exposes this column on the
    // event_with_stats view; getAdminEvents must surface it untouched so
    // the admin EventsTable can render the per-event Revenue figure.
    authenticateAdmin()

    const row = adminEventRow({
      revenue_collected: 47500, // £475.00 in pence — distinct from 0 / null
      event_tags: [
        {
          is_primary: true,
          tags: { slug: 'galleries-museums', label: 'Galleries & Museums' },
        },
      ],
    })

    let firstCall = true
    mockFrom.mockImplementation((table: string) => {
      if (firstCall) {
        firstCall = false
        return mockChain({ data: { role: 'admin' } })
      }
      if (table === 'event_with_stats') {
        return mockChain({ data: [row], error: null })
      }
      return mockChain({ data: null, error: null })
    })

    const events = await getAdminEvents()

    expect(events).toHaveLength(1)
    // Strict-equal: it's a number, not null; the value matches what the
    // view returned. Catches both "field dropped" and "coerced to 0"
    // regressions.
    expect(events[0].revenue_collected).toBe(47500)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Postgres-error detail surfaces through the wrapper throw
// ════════════════════════════════════════════════════════════════════════════

describe('getAdminEvents — Postgres error detail in throw', () => {
  it('surfaces PostgrestError.message alongside the wrapper class label', async () => {
    // Regression for the tech-debt sweep landed in
    // chore(admin): surface Postgres error detail in Server Action
    // throws. Across 11 admin Server Actions, `throw new Error('Failed
    // to fetch X')` was rewritten to interpolate `${error.message}` so
    // Sentry shows the real cause (RLS denial, view drift, missing
    // column) rather than the generic class label alone.
    //
    // Why this matters: the wrapper text ("Failed to fetch events") is
    // load-bearing as a Sentry-filterable class label. Stripping it
    // would break alerting; dropping the underlying message would
    // re-bury the root cause. This test pins both halves so a future
    // "tidy up the throws" sweep can't silently regress to either
    // shape.
    authenticateAdmin()

    // Realistic Postgres error: an RLS denial or schema drift surfaces
    // here as a PostgrestError with a `message` field. The exact text
    // is what Supabase returns; we don't massage it.
    const postgresMessage = 'permission denied for table event_with_stats'

    let firstCall = true
    mockFrom.mockImplementation((table: string) => {
      if (firstCall) {
        // requireAdmin → profiles.role passes, so the function reaches
        // the data-fetch error path (not the auth path).
        firstCall = false
        return mockChain({ data: { role: 'admin' } })
      }
      if (table === 'event_with_stats') {
        return mockChain({ data: null, error: { message: postgresMessage } })
      }
      return mockChain({ data: null, error: null })
    })

    // One assertion that fails loudly if EITHER half is dropped: the
    // wrapper class label OR the Postgres detail. Using a single regex
    // anchors the colon-separator shape ("<wrapper>: <detail>") so a
    // future "throw the raw error.message" simplification — which would
    // strip the wrapper and break Sentry filters — also fails this
    // assertion.
    await expect(getAdminEvents()).rejects.toThrowError(
      new RegExp(`^Failed to fetch events: ${postgresMessage}$`),
    )
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Test 3 — query-shape contract: select() carries the embed clause
// ════════════════════════════════════════════════════════════════════════════

describe('getAdminEvents — query shape', () => {
  it('passes PRIMARY_TAG_EMBED to .select() and filters .eq(event_tags.is_primary, true)', async () => {
    authenticateAdmin()

    // Capture the chain used for the event_with_stats query so we can
    // inspect what arguments select / eq received. Empty data is fine
    // — Test 1 already covers row decoding; this test is purely about
    // the structural contract.
    let eventsChain: ReturnType<typeof mockChain> | undefined
    let firstCall = true
    mockFrom.mockImplementation((table: string) => {
      if (firstCall) {
        firstCall = false
        return mockChain({ data: { role: 'admin' } })
      }
      if (table === 'event_with_stats') {
        eventsChain = mockChain({ data: [], error: null })
        return eventsChain
      }
      return mockChain({ data: null, error: null })
    })

    await getAdminEvents()

    expect(eventsChain).toBeDefined()
    const selectArg = eventsChain!.select.mock.calls[0]?.[0] as string | undefined
    expect(selectArg).toBeDefined()
    // Must include the canonical embed string — same constant the
    // public-facing readers use, so a regression here would diverge
    // from the single source of truth in queries/events.ts.
    expect(selectArg).toContain(PRIMARY_TAG_EMBED)
    // Belt-and-braces: assert the structural fragments directly so the
    // test fails on a hand-edited substitute that skips the constant.
    expect(selectArg).toContain('event_tags!inner')
    expect(selectArg).toContain('is_primary')

    // The SQL filter that restricts the embed to the primary row.
    const eqCalls = eventsChain!.eq.mock.calls.map((c) => [c[0], c[1]] as const)
    expect(eqCalls).toContainEqual(['event_tags.is_primary', true])
  })
})
