import { describe, it, expect, vi, afterEach } from 'vitest'

// Mock @supabase/ssr — the SSR createServerClient is the heavy dependency
vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(() => ({ from: vi.fn() })),
}))

// Mock next/headers — cookies() is not available outside the Next.js runtime
vi.mock('next/headers', () => ({
  cookies: vi.fn(() =>
    Promise.resolve({
      getAll: vi.fn(() => []),
      set: vi.fn(),
    })
  ),
}))

import { createServerClient } from '../server'

describe('createServerClient (server)', () => {
  const ORIG_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
  const ORIG_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

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
