// F2-app regression guard — Phase 3 member data layer.
//
// The two production reads of `user_interests.interest` (the text
// column populated by the registration / profile chip picker) were
// migrated to read `tags.label` via JOIN through `user_interests.tag_id`:
//
//   1. getProfile in src/lib/supabase/queries/profile.ts — used by the
//      /profile page server component.
//   2. exportMyData in src/app/(member)/profile/privacy-actions.ts —
//      the GDPR data-export Server Action.
//
// F2-schema (next dispatch) drops the `interest` text column. Until
// then the column stays alive so the two write paths (saveInterests in
// `src/app/(auth)/actions.ts` and updateInterests in
// `src/app/(member)/profile/actions.ts`) can keep populating it
// alongside `tag_id` for safe rollback.
//
// This guard locks the read-side migration in: any future PR that
// reintroduces a read of the `interest` text column inside the scanned
// directories fails loudly with file/line/pattern/excerpt diagnostics
// (mirrors F1a's `event-category-migration-guard.test.ts`).
//
// Plus two edge-case shape-stability tests (one for getProfile's
// `string[]` return shape, one for exportMyData's `[{id, interest,
// created_at}]` emission) — these lock in the consumer-visible
// contracts the dev preserved on purpose for backward-compat, so a
// future "simplify" PR can't silently flip them.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const REPO_ROOT = resolve(__dirname, '../../..')

// ── Configuration ───────────────────────────────────────────────────────────

// SCAN_DIRS — the two directories that hold the migrated read paths.
// Out-of-scope (deliberately NOT scanned, each for a different reason):
//
//   - src/types/                — UserInterest.interest type field;
//                                  retired by F2-schema.
//   - src/lib/constants*        — INTEREST_OPTIONS slug map; consumed
//                                  by write paths.
//   - src/components/profile/   — UI loop variables named `interest`
//                                  iterating over INTEREST_OPTIONS.
//   - src/app/(auth)/join/      — same UI-loop pattern.
const SCAN_DIRS = [
  'src/lib/supabase/queries',
  'src/app/(member)/profile',
] as const

// File-level allowlist — write paths that legitimately INSERT both the
// `interest` text column and the new `tag_id`. Each entry must name the
// retirement wave so future cleanup is scripted.
const ALLOWLIST = new Set<string>([
  // updateInterests INSERT writes (user_id, interest, tag_id). The
  // `interest` text is part of the row payload; tag_id is the new FK.
  // F2-schema retires both the column and this allowlist entry.
  'src/app/(member)/profile/actions.ts',
  // saveInterests (registration) writes the same row shape. Lives
  // outside the current SCAN_DIRS so this entry is preventive — if a
  // future PR widens SCAN_DIRS to src/app/(auth)/, the allowlist is
  // already in place. Same retirement as actions.ts (F2-schema).
  'src/app/(auth)/actions.ts',
])

// Patterns from the prompt's grep brief, with one refinement on the
// property-access pattern:
//
//   1. `\.interest\b(?!\s*[!=]==?\s*null)` — any `.interest` property
//      access NOT followed by a null comparison. The negative lookahead
//      excludes `row.interest !== null` (and `!= null`, `=== null`,
//      `== null`) because privacy-actions.ts:140 reads a LOCALLY-mapped
//      `interest` field on the export reshape (sourced from tags.label,
//      NOT the legacy DB column). The reshape preserves the export's
//      `[{id, interest, created_at}]` shape for backward-compat.
//      Sabotage with `const x = row.interest` (no null comparison)
//      still fires.
//
//   2. `\binterest\s*[,)}]` — `interest` as a destructured / arg-list
//      identifier: `{ interest, ... }`, `{ interest }`,
//      `f(thing, interest)`, `f(interest)`. Lowercase + word boundary
//      so it doesn't match `interestSlugFor` or `INTEREST_OPTIONS`.
//
//   3. `select.*[, ]interest\b` — `interest` appearing inside a
//      `.select(...)` column list, optionally preceded by `, ` or ` `.
//      Strongest signal of all — a SELECT pulling the legacy text
//      column.
const PROTECTED_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\.interest\b(?!\s*[!=]==?\s*null)/, '.interest property access'],
  [/\binterest\s*[,)}]/, 'destructured `interest` identifier'],
  [/select.*[, ]interest\b/, '`interest` in a .select() column list'],
]

// ── Comment stripper (mirror of F1a's stateful version) ─────────────────────

/**
 * Strip JS / JSX comments from one line, given whether we're already
 * inside a multi-line block comment that started on a previous line.
 * Returns the stripped line plus the new "inside block comment" flag.
 *
 * Plain-text false positives (e.g. `'http://x'` matching `//`) are not
 * a concern — none of our PROTECTED_PATTERNS appear inside string
 * literals in the migrated source.
 */
function stripCommentsStateful(
  line: string,
  insideBlock: boolean,
): { stripped: string; insideBlock: boolean } {
  let i = 0
  let out = ''
  let block = insideBlock
  while (i < line.length) {
    if (block) {
      const close = line.indexOf('*/', i)
      if (close === -1) {
        return { stripped: out, insideBlock: true }
      }
      i = close + 2
      block = false
      continue
    }
    if (line[i] === '/' && line[i + 1] === '/') break
    if (line[i] === '/' && line[i + 1] === '*') {
      block = true
      i += 2
      continue
    }
    out += line[i]
    i += 1
  }
  return { stripped: out, insideBlock: block }
}

function walk(dir: string): string[] {
  const out: string[] = []
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = join(dir, entry)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      // Skip __tests__ — fixture mocks legitimately set `interest` on
      // user_interests rows for the W2+W3 INSERT-shape assertions, and
      // updating them isn't a regression.
      if (entry === '__tests__') continue
      out.push(...walk(full))
    } else if (entry.endsWith('.tsx') || entry.endsWith('.ts')) {
      out.push(full)
    }
  }
  return out
}

interface Hit {
  file: string
  pattern: string
  line: number
  excerpt: string
}

function scan(): Hit[] {
  const hits: Hit[] = []
  for (const dir of SCAN_DIRS) {
    const files = walk(resolve(REPO_ROOT, dir))
    for (const file of files) {
      const rel = relative(REPO_ROOT, file)
      const lines = readFileSync(file, 'utf-8').split('\n')
      let insideBlock = false
      for (let i = 0; i < lines.length; i++) {
        const result = stripCommentsStateful(lines[i], insideBlock)
        insideBlock = result.insideBlock
        if (!result.stripped.trim()) continue
        for (const [re, label] of PROTECTED_PATTERNS) {
          if (re.test(result.stripped)) {
            hits.push({
              file: rel,
              pattern: label,
              line: i + 1,
              excerpt: lines[i].trim().slice(0, 200),
            })
            break // one hit per line is enough
          }
        }
      }
    }
  }
  return hits
}

// ── Test 1 — main offender check ───────────────────────────────────────────

describe('F2-app — user_interests.interest read regression guard', () => {
  it('migrated read paths source labels via tags JOIN, never the legacy interest text column', () => {
    const hits = scan()
    const offenders = hits.filter((h) => !ALLOWLIST.has(h.file))

    if (offenders.length > 0) {
      const grouped = new Map<string, Hit[]>()
      for (const h of offenders) {
        const list = grouped.get(h.file) ?? []
        list.push(h)
        grouped.set(h.file, list)
      }

      const lines: string[] = []
      lines.push(
        'F2 REGRESSION — `user_interests.interest` referenced in migrated read paths.',
      )
      lines.push('')
      lines.push(
        'getProfile (queries/profile.ts) and exportMyData (privacy-actions.ts)',
      )
      lines.push(
        'MUST source labels via the JOIN to `tags.label`. The legacy text column',
      )
      lines.push('is doomed — F2-schema drops it next.')
      lines.push('')
      lines.push('Offending references:')
      for (const [file, fileHits] of grouped) {
        lines.push(`  ${file}`)
        for (const h of fileHits) {
          lines.push(`    line ${h.line} (${h.pattern}): ${h.excerpt}`)
        }
      }
      lines.push('')
      const allowlistDescription = [...ALLOWLIST]
        .sort()
        .map((f) => `${f} (write path)`)
        .join(', ')
      lines.push(`Currently allowlisted: ${allowlistDescription}`)
      lines.push('')
      lines.push(
        "Fix: replace the read with the joined tag — `.select('..., tags(slug, label)')`",
      )
      lines.push(
        'and read `row.tags.label`. If the file is genuinely a write path, add it',
      )
      lines.push(
        'to ALLOWLIST in this test file with a comment naming the retirement wave.',
      )
      throw new Error(lines.join('\n'))
    }

    expect(offenders).toEqual([])
  })

  it('the scan reaches the two migrated files (catches walk()/path-resolution breakage)', () => {
    const queries = walk(resolve(REPO_ROOT, 'src/lib/supabase/queries'))
    const profile = walk(resolve(REPO_ROOT, 'src/app/(member)/profile'))
    const all = new Set(
      [...queries, ...profile].map((f) => relative(REPO_ROOT, f)),
    )
    expect(
      all.has('src/lib/supabase/queries/profile.ts'),
      'Walk did not visit src/lib/supabase/queries/profile.ts — path resolution may be broken; the guard above could be falsely passing.',
    ).toBe(true)
    expect(
      all.has('src/app/(member)/profile/privacy-actions.ts'),
      'Walk did not visit src/app/(member)/profile/privacy-actions.ts — path resolution may be broken; the guard above could be falsely passing.',
    ).toBe(true)
  })

  it('the comment-stripper still neutralises mentions of interest in comments (catches strip-fn breakage)', () => {
    // Both migrated files contain JSDoc / line-comment mentions of the
    // legacy `user_interests.interest` text column (explaining the
    // migration). If the stripper regresses, those comments become
    // false-positive offenders.
    const single = (line: string) =>
      stripCommentsStateful(line, false).stripped
    expect(
      single('  // legacy `user_interests.interest` column dropped by F2'),
    ).toBe('  ')
    expect(single('foo /* was: row.interest */ bar')).toBe('foo  bar')
    const jsdocLine = stripCommentsStateful(
      ' * (`[{ id, interest, created_at }, ...]`) is preserved',
      true,
    )
    expect(jsdocLine.stripped.trim()).toBe('')
    expect(jsdocLine.insideBlock).toBe(true)
    expect(stripCommentsStateful('   */', true).insideBlock).toBe(false)
  })

  it('the property-access pattern excludes `.interest !== null` reshape filters (and only those)', () => {
    // The negative-lookahead refinement is load-bearing — without it,
    // the F2-app reshape filter at privacy-actions.ts:140 (`row.interest
    // !== null`) reads the locally-mapped field but would false-positive.
    // This test pins the exclusion shape so a future tweak to the regex
    // doesn't silently drop sabotage coverage.
    const re = PROTECTED_PATTERNS[0][0]
    // Excluded — the four null-comparison forms used by reshape filters.
    expect(re.test('row.interest !== null')).toBe(false)
    expect(re.test('row.interest != null')).toBe(false)
    expect(re.test('row.interest === null')).toBe(false)
    expect(re.test('row.interest == null')).toBe(false)
    // Caught — the prompt's named sabotage shape and obvious DB reads.
    expect(re.test('const x = row.interest')).toBe(true)
    expect(re.test('return row.interest')).toBe(true)
    expect(re.test('interests.push(data.interest)')).toBe(true)
    expect(re.test('row.interest.toLowerCase()')).toBe(true)
  })
})

// ── Test 2 — getProfile shape lock-in (string[] of labels, not slugs) ──────

interface MockQueryBuilder {
  select: ReturnType<typeof vi.fn>
  eq: ReturnType<typeof vi.fn>
  is: ReturnType<typeof vi.fn>
  single: ReturnType<typeof vi.fn>
  order: ReturnType<typeof vi.fn>
  then: (
    onResolve: (v: unknown) => unknown,
    onReject?: (v: unknown) => unknown,
  ) => Promise<unknown>
  mockResolve: (data: unknown) => void
}

function createQueryBuilder(): MockQueryBuilder {
  let _result: { data: unknown; error: unknown } = { data: null, error: null }
  const builder = {} as MockQueryBuilder
  const methods: (keyof MockQueryBuilder)[] = [
    'select',
    'eq',
    'is',
    'single',
    'order',
  ]
  for (const m of methods) {
    ;(builder[m] as ReturnType<typeof vi.fn>) = vi.fn(() => builder)
  }
  builder.then = (onResolve, onReject) =>
    Promise.resolve(_result).then(onResolve, onReject)
  builder.mockResolve = (data) => {
    _result = { data, error: null }
  }
  return builder
}

let fromBuilders: Record<string, MockQueryBuilder>

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(() =>
    Promise.resolve({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-1', email: 'u@x.com' } },
          error: null,
        }),
        signOut: vi.fn(),
      },
      from: vi.fn((table: string) => {
        if (!fromBuilders[table]) fromBuilders[table] = createQueryBuilder()
        return fromBuilders[table]
      }),
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    }),
  ),
}))

// Privacy-actions reaches for the admin client + a few peripheral
// modules we don't exercise here. Stub them so importing the action
// doesn't blow up on a missing service-role env.
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: vi.fn(), rpc: vi.fn() }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('@/lib/stripe/server', () => ({
  getStripeClient: () => ({ customers: { del: vi.fn() } }),
}))
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }))

import { getProfile } from '@/lib/supabase/queries/profile'
import { exportMyData } from '@/app/(member)/profile/privacy-actions'

const PROFILE_FIXTURE = {
  id: 'user-1',
  email: 'u@x.com',
  full_name: 'Test User',
  avatar_url: null,
  job_title: null,
  company: null,
  industry: null,
  bio: null,
  linkedin_url: null,
  role: 'member',
  onboarding_complete: true,
  referral_source: null,
  status: 'approved',
  email_consent: true,
  email_verified: true,
  sms_consent: false,
  moderation_reason: null,
  moderation_at: null,
  moderation_by: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  deleted_at: null,
}

describe('F2-app — getProfile interests shape lock-in', () => {
  beforeEach(() => {
    fromBuilders = {}
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns interests as `string[]` of LABELS sourced from the joined tags row (not slugs, not objects)', async () => {
    const profileBuilder = createQueryBuilder()
    profileBuilder.mockResolve(PROFILE_FIXTURE)
    fromBuilders['profiles'] = profileBuilder

    const interestsBuilder = createQueryBuilder()
    interestsBuilder.mockResolve([
      {
        id: 'int-1',
        user_id: 'user-1',
        tag_id: 'tag-1',
        created_at: '2026-01-01T00:00:00Z',
        tags: { slug: 'drinks-bars', label: 'Drinks & Bars' },
      },
      {
        id: 'int-2',
        user_id: 'user-1',
        tag_id: 'tag-2',
        created_at: '2026-01-01T00:00:00Z',
        tags: { slug: 'interest-travel', label: 'Travel' },
      },
    ])
    fromBuilders['user_interests'] = interestsBuilder

    const result = await getProfile('user-1')

    expect(result).not.toBeNull()
    expect(Array.isArray(result!.interests)).toBe(true)
    // Labels in source order — not slugs, not objects.
    expect(result!.interests).toEqual(['Drinks & Bars', 'Travel'])
    for (const i of result!.interests) {
      expect(typeof i).toBe('string')
    }
    // Sanity: the slugs (which the migration renames AWAY from) must
    // not leak into the consumer-visible array. If a future PR swaps
    // `tag.label` for `tag.slug`, this fails loudly.
    expect(result!.interests).not.toContain('drinks-bars')
    expect(result!.interests).not.toContain('interest-travel')
  })
})

// ── Test 3 — exportMyData shape lock-in ────────────────────────────────────

describe('F2-app — exportMyData interests shape lock-in', () => {
  beforeEach(() => {
    fromBuilders = {}
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('emits interests as an array of {id, interest, created_at} objects with `interest` from tags.label, omitting null-tag rows', async () => {
    // Stub every from() the action calls. Only user_interests has a
    // shape we care about — the other branches just need to not crash
    // JSON.stringify, so a bare `{}` data resolves cleanly.
    fromBuilders['profiles'] = createQueryBuilder()
    fromBuilders['profiles'].mockResolve(PROFILE_FIXTURE)
    fromBuilders['bookings'] = createQueryBuilder()
    fromBuilders['bookings'].mockResolve([])
    fromBuilders['event_reviews'] = createQueryBuilder()
    fromBuilders['event_reviews'].mockResolve([])

    const interestsBuilder = createQueryBuilder()
    interestsBuilder.mockResolve([
      {
        id: 'int-1',
        created_at: '2026-01-01T00:00:00Z',
        tags: { slug: 'drinks-bars', label: 'Drinks & Bars' },
      },
      {
        // Defensive: joined tag is null (broken FK / orphaned row).
        // The reshape filter at privacy-actions.ts:140 omits this row.
        id: 'int-orphan',
        created_at: '2026-01-01T00:00:00Z',
        tags: null,
      },
      {
        id: 'int-2',
        created_at: '2026-01-02T00:00:00Z',
        tags: { slug: 'interest-travel', label: 'Travel' },
      },
    ])
    fromBuilders['user_interests'] = interestsBuilder

    const json = await exportMyData()
    const parsed = JSON.parse(json) as {
      interests: Array<{ id: string; interest: string; created_at: string }>
    }

    expect(Array.isArray(parsed.interests)).toBe(true)
    // Two valid rows out of three source rows (orphan filtered).
    expect(parsed.interests).toHaveLength(2)

    for (const entry of parsed.interests) {
      // Exactly the three keys — no leaked `tag_id`, no nested `tags`.
      const keys = Object.keys(entry).sort()
      expect(keys).toEqual(['created_at', 'id', 'interest'])
      // `interest` is a non-empty string sourced from tags.label.
      expect(typeof entry.interest).toBe('string')
      expect(entry.interest.length).toBeGreaterThan(0)
    }

    // The omitted orphan row's id must not appear.
    expect(parsed.interests.find((e) => e.id === 'int-orphan')).toBeUndefined()
    // The two preserved rows carry their joined LABEL, not slug. If a
    // future PR swaps tags.label for tags.slug, this fails loudly.
    const interestValues = parsed.interests.map((e) => e.interest).sort()
    expect(interestValues).toEqual(['Drinks & Bars', 'Travel'])
  })
})
