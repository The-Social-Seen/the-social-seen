import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'

// Stable spies declared before mocks so they can be referenced inside vi.mock factories.
const mockCookieSet = vi.fn()
const mockCookieGetAll = vi.fn(() => [])

// Capture the cookie config our wrapper passes to the SSR library so we can
// invoke setAll directly in tests and inspect what gets written to the store.
let capturedCookieConfig: {
  setAll?: (cookies: Array<{ name: string; value: string; options: Record<string, unknown> }>) => void
} | null = null

// Mock @supabase/ssr — captures the full cookies config on each call
vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(
    (_url: string, _key: string, config: { cookies: typeof capturedCookieConfig }) => {
      capturedCookieConfig = config.cookies
      return { from: vi.fn() }
    }
  ),
}))

// Mock next/headers — cookies() is not available outside the Next.js runtime
vi.mock('next/headers', () => ({
  cookies: vi.fn(() =>
    Promise.resolve({
      getAll: mockCookieGetAll,
      set: mockCookieSet,
    })
  ),
}))

import { createServerClient } from '../server'

describe('createServerClient (server)', () => {
  const ORIG_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
  const ORIG_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  beforeEach(() => {
    vi.clearAllMocks()
    capturedCookieConfig = null
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key'
  })

  afterEach(() => {
    if (ORIG_URL !== undefined) {
      process.env.NEXT_PUBLIC_SUPABASE_URL = ORIG_URL
    } else {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL
    }
    if (ORIG_KEY !== undefined) {
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ORIG_KEY
    } else {
      delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    }
  })

  it('throws when NEXT_PUBLIC_SUPABASE_URL is missing', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key'

    await expect(createServerClient()).rejects.toThrow(
      'Missing environment variable: NEXT_PUBLIC_SUPABASE_URL'
    )
  })

  it('throws when NEXT_PUBLIC_SUPABASE_ANON_KEY is missing', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    await expect(createServerClient()).rejects.toThrow(
      'Missing environment variable: NEXT_PUBLIC_SUPABASE_ANON_KEY'
    )
  })

  it('error message includes .env.local setup hint', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    await expect(createServerClient()).rejects.toThrow('.env.local')
  })

  it('resolves to a Supabase client when both env vars are present', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key'

    const client = await createServerClient()
    expect(client).toBeDefined()
  })

  it('does not reject when env vars are set correctly', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key'

    await expect(createServerClient()).resolves.toBeDefined()
  })
})

// ── Cookie security tests ──────────────────────────────────────────────────

describe('createServerClient — httpOnly cookie security', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    capturedCookieConfig = null
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key'
  })

  it('sets httpOnly to false so createBrowserClient can read auth cookies', async () => {
    await createServerClient()

    expect(capturedCookieConfig).not.toBeNull()

    // Invoke setAll as the SSR library would after a token refresh
    capturedCookieConfig!.setAll!([
      { name: 'sb-access-token', value: 'tok.abc.xyz', options: { path: '/', sameSite: 'lax', maxAge: 3600 } },
    ])

    expect(mockCookieSet).toHaveBeenCalled()
    const [, , writtenOptions] = mockCookieSet.mock.calls[0] as [string, string, Record<string, unknown>]

    // httpOnly: false is required for @supabase/ssr createBrowserClient to read
    // the auth token from document.cookie. XSS mitigation is via CSP headers.
    expect(writtenOptions.httpOnly).toBe(false)
  })

  it('preserves other cookie options passed by the SSR library', async () => {
    await createServerClient()

    capturedCookieConfig!.setAll!([
      { name: 'sb-refresh-token', value: 'refresh.xyz', options: { path: '/', maxAge: 86400, sameSite: 'lax' } },
    ])

    const [name, value, writtenOptions] = mockCookieSet.mock.calls[0] as [string, string, Record<string, unknown>]
    expect(name).toBe('sb-refresh-token')
    expect(value).toBe('refresh.xyz')
    expect(writtenOptions.maxAge).toBe(86400)
    expect(writtenOptions.path).toBe('/')
  })

  it('silently swallows cookie write errors from Server Component context', async () => {
    mockCookieSet.mockImplementation(() => {
      throw new Error('Cookies can only be set from Server Actions or Route Handlers')
    })

    await createServerClient()

    // Must not throw — errors in setAll are intentionally swallowed
    expect(() =>
      capturedCookieConfig!.setAll!([{ name: 'sb-token', value: 'abc', options: {} }])
    ).not.toThrow()
  })
})
