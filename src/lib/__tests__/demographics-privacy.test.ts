// Privacy regression guard — Phase 3 W5 demographics.
//
// `gender` and `age_range` are admin-only on the read side (Decision 7,
// Option A). The W5 frontend deliberately does NOT render either field
// anywhere on a member-facing surface. Two files are allowed to mention
// them in production code:
//
//   1. DemographicsBanner.tsx — the member-self editor where the user
//      sets/clears their own values. Always renders only the caller's
//      own values (props passed by the parent, derived from the
//      SECURITY DEFINER `get_my_demographics()` RPC).
//   2. ProfilePageClient.tsx — the props-passthrough wrapper that
//      receives `demographics` from the server component and routes it
//      to the banner. Conditionally renders the banner; never renders
//      the values themselves.
//
// Any NEW reference to `gender` or `age_range` in `src/components/profile/`
// or `src/components/events/` is a likely silent-leak regression — for
// example, adding `profile.gender` to ProfileHeader, an event-attendee
// pill, a public member card. This test fails loudly with a clear
// error message naming the offending file so the regression is caught
// before review.
//
// If a future PR genuinely needs to render demographics on a new
// admin-only surface (e.g. an admin demographics dashboard), update the
// allowlist explicitly — that's the audit checkpoint.

import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const REPO_ROOT = resolve(__dirname, '../../..')
const SCAN_DIRS = [
  'src/components/profile',
  'src/components/events',
] as const

// Files that are EXPLICITLY ALLOWED to reference the protected fields
// because rendering them is the whole point. Updating this list is the
// audit checkpoint.
const ALLOWLIST = new Set<string>([
  'src/components/profile/DemographicsBanner.tsx',
  'src/components/profile/ProfilePageClient.tsx',
])

// Word-boundary patterns. We deliberately avoid matching:
//   - `genderless` / `agenda` / `mortgage_range` etc.
// and case-insensitively because some props might be camelCased
// (e.g. `ageRange`); the production rule is that NEITHER the snake_case
// nor the camelCase form should appear in member-facing components.
const PROTECTED_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bgender\b/i, 'gender'],
  [/\bage_range\b/i, 'age_range'],
  [/\bageRange\b/, 'ageRange (camelCase form of age_range)'],
]

function walk(dir: string): string[] {
  const out: string[] = []
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out // dir doesn't exist — nothing to scan
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
      // Skip __tests__ directories — test files reference the protected
      // fields by design (they verify the components that use them).
      // Production-code-only scan keeps the guard focused.
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
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        for (const [re, label] of PROTECTED_PATTERNS) {
          if (re.test(line)) {
            hits.push({
              file: rel,
              pattern: label,
              line: i + 1,
              excerpt: line.trim().slice(0, 200),
            })
            break // one hit per line is enough
          }
        }
      }
    }
  }
  return hits
}

describe('demographics privacy regression guard', () => {
  it('every reference to gender / age_range in scanned dirs lives in an allowlisted file', () => {
    const hits = scan()
    const offenders = hits.filter((h) => !ALLOWLIST.has(h.file))

    if (offenders.length > 0) {
      // Build a clear failure message. The expect call below is what
      // actually fails the test; the throw delivers the diff.
      const grouped = new Map<string, Hit[]>()
      for (const h of offenders) {
        const list = grouped.get(h.file) ?? []
        list.push(h)
        grouped.set(h.file, list)
      }

      const lines: string[] = []
      lines.push(
        'PRIVACY REGRESSION — `gender` / `age_range` referenced outside the W5 allowlist.',
      )
      lines.push('')
      lines.push(
        'These two fields are admin-only on the read side (Decision 7, Option A).',
      )
      lines.push(
        'Member-facing components MUST NOT render them. If you genuinely need to',
      )
      lines.push(
        'expose them on a new admin-only surface, add the file to the ALLOWLIST',
      )
      lines.push(
        'in src/lib/__tests__/demographics-privacy.test.ts and document why.',
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
        `Currently allowlisted: ${[...ALLOWLIST].sort().join(', ')}`,
      )
      // Throw with the full diagnostic; expect below also fails so the
      // test runner highlights this as a hard failure.
      throw new Error(lines.join('\n'))
    }

    expect(offenders).toEqual([])
  })

  it('the allowlisted files actually exist and contain at least one protected reference (sanity)', () => {
    // If someone deletes DemographicsBanner.tsx but leaves it in the
    // allowlist, the allowlist becomes stale and this guard becomes
    // weaker. Catch the stale entry now.
    for (const allowed of ALLOWLIST) {
      const full = resolve(REPO_ROOT, allowed)
      const content = readFileSync(full, 'utf-8')
      const matched = PROTECTED_PATTERNS.some(([re]) => re.test(content))
      expect(
        matched,
        `Allowlisted file ${allowed} no longer references gender/age_range — remove it from the allowlist.`,
      ).toBe(true)
    }
  })

  it('the scan actually finds the expected hits in the allowlisted files (catches regex breakage)', () => {
    const hits = scan()
    const allowedHits = hits.filter((h) => ALLOWLIST.has(h.file))
    // We expect MANY hits across DemographicsBanner + ProfilePageClient
    // (props, state, JSX). A regex change that silently broke matching
    // would leave allowedHits at 0 and the test above would falsely
    // pass — this guard prevents that.
    expect(allowedHits.length).toBeGreaterThan(5)
  })
})
