// F1a/F1b regression guard — Phase 3 member data layer, app-code migration.
//
// Production code reading event data was migrated off the legacy
// `events.category` enum (9 values: drinks, dining, cultural, …) to read
// the new `event.primary_tag.label` from the canonical 15-value taxonomy
// (Theatre & Comedy, Galleries & Museums, Nightlife & Dancing, …) shipped
// by Migration 2 (20260504000001_create_tags_and_event_tags.sql). F1a
// migrated the 4 member-facing event components and added the ?tag=
// filter contract; F1b-app migrated the 3 remaining carry-overs
// (getRelatedEvents query + caller, BookingCard chip, EventsTable chip).
// F1b-schema (Migration 20260506000001) dropped the column, the enum
// type, the bidirectional sync triggers, and the slug→enum helper.
//
// Post-F1b-schema invariant — the legacy `EventCategory` type,
// `CATEGORY_LABELS` map, and `categoryLabel` helper have all been
// removed from `src/types/index.ts`. Production code anywhere in `src/`
// must not reference `event.category`, `categoryLabel`, or
// `CATEGORY_LABELS` — none of them exist anymore. The `EventCategory`
// type is also gone. Only the small allowlist below covers files where
// the WORD `category` still appears for unrelated reasons.
//
// SCAN_DIRS — every directory that holds production code reading event
// data. The guard fails loudly if any production file outside the
// allowlist references the legacy enum or its helpers:
//   - src/components/events/    — F1a-migrated 4 components
//   - src/components/admin/     — F1b-app-migrated EventsTable
//   - src/components/profile/   — F1b-app-migrated BookingCard
//   - src/lib/supabase/queries/ — getRelatedEvents takes a slug
//   - src/app/events/           — caller of getRelatedEvents + the
//                                 ?category= soft-fallback redirect
//
// `src/types/index.ts` is intentionally still NOT scanned — even though
// the legacy artefacts are gone, the file's docstring comments mention
// `events.category` historically (explaining why fields are shaped the
// way they are). Scanning it would force pruning otherwise-useful
// migration-history annotations. If those annotations are removed in
// future, add `src/types/` to SCAN_DIRS — there's no longer any
// production code that needs an exception there.
//
// Plus three edge-case checks for the things the rendering tests don't
// exercise: the ?category= → ?tag= soft-fallback redirect contract, the
// ?tag= validation against PRIMARY_ELIGIBLE_TAG_SLUGS, and the chip-bar
// long-label layout (whitespace-nowrap on chips with 24+ char labels).
// Plus a function-source signature check for getRelatedEvents (F1b-app).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const REPO_ROOT = resolve(__dirname, '../../..')
const SCAN_DIRS = [
  'src/components/events',
  'src/components/admin',
  'src/components/profile',
  'src/lib/supabase/queries',
  'src/app/events',
] as const

// Allowlist — files where the WORD `category` legitimately appears for
// reasons unrelated to the legacy events.category enum. Each entry has
// to name why it's exempt (or be marked permanent if it covers an
// entirely different concept).
//
// The allowlist is a controlled exception, not a backdoor — any new
// entry must come with a comment explaining why the file is exempt.
//
// F1b-schema trim: profile.ts and reviews.ts were previously allowlisted
// because their .select() lists included the `category` column to
// populate Pick<> types. F1b-schema dropped the column AND the SELECT
// entries — both files are now category-free and have been removed
// from this allowlist.
const ALLOWLIST = new Set<string>([
  // /events page reads `?category=<value>` URL search-param for the F1a
  // soft-fallback redirect to `?tag=<slug>`. Old shared links from
  // before F1a (emails, Google search, social posts) keep arriving with
  // legacy enum strings as the param value forever — the redirect path
  // is permanent UX, not tied to any DB column.
  // Permanent.
  'src/app/events/page.tsx',
  // EmailPreferencesSection's `category` prop is NotificationCategory
  // from the email preferences subsystem (review_requests,
  // profile_nudges, admin_announcements). Unrelated domain entirely;
  // the regex would false-positive on every render path.
  // Permanent.
  'src/components/profile/EmailPreferencesSection.tsx',
  // TagPicker JSX user-copy "(one — the event's main category)" — plain
  // UI text in a help-string, not a code read.
  // Permanent.
  'src/components/admin/TagPicker.tsx',
])

// Patterns chosen from the prompt's grep brief plus a couple of
// belt-and-braces variants. All are case-sensitive on `category` so they
// don't match `Category` in unrelated identifiers like `NotificationCategory`.
// (The original `EventCategory` type was retired in F1b-schema along with
// the rest of the legacy artefacts.)
//
//   1. `\.category\b` — any property access ending in .category. Covers
//      `event.category`, `e.category`, `relatedEvent.category`, etc.
//   2. `\bcategoryLabel\s*\(` — calls to the legacy helper from @/types.
//      categoryLabel is the CATEGORY_LABELS lookup wrapped in a function;
//      its only use is rendering the legacy enum, so any call site is
//      a member-facing read regression.
//   3. `\bCATEGORY_LABELS\b` — direct map access, same rationale.
//   4. `\bcategory\s*[,)\}]` — destructuring of `category` from an
//      event-shaped object: `{ category, ... }`, `{ category }`,
//      `f(event, category)`. Lowercase + word boundary so it doesn't
//      match `categoryLabel`.
//   5. `\bcategory\s*=` — JSX prop or assignment, e.g. `<Foo category={x}>`.
const PROTECTED_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\.category\b/, 'event.category property access'],
  [/\bcategoryLabel\s*\(/, 'categoryLabel() call (legacy helper)'],
  [/\bCATEGORY_LABELS\b/, 'CATEGORY_LABELS map access (legacy)'],
  [/\bcategory\s*[,)}]/, 'destructured `category` from an event'],
  [/\bcategory\s*=/, 'JSX `category=` attribute or assignment'],
]

/**
 * Strip JS / JSX comments from one line, given whether we're already
 * inside a multi-line block comment that started on a previous line.
 * Returns the stripped line plus the new "inside block comment" flag.
 *
 * Handles:
 *   - inline `/* ... *\/` (single-line block comment, possibly multiple)
 *   - multi-line `/* … \n … *\/` JSDoc / file headers
 *   - `// …` line comment to end of line
 *   - JSX `{/* ... *\/}` — the inner block comment is stripped, leaving
 *     the harmless `{` and `}` braces behind
 *
 * Plain-text false positives (e.g. `'http://x'` matching `//`) are not a
 * concern — none of our PROTECTED_PATTERNS appear inside string literals
 * in the migrated source.
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
        // Block comment continues past end of line.
        return { stripped: out, insideBlock: true }
      }
      i = close + 2
      block = false
      continue
    }
    // Not in block — check for a comment opener.
    if (line[i] === '/' && line[i + 1] === '/') {
      // Line comment to end-of-line; nothing more to scan.
      break
    }
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
      // Skip __tests__ directories — fixtures legitimately set `category`
      // on mock events, and the migrated components' tests assert on the
      // new label. A test-side false positive would be noise.
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

// ── Test 1 — the main offender check ────────────────────────────────────────

describe('F1a — event.category migration regression guard', () => {
  it('every member-facing event component reads event.primary_tag, never event.category', () => {
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
        'F1A REGRESSION — `event.category` referenced in member-facing components after migration.',
      )
      lines.push('')
      lines.push(
        'The 4 components in src/components/events/ MUST read event.primary_tag.label,',
      )
      lines.push(
        'not event.category. The legacy enum is doomed — F1b drops the column.',
      )
      lines.push('')
      lines.push('Offending references:')
      for (const [file, fileHits] of grouped) {
        lines.push(`  ${file}`)
        for (const h of fileHits) {
          lines.push(`    line ${h.line} (${h.pattern}): ${h.excerpt}`)
        }
      }
      lines.push('')
      lines.push(
        `Currently allowlisted: ${ALLOWLIST.size === 0 ? '(none)' : [...ALLOWLIST].sort().join(', ')}`,
      )
      lines.push('')
      lines.push(
        'Fix: replace the read with event.primary_tag.label. If the change is genuinely',
      )
      lines.push(
        'admin-only or an exception, add the file to ALLOWLIST in this test file with',
      )
      lines.push('a TODO comment naming the wave that retires it.')
      throw new Error(lines.join('\n'))
    }

    expect(offenders).toEqual([])
  })

  it('the scan reaches the 4 migrated components (catches walk()/path-resolution breakage)', () => {
    const files = walk(resolve(REPO_ROOT, 'src/components/events'))
    const rels = new Set(files.map((f) => relative(REPO_ROOT, f)))
    const required = [
      'src/components/events/EventCard.tsx',
      'src/components/events/EventDetailClient.tsx',
      'src/components/events/EventsPageClient.tsx',
      'src/components/events/PastEventCard.tsx',
    ]
    for (const r of required) {
      expect(
        rels.has(r),
        `Walk did not visit ${r} — path resolution may be broken; the guard above could be falsely passing.`,
      ).toBe(true)
    }
  })

  it('the comment-stripper still neutralises mentions of event.category in comments (catches strip-fn breakage)', () => {
    // If the stripper regresses (e.g. someone removes the // handling or
    // breaks block-state tracking), the migrated components' inline
    // comments mentioning the old field would get flagged as offenders.
    // Keep this assertion so the regression on the stripper itself fails
    // this test instead of falsely triggering Test 1.
    const single = (line: string) =>
      stripCommentsStateful(line, false).stripped
    // `//` line comment
    expect(single('const x = event.primary_tag // event.category was here')).toBe(
      'const x = event.primary_tag ',
    )
    // Inline `/* ... */`
    expect(single('foo /* was: event.category */ bar')).toBe('foo  bar')
    // Pure-comment line
    expect(single('  // pure comment with event.category in it')).toBe('  ')
    // JSDoc continuation: `* Soft-fallback ?category= …` — the JSDoc
    // opener `/**` was on a previous line, so insideBlock = true.
    const jsdoc = stripCommentsStateful(
      ' * Soft-fallback `?category=` is normalised at the page layer',
      true,
    )
    expect(jsdoc.stripped.trim()).toBe('')
    expect(jsdoc.insideBlock).toBe(true) // still inside, no */ on this line
    // Multi-line JSDoc closing `*/` flips state back to outside.
    const closer = stripCommentsStateful('   */', true)
    expect(closer.insideBlock).toBe(false)
  })
})

// ── Test 2 — ?category= → ?tag= redirect contract ────────────────────────────

// `vi.hoisted` evaluates BEFORE module imports, so the mock factories
// below close over the same instances we assert against in tests. Using
// the function directly as the mocked module's `default` export means
// the JSX `<EventsPageClient />` element's `.type` is exactly
// `eventsClientMock` — we walk the returned element tree to find it.
const { redirectMock, eventsClientMock } = vi.hoisted(() => ({
  redirectMock: vi.fn((url: string) => {
    // Mimic Next.js redirect(): throws an internal NEXT_REDIRECT error
    // that the framework intercepts. Tests assert on the .toThrow side.
    const err = new Error('NEXT_REDIRECT')
    ;(err as unknown as { digest: string }).digest = `NEXT_REDIRECT;${url}`
    throw err
  }),
  eventsClientMock: vi.fn(() => null),
}))

vi.mock('next/navigation', () => ({
  redirect: redirectMock,
}))

vi.mock('@/components/events/EventsPageClient', () => ({
  default: eventsClientMock,
}))

vi.mock('@/lib/supabase/queries/events', () => ({
  getPublishedEvents: vi.fn(() => Promise.resolve([])),
}))

// Import AFTER the mocks so the page picks them up.
import EventsPage from '@/app/events/page'

interface MaybeReactElement {
  type?: unknown
  props?: Record<string, unknown> & { children?: unknown }
}

/**
 * Walk a React element tree (returned by a Server Component called as a
 * plain async function — not rendered) to find the first child whose
 * `type` === `targetType`. Returns the element so the caller can read
 * its props. Returns null if not found.
 *
 * Why this and not @testing-library/react render(): the page's child
 * tree includes Next.js-context-dependent components (Link, etc.) that
 * RTL would need to mock too. Tree-walking just reads the JSX without
 * executing it.
 */
function findElement(
  node: unknown,
  targetType: unknown,
): MaybeReactElement | null {
  if (!node || typeof node !== 'object') return null
  const el = node as MaybeReactElement
  if (el.type === targetType) return el
  const children = el.props?.children
  if (children == null) return null
  const list = Array.isArray(children) ? children : [children]
  for (const c of list) {
    const found = findElement(c, targetType)
    if (found) return found
  }
  return null
}

describe('F1a — /events page server-side fallbacks', () => {
  beforeEach(() => {
    redirectMock.mockClear()
    eventsClientMock.mockClear()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  // Each test has shape: input -> { redirect | initialTag } expectation.
  // For redirect cases we expect EventsPage to throw NEXT_REDIRECT and
  // for the redirect mock to be called with the canonical /events?tag=... URL.
  // For passthrough cases we expect no redirect and the rendered child
  // EventsPageClient to receive the right initialTag.

  it('?category=drinks redirects to ?tag=drinks-bars (canonical primary slug)', async () => {
    await expect(
      EventsPage({ searchParams: Promise.resolve({ category: 'drinks' }) }),
    ).rejects.toThrow('NEXT_REDIRECT')
    expect(redirectMock).toHaveBeenCalledWith('/events?tag=drinks-bars')
    expect(eventsClientMock).not.toHaveBeenCalled()
  })

  it('?category=cultural redirects to ?tag=galleries-museums (lossy 4→1 collapse)', async () => {
    // `cultural` is the most lossy enum: theatre-comedy / galleries-museums /
    // festivals-seasonal / charity-volunteering all map to it. Migration 2
    // Step 2 picks galleries-museums as the canonical fallback; if the
    // mapping helper drifts, this test catches it.
    await expect(
      EventsPage({ searchParams: Promise.resolve({ category: 'cultural' }) }),
    ).rejects.toThrow('NEXT_REDIRECT')
    expect(redirectMock).toHaveBeenCalledWith('/events?tag=galleries-museums')
  })

  it('?category=networking redirects to ?tag=workshops-masterclasses (demoted enum)', async () => {
    // networking was demoted to interest-only — no primary tag exists for
    // it. Migration 2 Step 2 routes orphaned networking events to
    // workshops-masterclasses (closest event home). If a future PR adds
    // a `networking-events` primary slug and forgets to flip the
    // soft-fallback target, this test surfaces it.
    await expect(
      EventsPage({ searchParams: Promise.resolve({ category: 'networking' }) }),
    ).rejects.toThrow('NEXT_REDIRECT')
    expect(redirectMock).toHaveBeenCalledWith(
      '/events?tag=workshops-masterclasses',
    )
  })

  it('?category=bogus does not redirect or 404 — falls through to All', async () => {
    // Unknown enum values (typo, future-removed value, malicious input)
    // must not throw or 404. The page renders normally with no filter.
    const result = await EventsPage({
      searchParams: Promise.resolve({ category: 'bogus' as string }),
    })
    expect(redirectMock).not.toHaveBeenCalled()
    const clientEl = findElement(result, eventsClientMock)
    expect(clientEl, 'EventsPageClient must be rendered in the page tree').not.toBeNull()
    expect(clientEl!.props!.initialTag).toBeNull()
  })

  it('?category= present alongside ?tag= — ?tag= wins, no redirect', async () => {
    // If a request mixes both params (e.g. an in-flight migration of an
    // older shared link), prefer the new ?tag= and silently drop the
    // legacy param. No redirect — the URL is already on the new shape.
    const result = await EventsPage({
      searchParams: Promise.resolve({
        category: 'drinks',
        tag: 'theatre-comedy',
      }),
    })
    expect(redirectMock).not.toHaveBeenCalled()
    const clientEl = findElement(result, eventsClientMock)
    expect(clientEl).not.toBeNull()
    expect(clientEl!.props!.initialTag).toBe('theatre-comedy')
  })
})

// ── Test 3 — ?tag= validation against PRIMARY_ELIGIBLE_TAG_SLUGS ───────────

describe('F1a — /events page ?tag= validation', () => {
  beforeEach(() => {
    redirectMock.mockClear()
    eventsClientMock.mockClear()
  })

  it('?tag=evil-tag (unknown slug) falls through to initialTag=null, no redirect', async () => {
    // A bogus tag should NOT render an empty list with a styled "selected"
    // chip — the chip bar would show "evil-tag" doesn't exist while still
    // showing the chip as active. Page-level validation rejects unknown
    // slugs cleanly so the UI defaults to "All".
    const result = await EventsPage({
      searchParams: Promise.resolve({ tag: 'evil-tag' }),
    })
    expect(redirectMock).not.toHaveBeenCalled()
    const clientEl = findElement(result, eventsClientMock)
    expect(clientEl).not.toBeNull()
    expect(clientEl!.props!.initialTag).toBeNull()
  })

  it('?tag=drinks-bars (known primary slug) hydrates initialTag', async () => {
    const result = await EventsPage({
      searchParams: Promise.resolve({ tag: 'drinks-bars' }),
    })
    expect(redirectMock).not.toHaveBeenCalled()
    const clientEl = findElement(result, eventsClientMock)
    expect(clientEl).not.toBeNull()
    expect(clientEl!.props!.initialTag).toBe('drinks-bars')
  })

  it('?tag=interest-technology (interest-only slug, not primary-eligible) falls through to null', async () => {
    // The 8 interest-only slugs (interest-…) exist in the tags table but
    // are NOT primary-eligible. They must not be accepted as a tag filter
    // — events do not carry interest-only slugs as their primary tag.
    const result = await EventsPage({
      searchParams: Promise.resolve({ tag: 'interest-technology' }),
    })
    expect(redirectMock).not.toHaveBeenCalled()
    const clientEl = findElement(result, eventsClientMock)
    expect(clientEl).not.toBeNull()
    expect(clientEl!.props!.initialTag).toBeNull()
  })
})

// ── Test 4 — long-label layout regression (chip whitespace-nowrap) ─────────

describe('F1a — chip-bar long-label layout', () => {
  it('EventsPageClient sets whitespace-nowrap on the tag chips', () => {
    // The 15 primary-eligible labels include "Activities & Social Games"
    // (24 chars) and "Workshops & Masterclasses" (25 chars). Without
    // whitespace-nowrap on the chip <button>, these labels wrap onto two
    // lines and the chip-bar grid breaks (chip rows misalign, scroll
    // gutter overlaps the price filter on mobile). The Tailwind class
    // must remain on the per-chip className.
    const src = readFileSync(
      resolve(REPO_ROOT, 'src/components/events/EventsPageClient.tsx'),
      'utf-8',
    )
    expect(src).toMatch(/whitespace-nowrap/)
  })

  it('PRIMARY_TAG_LABELS contains the 15 primary-eligible tags in canonical order', async () => {
    // Sanity: if a future PR drops a primary slug from PRIMARY_TAG_LABELS
    // (the chip-bar order list) or reorders it inconsistently with the
    // migration's seed, the chip bar silently loses a filter option.
    const { PRIMARY_TAG_LABELS, PRIMARY_ELIGIBLE_TAG_SLUGS } = await import(
      '@/lib/constants/tags'
    )
    expect(PRIMARY_TAG_LABELS).toHaveLength(15)
    for (const { slug } of PRIMARY_TAG_LABELS) {
      expect(
        PRIMARY_ELIGIBLE_TAG_SLUGS.has(slug),
        `PRIMARY_TAG_LABELS contains slug "${slug}" which is not in PRIMARY_ELIGIBLE_TAG_SLUGS — chip bar drift.`,
      ).toBe(true)
    }
    // The two longest labels are the layout-stress labels.
    const labels = PRIMARY_TAG_LABELS.map((t) => t.label)
    expect(labels).toContain('Activities & Social Games')
    expect(labels).toContain('Workshops & Masterclasses')
  })
})

// ── Test 5 — getRelatedEvents signature lock-in (F1b-app) ────────────────────

describe('F1b-app — getRelatedEvents primary-tag JOIN', () => {
  // F1b-app changed getRelatedEvents from
  //   (category: EventCategory, excludeId: string)  →  filter on events.category
  // to
  //   (primaryTagSlug: string,  excludeId: string)  →  filter on event_tags.tags.slug
  //
  // The widened SCAN_DIRS above already prevents *new* event.category reads
  // from sneaking back into the query layer, but a malicious or careless PR
  // could still revert the JOIN itself — same function name, same returned
  // shape, but suddenly filtering on the legacy column again. Source-grep
  // assertions lock the function-source signature so that kind of revert
  // surfaces here, with a named diagnostic, rather than as a UX regression
  // (Theatre & Comedy events showing Galleries & Museums peers again).

  const eventsQuerySrc = readFileSync(
    resolve(REPO_ROOT, 'src/lib/supabase/queries/events.ts'),
    'utf-8',
  )

  it('signature param is `primaryTagSlug` (not the legacy `category: EventCategory`)', () => {
    // The function-declaration regex tolerates whitespace + arg formatting
    // changes. What matters is that the FIRST parameter name reads
    // `primaryTagSlug` — the rename is the public contract change.
    const match = eventsQuerySrc.match(
      /export\s+async\s+function\s+getRelatedEvents\s*\(\s*(\w+)\s*:/,
    )
    expect(
      match,
      'Could not locate `export async function getRelatedEvents(<arg>:` in events.ts — the function may have been renamed or deleted.',
    ).not.toBeNull()
    expect(match![1]).toBe('primaryTagSlug')
    // And paired safety: the legacy first-arg name must not have come back.
    expect(match![1]).not.toBe('category')
  })

  it("filters by event_tags.tags.slug (not events.category) in the query chain", () => {
    // Locate the function body — from `function getRelatedEvents` to the
    // next `// ──` section divider — and assert the F1b filter chain is
    // present and the legacy chain is absent.
    const start = eventsQuerySrc.indexOf('export async function getRelatedEvents')
    expect(start, 'getRelatedEvents not found in events.ts').toBeGreaterThan(-1)
    const rest = eventsQuerySrc.slice(start)
    const end = rest.indexOf('// ──', 1) // next section header below the function
    const body = end > 0 ? rest.slice(0, end) : rest

    // F1b-app filter — event_tags + tags JOIN, keyed by primary tag slug.
    expect(
      body,
      "getRelatedEvents body should filter via .eq('event_tags.tags.slug', primaryTagSlug)",
    ).toContain("'event_tags.tags.slug'")
    expect(
      body,
      "getRelatedEvents body should still require event_tags.is_primary = true",
    ).toContain("'event_tags.is_primary'")

    // The legacy filter — direct `.eq('category', …)` — must not return.
    // Anchored regex so we don't false-positive on the JSDoc reference to
    // "events.category" higher up (which is in a doc comment, but we
    // sliced the body window to avoid that anyway).
    expect(
      body,
      "getRelatedEvents body should NOT filter by the legacy events.category column anymore",
    ).not.toMatch(/\.eq\(\s*['"]category['"]/)
  })
})

// ── Test 6 — F1b-schema migration source-text shape (lockstep) ─────────────

describe('F1b-schema — drop migration source-text shape', () => {
  // The F1b-schema migration is a DESTRUCTIVE one-shot drop: column,
  // enum, two triggers, two trigger fns, one helper. Its safety net is
  // the defensive RAISE EXCEPTION block at the end. A future PR that
  // weakens any of those statements (removes an IF EXISTS, drops the
  // verification block, forgets to drop one of the artefacts) would
  // silently leave dead schema behind on hosted — which Postgres would
  // happily ignore until something tries to use it.
  //
  // These source-text assertions lock in the migration's SHAPE so that
  // kind of weakening surfaces here, with a named diagnostic, rather
  // than as a half-applied schema on production. Pattern mirrors the
  // W2+W3 migration-2 lockstep test.

  const MIGRATION_PATH = resolve(
    REPO_ROOT,
    'supabase/migrations/20260506000001_drop_events_category_and_triggers.sql',
  )
  const MIGRATION_SQL = readFileSync(MIGRATION_PATH, 'utf-8')

  // The 5 DROP statements + their target object names. Each pattern is
  // case-insensitive on the SQL keywords (DROP / TRIGGER / FUNCTION etc.)
  // and tolerates whitespace / newlines, but locks the IF EXISTS clause
  // and the fully-qualified object name down.
  const DROP_STATEMENTS: ReadonlyArray<readonly [string, RegExp]> = [
    [
      'DROP TRIGGER trg_sync_primary_tag_from_category ON public.events',
      /DROP\s+TRIGGER\s+IF\s+EXISTS\s+trg_sync_primary_tag_from_category\s+ON\s+public\.events/i,
    ],
    [
      'DROP TRIGGER trg_sync_category_from_primary_tag ON public.event_tags',
      /DROP\s+TRIGGER\s+IF\s+EXISTS\s+trg_sync_category_from_primary_tag\s+ON\s+public\.event_tags/i,
    ],
    [
      'DROP FUNCTION _sync_primary_tag_from_category()',
      /DROP\s+FUNCTION\s+IF\s+EXISTS\s+public\._sync_primary_tag_from_category\s*\(\s*\)/i,
    ],
    [
      'DROP FUNCTION _sync_category_from_primary_tag()',
      /DROP\s+FUNCTION\s+IF\s+EXISTS\s+public\._sync_category_from_primary_tag\s*\(\s*\)/i,
    ],
    [
      'DROP FUNCTION _tag_slug_to_legacy_category(text)',
      /DROP\s+FUNCTION\s+IF\s+EXISTS\s+public\._tag_slug_to_legacy_category\s*\(\s*text\s*\)/i,
    ],
    [
      'DROP INDEX idx_events_category',
      // Required before DROP COLUMN — the index from migration 003 depends
      // on `events.category`. Postgres rejects DROP COLUMN with SQLSTATE
      // 2BP01 if the index isn't dropped first. Discovered when CI Path B
      // hit this on the first F1b-schema apply attempt.
      /DROP\s+INDEX\s+IF\s+EXISTS\s+public\.idx_events_category/i,
    ],
    [
      'ALTER TABLE events DROP COLUMN category',
      /ALTER\s+TABLE\s+public\.events\s+DROP\s+COLUMN\s+IF\s+EXISTS\s+category/i,
    ],
    [
      'DROP TYPE event_category',
      /DROP\s+TYPE\s+IF\s+EXISTS\s+public\.event_category/i,
    ],
  ]

  for (const [label, re] of DROP_STATEMENTS) {
    it(`migration contains ${label} (with IF EXISTS for idempotency)`, () => {
      expect(
        MIGRATION_SQL,
        `Missing or weakened DROP statement — expected /${re.source}/`,
      ).toMatch(re)
    })
  }

  it('migration has a defensive DO $$ … END $$; verification block at the end', () => {
    // The block re-checks information_schema / pg_type / pg_trigger /
    // pg_proc and RAISE EXCEPTIONs if any of the four artefacts (column,
    // type, two triggers) survive. Weakening this turns a half-applied
    // schema into a silent success.
    expect(MIGRATION_SQL).toMatch(/DO\s+\$\$\s*BEGIN[\s\S]+END\s+\$\$;/)
    expect(MIGRATION_SQL).toMatch(/RAISE\s+EXCEPTION/i)
  })

  it('verification block names all 4 artefact-survival checks', () => {
    // Each of these strings must appear inside the verification block —
    // they're the explicit catalog probes for the four artefacts. If a
    // future "cleanup" deletes one of the IF EXISTS branches, this fails.
    expect(MIGRATION_SQL).toMatch(/events\.category column still exists/i)
    expect(MIGRATION_SQL).toMatch(/event_category type still exists/i)
    expect(MIGRATION_SQL).toMatch(/trg_sync_primary_tag_from_category/i)
    expect(MIGRATION_SQL).toMatch(/trg_sync_category_from_primary_tag/i)
  })

  it('migration uses IF EXISTS uniformly (sanity — no DROP without the guard)', () => {
    // Iterate every line that BEGINS with `DROP <KEYWORD>` (after any
    // leading whitespace) and assert the rest of the statement contains
    // IF EXISTS. Anchoring to start-of-line skips the "DROP COLUMN" /
    // "DROP TYPE" wording inside RAISE EXCEPTION string literals
    // (those mentions are mid-line, indented inside a SQL string).
    const lines = MIGRATION_SQL.split('\n')
    const ddlStarter =
      /^\s*DROP\s+(TRIGGER|FUNCTION|TABLE|TYPE|INDEX|VIEW|POLICY|SCHEMA)\b/i
    let saw = 0
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (!ddlStarter.test(line)) continue
      // Capture the statement (this line + continuations until the
      // closing semicolon) so we can scan it for IF EXISTS even if the
      // statement spans lines.
      let stmt = line
      let j = i
      while (!stmt.includes(';') && j + 1 < lines.length) {
        j += 1
        stmt += '\n' + lines[j]
      }
      saw++
      expect(
        stmt,
        `DDL DROP without IF EXISTS guard at line ${i + 1} — got: ${stmt.slice(0, 100)}`,
      ).toMatch(/IF\s+EXISTS/i)
    }
    // Sanity: we expect at least 6 line-anchored DDL DROPs. Real F1b-
    // schema migration has 2 triggers + 2 trigger fns + 1 helper fn +
    // 1 index + 1 type = 7. (The column drop is `ALTER TABLE … DROP
    // COLUMN`, not a top-level DROP, so it doesn't match this regex —
    // it has its own dedicated test above.)
    expect(saw).toBeGreaterThanOrEqual(6)
  })
})
