// F2 regression guard — Phase 3 member data layer.
//
// History:
//   • F2-app (PR #66) migrated the two production reads of
//     `user_interests.interest` to JOIN through `user_interests.tag_id`
//     onto `tags.label`:
//       - getProfile (src/lib/supabase/queries/profile.ts)
//       - exportMyData (src/app/(member)/profile/privacy-actions.ts)
//   • F2-schema (this PR) dropped the `interest` text column outright.
//     `user_interests.tag_id` is now the SOLE carrier of interest
//     semantics; the column the legacy reads pointed at no longer
//     exists in the database.
//
// Post-F2-schema this guard is the static-analysis backstop against
// accidental re-introduction. A future PR that re-adds a SELECT or
// property read for an `interest` text column would now also fail at
// runtime (the column is gone), but catching it at test time means
// the regression surfaces with a clear diagnostic before anyone hits
// the runtime error.
//
// The earlier 2-entry write-path allowlist (actions.ts + (auth)/actions.ts,
// which used to INSERT both `interest` text and tag_id) is empty now —
// F2-schema's INSERT-payload trim removed those references entirely.
// The loop variables in those write paths were renamed to `interestLabel`
// in the same change so the destructure pattern below no longer matches.
//
// Plus two edge-case shape-stability tests (one for getProfile's
// `string[]` return shape, one for exportMyData's `[{id, interest,
// created_at}]` emission) — these lock in the consumer-visible
// contracts the F2-app dev preserved on purpose for backward-compat,
// so a future "simplify" PR can't silently flip them.

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

// File-level allowlist — empty post-F2-schema. The legacy column the
// allowlist used to cover (write-path INSERTs of `interest` text +
// tag_id) no longer exists. Both write paths were trimmed in F2-schema's
// INSERT-payload edit; the loop variables were renamed to `interestLabel`
// so they no longer trip the destructure pattern below.
//
// If a future PR genuinely needs to add a file-level exemption (e.g. a
// new admin tool that legitimately references an `interest` field for
// display), add the entry here with a comment explaining why.
const ALLOWLIST = new Set<string>([])

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

// ── Test 4 — F2-schema migration source-text shape (lockstep) ──────────────

describe('F2-schema — drop migration source-text shape', () => {
  // The F2-schema migration is a DESTRUCTIVE one-shot drop: one
  // constraint, one column. Its safety net is the defensive RAISE
  // EXCEPTION block at the end. A future PR that weakens any of those
  // statements (removes an IF EXISTS, drops the verification block,
  // forgets one of the two artefact-survival checks) would silently
  // leave dead schema behind on hosted — Postgres would happily ignore
  // the unique constraint until something tries to use it, and a
  // lingering `interest` column would silently get re-populated by any
  // INSERT that still references it.
  //
  // These source-text assertions lock in the migration's SHAPE so that
  // kind of weakening surfaces here, with a named diagnostic, rather
  // than as a half-applied schema on production. Pattern mirrors the
  // F1b-schema source-text guard.

  const MIGRATION_PATH = resolve(
    REPO_ROOT,
    'supabase/migrations/20260507000001_drop_user_interests_interest_column.sql',
  )
  const MIGRATION_SQL = readFileSync(MIGRATION_PATH, 'utf-8')

  // The 2 ALTER statements + their target object names. Each pattern
  // is case-insensitive on the SQL keywords (ALTER / DROP / CONSTRAINT
  // / COLUMN) and tolerates whitespace / newlines, but locks the
  // IF EXISTS clause and the fully-qualified object names down.
  const ALTER_STATEMENTS: ReadonlyArray<readonly [string, RegExp]> = [
    [
      'DROP CONSTRAINT uq_user_interests_user_interest',
      /ALTER\s+TABLE\s+public\.user_interests\s+DROP\s+CONSTRAINT\s+IF\s+EXISTS\s+uq_user_interests_user_interest/i,
    ],
    [
      'DROP COLUMN user_interests.interest',
      /ALTER\s+TABLE\s+public\.user_interests\s+DROP\s+COLUMN\s+IF\s+EXISTS\s+interest/i,
    ],
  ]

  for (const [label, re] of ALTER_STATEMENTS) {
    it(`migration contains ${label} (with IF EXISTS for idempotency)`, () => {
      expect(
        MIGRATION_SQL,
        `Missing or weakened ALTER statement — expected /${re.source}/`,
      ).toMatch(re)
    })
  }

  it('migration has a defensive DO $$ … END $$; verification block', () => {
    // The block re-checks information_schema / pg_constraint and
    // RAISE EXCEPTIONs if either of the two artefacts (column or
    // constraint) survive. Weakening this turns a half-applied schema
    // into a silent success.
    expect(MIGRATION_SQL).toMatch(/DO\s+\$\$\s*BEGIN[\s\S]+END\s+\$\$;/)
    expect(MIGRATION_SQL).toMatch(/RAISE\s+EXCEPTION/i)
  })

  it('verification block names both artefact-survival checks', () => {
    // Each of these strings must appear inside the verification block —
    // they're the explicit catalog probes for the two artefacts. If a
    // future "cleanup" deletes one of the IF EXISTS branches, this fails.
    expect(MIGRATION_SQL).toMatch(/user_interests\.interest column still exists/i)
    expect(MIGRATION_SQL).toMatch(
      /uq_user_interests_user_interest constraint still exists/i,
    )
  })

  it('migration uses IF EXISTS uniformly on every ALTER … DROP statement', () => {
    // Iterate every line that is the start of an `ALTER TABLE …` block
    // and assert the captured statement (this line + continuations
    // until `;`) contains both `DROP` and `IF EXISTS`. Anchored to
    // start-of-line so we skip any "DROP COLUMN" / "DROP CONSTRAINT"
    // wording inside RAISE EXCEPTION string literals.
    const lines = MIGRATION_SQL.split('\n')
    const ddlStarter = /^\s*ALTER\s+TABLE\b/i
    let saw = 0
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (!ddlStarter.test(line)) continue
      // Capture the statement (this line + continuations until the
      // closing semicolon) so we can scan it for IF EXISTS even if
      // the statement spans lines.
      let stmt = line
      let j = i
      while (!stmt.includes(';') && j + 1 < lines.length) {
        j += 1
        stmt += '\n' + lines[j]
      }
      // Only count statements that contain a DROP — additive ALTER
      // TABLE statements (e.g. ADD CONSTRAINT) wouldn't need IF EXISTS.
      if (!/\bDROP\b/i.test(stmt)) continue
      saw++
      expect(
        stmt,
        `ALTER … DROP without IF EXISTS guard at line ${i + 1} — got: ${stmt.slice(0, 100)}`,
      ).toMatch(/IF\s+EXISTS/i)
    }
    // Sanity: the migration has exactly 2 ALTER … DROP statements
    // (constraint + column). Both must be IF EXISTS-guarded.
    expect(saw).toBe(2)
  })
})
