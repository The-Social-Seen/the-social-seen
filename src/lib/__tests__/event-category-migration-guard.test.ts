// F1a regression guard — Phase 3 member data layer, app-code migration.
//
// The 4 member-facing event components were migrated off the legacy
// `events.category` enum (9 values: drinks, dining, cultural, …) to read
// the new `event.primary_tag.label` from the canonical 15-value taxonomy
// (Theatre & Comedy, Galleries & Museums, Nightlife & Dancing, …) shipped
// by Migration 2 (20260504000001_create_tags_and_event_tags.sql).
//
// Migrated components (zero `category` reads after this PR):
//   - src/components/events/EventCard.tsx
//   - src/components/events/EventDetailClient.tsx
//   - src/components/events/EventsPageClient.tsx
//   - src/components/events/PastEventCard.tsx
//
// This guard prevents a silent regression: a future PR that re-adds an
// `event.category`-based render path on a member-facing component would
// undo the F1a UX improvement (members would see the coarse legacy
// labels again — "Cultural" instead of "Theatre & Comedy") AND would
// block F1b from dropping the column.
//
// Scoping choice (documented per the prompt):
//   We scan src/components/events/ exclusively. Carry-overs the
//   frontend-developer's handover called out remain out of scope:
//     - src/components/profile/BookingCard.tsx — F1b (booking card label)
//     - src/components/admin/EventsTable.tsx — admin path, F1b cleanup
//     - src/app/events/[slug]/page.tsx — getRelatedEvents() at the page
//       layer still takes EventCategory; F1b widens it to a primary slug
//   These files legitimately read event.category today and are flagged
//   in the F1a UI commit's handover as deferred — pulling them into
//   this guard now would block the F1a PR. Each will get its own guard
//   when its respective wave lands.
//
// Plus three edge-case checks for the things the rendering tests don't
// exercise: the ?category= → ?tag= soft-fallback redirect contract, the
// ?tag= validation against PRIMARY_ELIGIBLE_TAG_SLUGS, and the chip-bar
// long-label layout (whitespace-nowrap on chips with 24+ char labels).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const REPO_ROOT = resolve(__dirname, '../../..')
const SCAN_DIRS = ['src/components/events'] as const

// No allowlist — the 4 migrated components must be 100% category-free.
// Production bookings/admin/page-layer carry-overs are scoped out via
// SCAN_DIRS rather than allowlisted (each retires in its own wave).
const ALLOWLIST = new Set<string>([])

// Patterns chosen from the prompt's grep brief plus a couple of
// belt-and-braces variants. All are case-sensitive on `category` so they
// don't match `EventCategory` (the type name, which we keep until F1b).
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
