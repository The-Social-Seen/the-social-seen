/**
 * Drift guard — asserts that the PROFILE_FIELD_WEIGHTS and
 * PROFILE_FIELD_LABELS constants in the Node library match the ones
 * embedded in the Deno edge function.
 *
 * Why not import the Deno file directly: it uses Deno-only APIs
 * (`Deno.serve`, `node:crypto` via Deno's compat) and remote ESM
 * imports via `esm.sh` — vitest under Node can't resolve those. The
 * compromise is textual parsing: pull the literal object expressions
 * out of both files and compare their shapes.
 *
 * If this test fails after a weights update, bump the matching block
 * in the OTHER file. Both sides must agree or the profile-completion
 * banner and the nudge-email percentage will disagree for real users.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  PROFILE_FIELD_WEIGHTS,
  PROFILE_FIELD_LABELS,
} from '@/lib/utils/profile-completion'

function extractObjectLiteral(
  source: string,
  varName: string,
): Record<string, string | number> {
  // Find `<varName> = { ... }` capturing up to the matching closing
  // brace. Deliberately naive — our two files are simple and don't
  // nest braces inside the weight/label objects.
  const re = new RegExp(
    `${varName}[^=]*=\\s*\\{([\\s\\S]*?)\\}\\s*(?:as\\s+const)?\\s*`,
  )
  const match = source.match(re)
  if (!match) {
    throw new Error(`Could not find ${varName} literal in source`)
  }
  const body = match[1]
  const result: Record<string, string | number> = {}
  // Match `key: <number>` OR `key: '<string>'` / `key: "<string>"`.
  const entryRe =
    /\s*([a-zA-Z_][a-zA-Z_0-9]*)\s*:\s*(?:(\d+)|['"]([^'"]*)['"])\s*,?/g
  let m
  while ((m = entryRe.exec(body)) !== null) {
    const [, key, numeric, str] = m
    result[key] = numeric !== undefined ? Number(numeric) : str
  }
  return result
}

describe('profile-completion weights/labels — Node + Deno parity', () => {
  it('WEIGHTS in Deno edge function match the Node source', () => {
    const denoSource = readFileSync(
      resolve(
        process.cwd(),
        'supabase/functions/daily-notifications/index.ts',
      ),
      'utf-8',
    )
    const denoWeights = extractObjectLiteral(
      denoSource,
      'PROFILE_FIELD_WEIGHTS',
    )
    // Numeric cast — both are integer weight values.
    const nodeWeights = Object.fromEntries(
      Object.entries(PROFILE_FIELD_WEIGHTS),
    )
    // Cardinality sanity — guards against the regex parsing zero
    // entries on both sides and comparing-equal-empty.
    expect(Object.keys(denoWeights).length).toBeGreaterThanOrEqual(5)
    expect(denoWeights).toEqual(nodeWeights)
  })

  it('LABELS in Deno edge function match the Node source', () => {
    const denoSource = readFileSync(
      resolve(
        process.cwd(),
        'supabase/functions/daily-notifications/index.ts',
      ),
      'utf-8',
    )
    const denoLabels = extractObjectLiteral(
      denoSource,
      'PROFILE_FIELD_LABELS',
    )
    expect(Object.keys(denoLabels).length).toBeGreaterThanOrEqual(5)
    expect(denoLabels).toEqual(PROFILE_FIELD_LABELS)
  })
})
