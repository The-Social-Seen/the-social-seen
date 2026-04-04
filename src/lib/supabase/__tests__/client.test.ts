import { describe, it, expect, vi, afterEach } from 'vitest'

// Mock @supabase/ssr before importing the module under test.
// createBrowserClient is called at runtime (inside createClient()), not at import time.
vi.mock('@supabase/ssr', () => ({
  createBrowserClient: vi.fn(() => ({ from: vi.fn() })),
}))

import { createClient } from '../client'

describe('createClient (browser)', () => {
  const ORIG_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
  const ORIG_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  afterEach(() => {
    // Restore env vars after every test
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

  it('throws when NEXT_PUBLIC_SUPABASE_URL is missing', () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key'

    expect(() => createClient()).toThrow(
      'Missing environment variable: NEXT_PUBLIC_SUPABASE_URL'
    )
  })

  it('throws when NEXT_PUBLIC_SUPABASE_ANON_KEY is missing', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    expect(() => createClient()).toThrow(
      'Missing environment variable: NEXT_PUBLIC_SUPABASE_ANON_KEY'
    )
  })

  it('error message includes .env.local setup hint', () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    expect(() => createClient()).toThrow('.env.local')
  })

  it('returns a Supabase client when both env vars are present', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key'

    const client = createClient()
    expect(client).toBeDefined()
  })

  it('does not throw when env vars are set correctly', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key'

    expect(() => createClient()).not.toThrow()
  })
})
