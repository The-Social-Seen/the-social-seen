import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Chainable query builder mock ─────────────────────────────────────────────

interface MockQueryBuilder {
  select: ReturnType<typeof vi.fn>
  eq: ReturnType<typeof vi.fn>
  neq: ReturnType<typeof vi.fn>
  is: ReturnType<typeof vi.fn>
  order: ReturnType<typeof vi.fn>
  limit: ReturnType<typeof vi.fn>
  single: ReturnType<typeof vi.fn>
  maybeSingle: ReturnType<typeof vi.fn>
  then: (resolve: (v: unknown) => void, reject: (v: unknown) => void) => Promise<unknown>
  mockResolve: (data: unknown, count?: number | null) => void
  mockReject: (message: string, code?: string) => void
}

function createQueryBuilder(): MockQueryBuilder {
  let _result: { data: unknown; error: unknown; count?: number | null } = {
    data: null,
    error: null,
    count: null,
  }

  const builder = {} as MockQueryBuilder
  const chainMethods: (keyof MockQueryBuilder)[] = [
    'select', 'eq', 'neq', 'is', 'order', 'limit', 'single', 'maybeSingle',
  ]

  for (const method of chainMethods) {
    (builder[method] as ReturnType<typeof vi.fn>) = vi.fn(() => builder)
  }

  builder.then = (resolve: (v: unknown) => void, reject: (v: unknown) => void) => {
    return Promise.resolve(_result).then(resolve, reject)
  }

  builder.mockResolve = (data: unknown, count?: number | null) => {
    _result = { data, error: null, count: count ?? null }
  }
  builder.mockReject = (message: string, code?: string) => {
    _result = { data: null, error: { message, code: code ?? 'ERROR' }, count: null }
  }

  return builder
}

// ── Supabase client mock ─────────────────────────────────────────────────────

let fromBuilders: Record<string, MockQueryBuilder>

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(() => {
    return Promise.resolve({
      from: vi.fn((table: string) => {
        if (!fromBuilders[table]) {
          fromBuilders[table] = createQueryBuilder()
        }
        return fromBuilders[table]
      }),
      auth: {
        getUser: vi.fn(() => Promise.resolve({ data: { user: null } })),
      },
    })
  }),
}))

// ── Import after mocks ──────────────────────────────────────────────────────

import { getAllGalleryPhotos, getGalleryEvents } from '../gallery'

// ── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.restoreAllMocks()
  fromBuilders = {}
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

// ── Tests ───────────────────────────────────────────────────────────────────

describe('getAllGalleryPhotos', () => {
  it('T2-8: query error returns empty array and logs to console.error', async () => {
    const builder = createQueryBuilder()
    builder.mockReject('storage error')
    fromBuilders['event_photos'] = builder

    const result = await getAllGalleryPhotos()

    expect(result).toEqual([])
    expect(console.error).toHaveBeenCalledWith(
      '[getAllGalleryPhotos]',
      'storage error'
    )
  })
})

describe('getGalleryEvents', () => {
  it('T2-9: maps only id/title/slug, strips event_photos from result', async () => {
    const builder = createQueryBuilder()
    builder.mockResolve([
      { id: 'evt-1', title: 'Wine Night', slug: 'wine-night', event_photos: [{ id: 'p-1' }] },
    ])
    fromBuilders['events'] = builder

    const result = await getGalleryEvents()

    expect(result).toEqual([
      { id: 'evt-1', title: 'Wine Night', slug: 'wine-night' },
    ])
    // Ensure event_photos is not in the result
    expect(result[0]).not.toHaveProperty('event_photos')
  })
})
