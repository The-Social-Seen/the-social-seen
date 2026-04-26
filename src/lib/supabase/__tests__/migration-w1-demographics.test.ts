// @vitest-environment jsdom
//
// W4 — Coverage for Migration 1a (`add_profile_demographics`) and
// Migration 1b (`narrow_phone_number_grant`).
//
// W1 bundled the deferred phone_number GRANT-narrowing into the same
// PR as the new demographics columns, so this single file covers all
// THREE protected columns (`gender`, `age_range`, `phone_number`) using
// the same patterns repeated per column.
//
// ── Layers ──────────────────────────────────────────────────────────────────
// 1. **Migration-text static assertions** — read the .sql files and assert
//    the security-critical idioms are present (REVOKE shapes, SECURITY
//    DEFINER + `search_path = public`, the EXACT enum values from the
//    spec). These run without a DB and catch refactor mistakes in the
//    migration files themselves.
//
// 2. **Skipped DB-integration cases** — every assertion the W4 prompt
//    flagged as "do not skip" is encoded here as `it.skip(..., async () =>
//    { ... })` with a `// TODO(W4-docker)` marker and the body of what
//    the assertion should do. These were authored against a checklist —
//    not a live local Supabase — because Docker / Docker Desktop is not
//    available on the build machine. Unskip and run them once a local
//    `supabase start` stack is up. Each test name names the column it
//    protects so a failure cleanly identifies the regression.
//
// 3. **JS-side wiring tests with mocks** — actually-run unit checks that
//    the new RPC plumbing in `src/lib/supabase/queries/profile.ts`,
//    `src/app/(member)/profile/preferences-actions.ts`, and the
//    downstream components (ProfileHeader, SmsPreferencesSection) still
//    surface the phone string correctly after the migration to
//    `get_my_phone()`. Mocks won't catch DB-layer GRANT regressions —
//    that's what layer (2) exists for once Docker lands.
//
// 4. **Cross-cutting `select('*')` audit** — scans `src/` for any
//    user-scoped `.from('profiles').select('*')` call, which would
//    silently break (or under PostgREST fall back to a partial result)
//    after the GRANT narrowing. The admin-client paths (which bypass
//    GRANTs) are exempted by an explicit allow-list.
//
// Sabotage checks were performed on three migration-text assertions
// (one per protected column) — see the handover doc for the run log.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'

// ── Migration text helpers ─────────────────────────────────────────────────

const MIGRATIONS_DIR = resolve(__dirname, '../../../../supabase/migrations')
const MIGRATION_1A_PATH = resolve(
  MIGRATIONS_DIR,
  '20260503000001_add_profile_demographics.sql',
)
const MIGRATION_1B_PATH = resolve(
  MIGRATIONS_DIR,
  '20260503000002_narrow_phone_number_grant.sql',
)

function loadMigration(p: string): string {
  return readFileSync(p, 'utf-8')
}

// ════════════════════════════════════════════════════════════════════════════
// Layer 1 — Migration-text static assertions
// ════════════════════════════════════════════════════════════════════════════

describe('Migration 1a — text invariants', () => {
  const sql = loadMigration(MIGRATION_1A_PATH)

  // --- Enum shape (Decision 1, Decision 2 in the spec) ---------------------

  it('declares the gender enum with exactly the four spec values', () => {
    // Pull the body of the gender enum's CREATE TYPE … AS ENUM(...)
    // and check membership. Order isn't load-bearing in Postgres enums,
    // but we still verify it matches the spec for diff readability.
    const match = sql.match(
      /CREATE TYPE public\.gender AS ENUM \(([\s\S]*?)\)/,
    )
    expect(match, 'gender enum CREATE TYPE block not found').toBeTruthy()
    const values = (match![1].match(/'[^']+'/g) ?? []).map((v) =>
      v.slice(1, -1),
    )
    expect(values).toEqual([
      'female',
      'male',
      'non_binary',
      'prefer_not_to_say',
    ])
  })

  it('declares the age_range enum with exactly the seven spec bands', () => {
    const match = sql.match(
      /CREATE TYPE public\.age_range AS ENUM \(([\s\S]*?)\)/,
    )
    expect(match, 'age_range enum CREATE TYPE block not found').toBeTruthy()
    const values = (match![1].match(/'[^']+'/g) ?? []).map((v) =>
      v.slice(1, -1),
    )
    expect(values).toEqual([
      '18-24',
      '25-29',
      '30-34',
      '35-39',
      '40-44',
      '45-49',
      '50+',
    ])
    // Defensive: the spec rejects '17-24' and any explicit `under_18` —
    // verify they really are absent so a reviewer eye-balling the values
    // doesn't have to.
    expect(values).not.toContain('17-24')
    expect(values).not.toContain('under_18')
  })

  it('wraps both enum CREATE TYPEs in DO $$ … EXCEPTION WHEN duplicate_object for idempotency', () => {
    // Both blocks must be re-runnable. Pattern is established in
    // 20260420000001_add_profile_registration_fields.sql.
    const blocks = sql.match(
      /DO \$\$ BEGIN[\s\S]*?EXCEPTION WHEN duplicate_object THEN NULL;[\s\S]*?END \$\$;/g,
    )
    expect(blocks?.length ?? 0).toBeGreaterThanOrEqual(2)
  })

  it('adds gender + age_range as nullable with no default', () => {
    // ADD COLUMN IF NOT EXISTS without a DEFAULT (and without NOT NULL)
    // means no table rewrite — that's the safety property in the
    // migration header.
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS gender\s+public\.gender/)
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS age_range\s+public\.age_range/)
    expect(sql).not.toMatch(/ADD COLUMN IF NOT EXISTS gender[\s\S]*?DEFAULT/)
    expect(sql).not.toMatch(
      /ADD COLUMN IF NOT EXISTS age_range[\s\S]*?DEFAULT/,
    )
    expect(sql).not.toMatch(/ADD COLUMN IF NOT EXISTS gender[\s\S]*?NOT NULL/)
    expect(sql).not.toMatch(
      /ADD COLUMN IF NOT EXISTS age_range[\s\S]*?NOT NULL/,
    )
  })

  // --- GRANT narrowing (Decision 7 — Option A) -----------------------------

  it('REVOKEs broad SELECT on profiles from authenticated', () => {
    expect(sql).toMatch(
      /REVOKE SELECT ON public\.profiles FROM authenticated/,
    )
  })

  it('re-GRANTs SELECT on a column allow-list that EXCLUDES gender + age_range', () => {
    // Capture the grant column list and assert membership.
    const match = sql.match(
      /GRANT SELECT \(([\s\S]*?)\) ON public\.profiles TO authenticated/,
    )
    expect(match, 'GRANT SELECT (allow-list) … TO authenticated not found').toBeTruthy()
    const cols = match![1]
      .split(',')
      .map((c) => c.replace(/--.*$/m, '').trim())
      .filter((c) => c.length > 0 && !c.startsWith('--'))

    // The allow-list MUST contain the columns that user-scoped Server
    // Actions still SELECT (full_name, email, role, status, etc.).
    for (const required of ['id', 'email', 'full_name', 'role', 'status']) {
      expect(cols).toContain(required)
    }

    // The allow-list MUST NOT contain the protected demographics columns.
    expect(cols).not.toContain('gender')
    expect(cols).not.toContain('age_range')

    // The allow-list MUST NOT re-grant columns previous migrations
    // explicitly revoked (otherwise this migration silently re-broadens
    // them).
    expect(cols).not.toContain('stripe_customer_id')
    expect(cols).not.toContain('profile_nudge_email_sent_at')
  })

  it('wraps the REVOKE+GRANT in a single transaction', () => {
    // No window where authenticated has zero SELECT permission on
    // profiles — see the safety section of the migration header.
    expect(sql).toMatch(
      /BEGIN;[\s\S]*?REVOKE SELECT ON public\.profiles FROM authenticated;[\s\S]*?GRANT SELECT \([\s\S]*?\) ON public\.profiles TO authenticated;[\s\S]*?COMMIT;/,
    )
  })

  // --- SECURITY DEFINER fns ------------------------------------------------

  for (const fn of [
    'get_my_demographics',
    'set_my_demographics',
    'admin_get_demographics',
  ]) {
    it(`${fn} is SECURITY DEFINER with search_path = public`, () => {
      const re = new RegExp(
        `CREATE OR REPLACE FUNCTION public\\.${fn}[\\s\\S]*?SECURITY DEFINER[\\s\\S]*?SET search_path = public`,
      )
      expect(sql).toMatch(re)
    })

    it(`GRANT EXECUTE on ${fn} is given to authenticated`, () => {
      expect(sql).toMatch(
        new RegExp(
          `GRANT EXECUTE ON FUNCTION public\\.${fn}\\b[\\s\\S]*?TO authenticated`,
        ),
      )
    })
  }

  it('admin_get_demographics RAISE EXCEPTIONs on non-admin callers', () => {
    // Match: function body must contain an admin role check that raises
    // 'forbidden' when the caller is not an admin. The exact phrasing
    // mirrors `admin_get_user_phone` in 1b.
    const fnBody = sql.match(
      /CREATE OR REPLACE FUNCTION public\.admin_get_demographics[\s\S]*?\$\$[\s\S]*?\$\$/,
    )
    expect(fnBody).toBeTruthy()
    expect(fnBody![0]).toMatch(/role = 'admin'/)
    expect(fnBody![0]).toMatch(/RAISE EXCEPTION 'forbidden'/)
  })

  it('get_my_demographics filters by auth.uid() (callers can only read their own)', () => {
    const fnBody = sql.match(
      /CREATE OR REPLACE FUNCTION public\.get_my_demographics[\s\S]*?\$\$[\s\S]*?\$\$/,
    )
    expect(fnBody).toBeTruthy()
    expect(fnBody![0]).toMatch(/WHERE p\.id = auth\.uid\(\)/)
  })
})

describe('Migration 1b — text invariants', () => {
  const sql = loadMigration(MIGRATION_1B_PATH)

  it('REVOKEs column-level SELECT (phone_number) from authenticated', () => {
    expect(sql).toMatch(
      /REVOKE SELECT \(phone_number\) ON public\.profiles FROM authenticated/,
    )
  })

  it('does NOT REVOKE phone_number from postgres or service_role (admin paths must keep working)', () => {
    // The whole point of bundling this with the SMS-send sanity check —
    // a wide REVOKE here would silently break Twilio sends because
    // `lib/sms/send.ts` reads phone_number via the admin client.
    expect(sql).not.toMatch(
      /REVOKE SELECT \(phone_number\)[\s\S]*?FROM (postgres|service_role)/,
    )
  })

  for (const fn of ['get_my_phone', 'admin_get_user_phone']) {
    it(`${fn} is SECURITY DEFINER with search_path = public`, () => {
      const re = new RegExp(
        `CREATE OR REPLACE FUNCTION public\\.${fn}[\\s\\S]*?SECURITY DEFINER[\\s\\S]*?SET search_path = public`,
      )
      expect(sql).toMatch(re)
    })

    it(`GRANT EXECUTE on ${fn} is given to authenticated`, () => {
      expect(sql).toMatch(
        new RegExp(
          `GRANT EXECUTE ON FUNCTION public\\.${fn}\\b[\\s\\S]*?TO authenticated`,
        ),
      )
    })
  }

  it('admin_get_user_phone RAISE EXCEPTIONs on non-admin callers (mirrors admin_get_demographics)', () => {
    const fnBody = sql.match(
      /CREATE OR REPLACE FUNCTION public\.admin_get_user_phone[\s\S]*?\$\$[\s\S]*?\$\$/,
    )
    expect(fnBody).toBeTruthy()
    expect(fnBody![0]).toMatch(/role = 'admin'/)
    expect(fnBody![0]).toMatch(/RAISE EXCEPTION 'forbidden'/)
  })

  it('get_my_phone filters by auth.uid() (callers can only read their own)', () => {
    const fnBody = sql.match(
      /CREATE OR REPLACE FUNCTION public\.get_my_phone[\s\S]*?\$\$[\s\S]*?\$\$/,
    )
    expect(fnBody).toBeTruthy()
    expect(fnBody![0]).toMatch(/WHERE id = auth\.uid\(\)/)
  })

  it('get_my_phone returns scalar text (not table) — caller-side wiring depends on this', () => {
    // RETURNS text is what `getMyPhone()` in queries/profile.ts expects.
    // Switching to RETURNS TABLE would change the wire format and break
    // the helper without a TS type error.
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.get_my_phone\(\)[\s\S]*?RETURNS text/,
    )
  })

  it('admin_get_user_phone parameter is named target_user_id (mirrors admin_get_demographics)', () => {
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.admin_get_user_phone\(target_user_id uuid\)/,
    )
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Layer 2 — Skipped DB-integration cases (TODO(W4-docker))
//
// These are the prompt's "critical assertions, do not skip" cases. They're
// SKIPPED here because Docker / Docker Desktop is not available on the
// build machine, so a local Supabase stack can't be brought up. Unskip
// once `supabase start` is reachable and run against a fresh
// `supabase db reset`. Each `it.skip(...)` body documents what the test
// should do; the names are written so failures cleanly identify the
// regression.
// ════════════════════════════════════════════════════════════════════════════

describe('DB integration — anon GRANT denial (TODO(W4-docker))', () => {
  // Three separate tests, one per protected column, so a failure
  // cleanly identifies which column was over-exposed.

  it.skip('anon SELECT gender from profiles → permission-denied (42501)', async () => {
    // TODO(W4-docker): unskip once a local Supabase stack is available.
    //
    // Setup: spawn an anon client (createClient with NEXT_PUBLIC_SUPABASE_ANON_KEY,
    // no auth session). Run:
    //   await anon.from('profiles').select('gender').limit(1)
    // Expect: error.code === '42501', error.message contains 'permission'.
    // The query must NOT silently return [] — that would mean the row was
    // hidden by RLS rather than the column being GRANT-blocked, and a
    // future RLS change could re-expose it.
  })

  it.skip('anon SELECT age_range from profiles → permission-denied (42501)', async () => {
    // TODO(W4-docker): same shape as the gender test above, swap column.
  })

  it.skip('anon SELECT phone_number from profiles → permission-denied (42501)', async () => {
    // TODO(W4-docker): same shape, phone_number column. Note: phone was
    // already revoked from anon in 20260420000003 — this is a regression
    // guard, not a new property of W1.
  })
})

describe('DB integration — authenticated non-admin GRANT denial (TODO(W4-docker))', () => {
  // The whole point of Decision 7 Option A — even authenticated members
  // cannot read these columns directly; only the SECURITY DEFINER
  // functions can.

  it.skip('authenticated non-admin SELECT gender from profiles → permission-denied', async () => {
    // TODO(W4-docker): seed two member profiles. Sign in as user A, then:
    //   await authedAsA.from('profiles').select('gender').eq('id', userB.id)
    // Expect: error.code === '42501'.
    // This MUST fail even when querying their own row — the GRANT is at
    // the column level, not row level.
  })

  it.skip('authenticated non-admin SELECT age_range from profiles → permission-denied', async () => {
    // TODO(W4-docker): same shape, age_range column.
  })

  it.skip('authenticated non-admin SELECT phone_number from profiles → permission-denied', async () => {
    // TODO(W4-docker): same shape, phone_number column. This is what 1b
    // adds; before 1b an authenticated user could read any other
    // member's phone_number via the REST API.
  })
})

describe('DB integration — SECURITY DEFINER self-read (TODO(W4-docker))', () => {
  it.skip('get_my_demographics() returns the caller’s own gender + age_range', async () => {
    // TODO(W4-docker): seed userA with gender='female', age_range='30-34'.
    // Sign in as userA. Call:
    //   const { data, error } = await authedAsA.rpc('get_my_demographics')
    // Expect: error is null, data is [{ gender: 'female', age_range: '30-34' }].
  })

  it.skip('get_my_demographics() ignores any attempt to pass another user’s id', async () => {
    // TODO(W4-docker): the function takes no parameters, so this is more
    // a contract test — verify the function signature (\df+ output)
    // really does take zero arguments. If a future refactor adds a
    // target_user_id parameter, this test must fail loudly.
    //
    // pg_proc.proargnames for `get_my_demographics` should be NULL (no
    // input parameters; `gender` and `age_range` are OUT-only TABLE
    // columns).
  })

  it.skip('get_my_phone() returns the caller’s own phone_number', async () => {
    // TODO(W4-docker): seed userA with phone_number='+447700900000'.
    // Sign in as userA. Call:
    //   const { data, error } = await authedAsA.rpc('get_my_phone')
    // Expect: error is null, data === '+447700900000'.
  })

  it.skip('get_my_phone() takes no parameters (cannot be tricked into reading another user’s phone)', async () => {
    // TODO(W4-docker): same contract test — \df+ public.get_my_phone
    // should show zero IN parameters. If anyone adds a target_user_id
    // parameter this test must fail; that would be a privacy regression
    // disguised as a feature.
  })
})

describe('DB integration — SECURITY DEFINER admin read (TODO(W4-docker))', () => {
  it.skip('admin_get_demographics(other_user) returns the row when caller has role=admin', async () => {
    // TODO(W4-docker): seed an admin user (role='admin') and a member
    // user with gender='male', age_range='35-39'. Sign in as admin and
    // call:
    //   await admin.rpc('admin_get_demographics', { target_user_id: memberId })
    // Expect: error is null, data is [{ gender: 'male', age_range: '35-39' }].
  })

  it.skip('admin_get_demographics(other_user) RAISES forbidden when caller is not an admin', async () => {
    // TODO(W4-docker): seed two member users. Sign in as userA. Call:
    //   await member.rpc('admin_get_demographics', { target_user_id: userB.id })
    // Expect: error is non-null, error.message contains 'forbidden' OR
    // the PostgREST "P0001" code (RAISE EXCEPTION translates to that).
  })

  it.skip('admin_get_user_phone(other_user) returns phone when caller has role=admin', async () => {
    // TODO(W4-docker): same shape as the demographics admin test.
  })

  it.skip('admin_get_user_phone(other_user) RAISES forbidden when caller is not an admin', async () => {
    // TODO(W4-docker): same shape — non-admin must hit the RAISE
    // EXCEPTION path before any data is returned.
  })
})

describe('DB integration — SMS-send admin-client path still reads phone (TODO(W4-docker))', () => {
  it.skip('service_role SELECT sms_consent, phone_number from profiles → succeeds', async () => {
    // TODO(W4-docker): use the service_role key (bypasses GRANTs). Run:
    //   await admin.from('profiles').select('sms_consent, phone_number').limit(1)
    // Expect: error is null, data is an array. If this fails, the SMS
    // pipeline at `src/lib/sms/send.ts:80-108` is broken. The W1
    // migration 1b explicitly states it must NOT revoke from
    // postgres/service_role — this test enforces that invariant on the
    // live DB. The text-level invariant is at line 99-103 of this file.
  })
})

describe('DB integration — enum + NULL handling (TODO(W4-docker))', () => {
  it.skip('INSERT profile with gender = \'invalid_value\' fails (enum check)', async () => {
    // TODO(W4-docker): try INSERT with an out-of-enum value. Expect:
    // error.code === '22P02' (invalid_text_representation) or '23514'
    // depending on PG version.
  })

  it.skip('INSERT profile with gender = \'prefer_not_to_say\' succeeds', async () => {
    // TODO(W4-docker): the enum's fourth value MUST be accepted — it's
    // the spec's "user actively declined" sentinel that the
    // Complete-Your-Profile banner relies on.
  })

  it.skip('INSERT profile with age_range = \'17-24\' fails', async () => {
    // TODO(W4-docker): the spec rejected `under_18` and any band
    // starting earlier than 18. The form is the gate; the column is the
    // backstop. If the enum ever gains a sub-18 value, this test must
    // fail.
  })

  it.skip('INSERT profile with age_range = \'50+\' succeeds', async () => {
    // TODO(W4-docker): the open-ended top band — the spec is explicit
    // that finer resolution above 50 has no operational use.
  })

  it.skip('gender, age_range, phone_number are all nullable', async () => {
    // TODO(W4-docker): INSERT a profile leaving all three fields
    // unspecified. Expect: success. UPDATE existing row to NULL on each.
    // Expect: success.
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Layer 3 — JS-side wiring (mocked, runs in CI)
// ════════════════════════════════════════════════════════════════════════════

// `server-only` is imported transitively by some of the modules under
// test. The package's default export throws outside a Next.js server
// bundle; mock to a no-op so static analysis can run.
vi.mock('server-only', () => ({}))

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

function mockChain(response: { data?: unknown; error?: unknown }) {
  const c: Record<string, ReturnType<typeof vi.fn>> = {}
  for (const m of [
    'select',
    'insert',
    'update',
    'delete',
    'eq',
    'is',
    'in',
    'order',
    'limit',
    'single',
    'maybeSingle',
  ]) {
    c[m] = vi.fn().mockReturnValue(c)
  }
  c.then = vi.fn((resolve: (v: unknown) => void) => resolve(response))
  return c
}

beforeEach(() => {
  vi.resetAllMocks()
})

// Subjects under test imported AFTER the mocks above so they pick up the
// mocked supabase client.
import { getMyPhone } from '@/lib/supabase/queries/profile'
import { getMySmsPreferences } from '@/app/(member)/profile/preferences-actions'

describe('queries/profile.getMyPhone — RPC wiring', () => {
  it('calls supabase.rpc(\'get_my_phone\') and returns the scalar string', async () => {
    mockRpc.mockResolvedValue({ data: '+447700900000', error: null })
    const result = await getMyPhone()
    expect(mockRpc).toHaveBeenCalledTimes(1)
    expect(mockRpc).toHaveBeenCalledWith('get_my_phone')
    expect(result).toBe('+447700900000')
  })

  it('returns null when the RPC returns null (caller has no phone on file)', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null })
    expect(await getMyPhone()).toBeNull()
  })

  it('returns null and logs when the RPC errors (e.g. caller not authenticated)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'JWT expired' },
    })
    expect(await getMyPhone()).toBeNull()
    expect(errorSpy).toHaveBeenCalledWith('[getMyPhone]', 'JWT expired')
    errorSpy.mockRestore()
  })
})

describe('preferences-actions.getMySmsPreferences — composes get_my_phone() into the result', () => {
  it('SELECTs sms_consent only (NOT phone_number) from profiles, then sources phone via RPC', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    // The from('profiles') chain returns sms_consent.
    const profileChain = mockChain({
      data: { sms_consent: true },
      error: null,
    })
    profileChain.maybeSingle = vi
      .fn()
      .mockResolvedValue({ data: { sms_consent: true }, error: null })
    mockFrom.mockReturnValue(profileChain)
    mockRpc.mockResolvedValue({ data: '+447700900111', error: null })

    const result = await getMySmsPreferences()

    expect(result).toEqual({
      sms_consent: true,
      phone_number: '+447700900111',
    })
    // CRITICAL: the SELECT list must NOT include phone_number — that's
    // exactly the column W1 narrowed away from authenticated. A future
    // refactor that re-adds it to this SELECT would be a regression.
    const selectArgs = (profileChain.select as ReturnType<typeof vi.fn>).mock
      .calls[0]
    expect(String(selectArgs[0])).toContain('sms_consent')
    expect(String(selectArgs[0])).not.toContain('phone_number')
    // And the RPC is the new source of truth for phone.
    expect(mockRpc).toHaveBeenCalledWith('get_my_phone')
  })

  it('returns phone_number=null when the RPC errors (degrades gracefully)', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    const profileChain = mockChain({
      data: { sms_consent: false },
      error: null,
    })
    profileChain.maybeSingle = vi
      .fn()
      .mockResolvedValue({ data: { sms_consent: false }, error: null })
    mockFrom.mockReturnValue(profileChain)
    mockRpc.mockResolvedValue({ data: null, error: { message: 'boom' } })

    const result = await getMySmsPreferences()
    expect(result).toEqual({ sms_consent: false, phone_number: null })
  })

  it('returns null when the user is not authenticated (does not call RPC)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null })
    const result = await getMySmsPreferences()
    expect(result).toBeNull()
    expect(mockRpc).not.toHaveBeenCalled()
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Component-render: ProfileHeader still surfaces phone_number after W1
// ────────────────────────────────────────────────────────────────────────────

import { createElement } from 'react'
import { render, screen } from '@testing-library/react'
import { ProfileHeader } from '@/components/profile/ProfileHeader'
import { SmsPreferencesSection } from '@/components/profile/SmsPreferencesSection'
import type { Profile } from '@/types'

vi.mock('next/image', () => ({
  default: ({ alt, src }: { alt: string; src: string }) =>
    createElement('img', { alt, src }),
}))

vi.mock('@/app/(member)/profile/preferences-actions', async (orig) => {
  // Keep the SmsPreferences type export the component imports as a TYPE,
  // but stub the runtime updateSmsConsent so the toggle can be rendered.
  const actual = (await orig()) as Record<string, unknown>
  return {
    ...actual,
    updateSmsConsent: vi.fn().mockResolvedValue({ success: true }),
  }
})

const baseProfile: Profile & { interests: string[] } = {
  id: 'user-1',
  email: 'charlotte@example.com',
  full_name: 'Charlotte Moreau',
  avatar_url: null,
  job_title: null,
  company: null,
  industry: null,
  bio: null,
  linkedin_url: null,
  role: 'member',
  onboarding_complete: true,
  referral_source: null,
  phone_number: null,
  email_consent: false,
  email_verified: false,
  status: 'active',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  deleted_at: null,
  interests: [],
}

describe('ProfileHeader — phone display contract', () => {
  it('renders profile.phone_number when populated (post-W1: source is the page-side merge of get_my_phone())', () => {
    render(
      createElement(ProfileHeader, {
        profile: { ...baseProfile, phone_number: '+447700900000' },
        onEditClick: () => {},
      }),
    )
    expect(screen.getByText('+447700900000')).toBeTruthy()
  })

  it('does NOT render a phone line when profile.phone_number is null', () => {
    render(
      createElement(ProfileHeader, {
        profile: baseProfile,
        onEditClick: () => {},
      }),
    )
    expect(screen.queryByText(/\+44/)).toBeNull()
  })
})

describe('SmsPreferencesSection — disabled-without-phone contract', () => {
  it('enables the toggle when initial.phone_number is set (post-W1: provided by getMySmsPreferences via RPC)', () => {
    const { container } = render(
      createElement(SmsPreferencesSection, {
        initial: { sms_consent: false, phone_number: '+447700900000' },
      }),
    )
    const toggle = container.querySelector(
      'button[role="switch"]',
    ) as HTMLButtonElement | null
    expect(toggle).toBeTruthy()
    expect(toggle!.disabled).toBe(false)
  })

  it('disables the toggle when initial.phone_number is null', () => {
    const { container } = render(
      createElement(SmsPreferencesSection, {
        initial: { sms_consent: false, phone_number: null },
      }),
    )
    const toggle = container.querySelector(
      'button[role="switch"]',
    ) as HTMLButtonElement | null
    expect(toggle).toBeTruthy()
    expect(toggle!.disabled).toBe(true)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Layer 4 — Cross-cutting `select('*')` audit
// ════════════════════════════════════════════════════════════════════════════
//
// After Migration 1a, a user-scoped `.from('profiles').select('*')` will
// either fail or silently return a partial row — neither acceptable.
// All such call sites must enumerate columns explicitly (the way the
// privacy-actions exportMyData fix did in this PR), or use the admin
// client (which bypasses GRANTs).
//
// This test scans `src/` and fails if it finds a NEW `.select('*')` on
// the profiles table inside a file that doesn't belong on the
// admin-client allow-list.
// ════════════════════════════════════════════════════════════════════════════

describe('No new user-scoped select(\'*\') on profiles', () => {
  // Existing call sites that use `select('*')` on profiles and are
  // accepted as safe under the post-W1 GRANT model. Each entry needs
  // a comment explaining WHY — keep this small and reviewed.
  const ALLOWLIST = new Set<string>([
    // Pre-existing admin-page query. Uses createServerClient (with the
    // admin user's auth session, not the service_role admin client),
    // so it goes through the same column GRANTs as any other
    // authenticated caller. PostgREST's `select=*` is role-aware: it
    // expands to the columns the role has SELECT on, silently
    // omitting revoked columns (verified empirically — the page has
    // worked since `stripe_customer_id` and
    // `profile_nudge_email_sent_at` were revoked from authenticated).
    // After W1 it also silently omits gender + age_range + phone_number,
    // which is the desired admin-list-page behaviour. Flagged in the
    // W1 handover as a pre-existing pattern; if the admin page ever
    // needs to display those columns it must switch to the per-row
    // SECURITY DEFINER fns (admin_get_demographics /
    // admin_get_user_phone) and enumerate the safe columns explicitly.
    'src/app/(admin)/admin/actions.ts',
  ])

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (entry === 'node_modules' || entry === '__tests__' || entry === '__a11y__') continue
      const stat = statSync(full)
      if (stat.isDirectory()) walk(full, out)
      else if (full.endsWith('.ts') || full.endsWith('.tsx')) out.push(full)
    }
    return out
  }

  it('finds no new .from(\'profiles\').select(\'*\') outside the admin allow-list', () => {
    const SRC = resolve(__dirname, '../../..')
    const files = walk(SRC)
    const offenders: string[] = []
    for (const f of files) {
      const text = readFileSync(f, 'utf-8')
      // Look for `.from('profiles')` somewhere followed by `.select('*')`
      // on the same chain (within the next few lines).
      const re = /\.from\(\s*['"]profiles['"]\s*\)[\s\S]{0,200}?\.select\(\s*['"]\*['"]\s*\)/
      if (re.test(text)) {
        const rel = f.slice(f.indexOf('/src/') + 1)
        if (!ALLOWLIST.has(rel)) {
          offenders.push(rel)
        }
      }
    }
    expect(
      offenders,
      `User-scoped \`.from('profiles').select('*')\` would silently break or fail under the W1 GRANT narrowing. Offending files:\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
  })
})
