import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * `server-only` throws in plain Node/Vitest because the package's `default` export
 * (i.e. not inside a React server bundle) throws intentionally.
 * We mock it as a no-op so we can test the module's own logic in isolation.
 * The actual runtime protection comes from the Next.js bundler — verified below
 * via a static source check.
 */
vi.mock('server-only', () => ({}))

// Mock @supabase/supabase-js — we want to assert how createClient() is called
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ from: vi.fn() })),
}))

// Import both the subject and the mocked dependency via static imports so
// Vitest shares the same mock instance (require() bypasses the mock registry)
import { createAdminClient } from '../admin'
import { createClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('admin.ts — server-only guard', () => {
  it("contains `import 'server-only'` to prevent client-side usage", () => {
    // Static verification: the guard must never be accidentally removed.
    const source = readFileSync(resolve(__dirname, '../admin.ts'), 'utf-8')
    expect(source).toContain("import 'server-only'")
  })
})

describe('createAdminClient', () => {
  const ORIG_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
  const ORIG_SRK = process.env.SUPABASE_SERVICE_ROLE_KEY

  afterEach(() => {
    vi.mocked(createClient).mockClear()

    if (ORIG_URL !== undefined) {
      process.env.NEXT_PUBLIC_SUPABASE_URL = ORIG_URL
    } else {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL
    }
    if (ORIG_SRK !== undefined) {
      process.env.SUPABASE_SERVICE_ROLE_KEY = ORIG_SRK
    } else {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY
    }
  })

  it('throws when NEXT_PUBLIC_SUPABASE_URL is missing', () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'

    expect(() => createAdminClient()).toThrow(
      'Missing environment variable: NEXT_PUBLIC_SUPABASE_URL'
    )
  })

  it('throws when SUPABASE_SERVICE_ROLE_KEY is missing', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
    delete process.env.SUPABASE_SERVICE_ROLE_KEY

    expect(() => createAdminClient()).toThrow(
      'Missing environment variable: SUPABASE_SERVICE_ROLE_KEY'
    )
  })

  it('error message includes .env.local setup hint', () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
    delete process.env.SUPABASE_SERVICE_ROLE_KEY

    expect(() => createAdminClient()).toThrow('.env.local')
  })

  it('returns a Supabase client when both env vars are present', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'

    const client = createAdminClient()
    expect(client).toBeDefined()
  })

  it('creates the client with session persistence disabled (no browser storage)', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'

    createAdminClient()

    expect(vi.mocked(createClient)).toHaveBeenCalledWith(
      'https://test.supabase.co',
      'test-service-role-key',
      expect.objectContaining({
        auth: expect.objectContaining({
          autoRefreshToken: false,
          persistSession: false,
        }),
      })
    )
  })

  it('uses the service role key, NOT the anon key', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key-must-not-be-used'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-secret'

    createAdminClient()

    const [, secondArg] = vi.mocked(createClient).mock.calls[0]
    expect(secondArg).toBe('service-role-secret')
    expect(secondArg).not.toBe('anon-key-must-not-be-used')
  })
})
