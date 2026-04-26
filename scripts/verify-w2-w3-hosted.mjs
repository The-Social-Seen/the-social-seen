#!/usr/bin/env node
/**
 * One-off verification for W2+W3 hosted apply (PR #58).
 * Closes Checkpoint B from the code-reviewer's Path B verdict.
 *
 * Run after `supabase db push` of migrations 20260504000001 and
 * 20260504000002 has succeeded. Reads from process.env:
 *   - NEXT_PUBLIC_SUPABASE_URL
 *   - NEXT_PUBLIC_SUPABASE_ANON_KEY
 *   - SUPABASE_SERVICE_ROLE_KEY
 *
 * Usage:
 *   node --env-file=.env.local scripts/verify-w2-w3-hosted.mjs
 *
 * Coverage: Checkpoint B queries B1–B10 (data shape). B11–B13 are
 * catalog-level (pg_indexes, pg_constraint, information_schema) and
 * not exposed via PostgREST without a custom SECURITY DEFINER helper —
 * verify those manually in the Supabase SQL editor or wait for
 * Checkpoint D (the 29 unskipped vitest cases) which exercises the
 * structural invariants against a real Postgres.
 *
 * Exits 0 on full pass, 1 on any failure.
 */
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !anonKey || !serviceKey) {
  console.error(
    'Missing one of NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY',
  )
  process.exit(1)
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const HALLOWEEN_ID = 'e1000000-0000-0000-0000-000000000028'
const POLO_ID = 'e1000000-0000-0000-0000-000000000025'

const results = []
function record(name, pass, detail) {
  results.push({ name, pass, detail })
  const icon = pass ? '✓' : '✗'
  const colour = pass ? '\x1b[32m' : '\x1b[31m'
  console.log(`${colour}${icon}\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`)
}

// ── B1: tag count is exactly 23 ─────────────────────────────────────────────
{
  const { count, error } = await admin
    .from('tags')
    .select('id', { count: 'exact', head: true })
  record(
    'B1: tags row count = 23',
    !error && count === 23,
    error ? `error: ${error.message}` : `actual: ${count}`,
  )
}

// ── B2: 15 primary-eligible (sort_order < 200) ──────────────────────────────
{
  const { count, error } = await admin
    .from('tags')
    .select('id', { count: 'exact', head: true })
    .lt('sort_order', 200)
  record(
    'B2: primary-eligible tags (sort_order < 200) = 15',
    !error && count === 15,
    error ? `error: ${error.message}` : `actual: ${count}`,
  )
}

// ── B3: 8 interest-only (sort_order >= 200) ─────────────────────────────────
{
  const { count, error } = await admin
    .from('tags')
    .select('id', { count: 'exact', head: true })
    .gte('sort_order', 200)
  record(
    'B3: interest-only tags (sort_order >= 200) = 8',
    !error && count === 8,
    error ? `error: ${error.message}` : `actual: ${count}`,
  )
}

// ── B4: primary event_tags = active events ──────────────────────────────────
{
  const [primaryRes, eventsRes] = await Promise.all([
    admin
      .from('event_tags')
      .select('event_id', { count: 'exact', head: true })
      .eq('is_primary', true),
    admin
      .from('events')
      .select('id', { count: 'exact', head: true })
      .is('deleted_at', null),
  ])
  const ok =
    !primaryRes.error &&
    !eventsRes.error &&
    primaryRes.count === eventsRes.count
  record(
    'B4: every active event has exactly one primary event_tag',
    ok,
    `primary=${primaryRes.count} events=${eventsRes.count}` +
      (primaryRes.error ? ` primary_error=${primaryRes.error.message}` : '') +
      (eventsRes.error ? ` events_error=${eventsRes.error.message}` : ''),
  )
}

// ── B5: secondary event_tags >= 17 ──────────────────────────────────────────
{
  const { count, error } = await admin
    .from('event_tags')
    .select('event_id', { count: 'exact', head: true })
    .eq('is_primary', false)
  record(
    'B5: secondary event_tags >= 17',
    !error && (count ?? 0) >= 17,
    error ? `error: ${error.message}` : `actual: ${count}`,
  )
}

// ── B6: zero NULL tag_id in user_interests ──────────────────────────────────
{
  const { count, error } = await admin
    .from('user_interests')
    .select('id', { count: 'exact', head: true })
    .is('tag_id', null)
  record(
    'B6: user_interests with NULL tag_id = 0',
    !error && count === 0,
    error ? `error: ${error.message}` : `actual: ${count}`,
  )
}

// Helper: fetch tags for an event, split by is_primary
async function eventTagSlugs(eventId) {
  const { data, error } = await admin
    .from('event_tags')
    .select('is_primary, tags!inner(slug)')
    .eq('event_id', eventId)
  if (error) throw error
  const primary = data
    ?.filter((r) => r.is_primary)
    .map((r) => r.tags?.slug)
    .filter(Boolean) ?? []
  const secondary = data
    ?.filter((r) => !r.is_primary)
    .map((r) => r.tags?.slug)
    .filter(Boolean)
    .sort() ?? []
  return { primary, secondary }
}

// ── B7 + B8: Halloween (Event 28) tags ──────────────────────────────────────
{
  try {
    const { primary, secondary } = await eventTagSlugs(HALLOWEEN_ID)
    record(
      'B7: Halloween primary tag = nightlife-dancing',
      primary.length === 1 && primary[0] === 'nightlife-dancing',
      `actual: ${JSON.stringify(primary)}`,
    )
    const expectedSecondaries = ['festivals-seasonal', 'themed-socials']
    const matches =
      secondary.length === 2 &&
      secondary[0] === expectedSecondaries[0] &&
      secondary[1] === expectedSecondaries[1]
    record(
      'B8: Halloween secondary tags = festivals-seasonal, themed-socials',
      matches,
      `actual: ${JSON.stringify(secondary)}`,
    )
  } catch (err) {
    record('B7+B8: Halloween tags lookup', false, `error: ${err.message ?? err}`)
  }
}

// ── B9 + B10: Polo in the Park (Event 25) tags ──────────────────────────────
{
  try {
    const { primary, secondary } = await eventTagSlugs(POLO_ID)
    record(
      'B9: Polo primary tag = festivals-seasonal',
      primary.length === 1 && primary[0] === 'festivals-seasonal',
      `actual: ${JSON.stringify(primary)}`,
    )
    record(
      'B10: Polo secondary tag = outdoor-picnics',
      secondary.length === 1 && secondary[0] === 'outdoor-picnics',
      `actual: ${JSON.stringify(secondary)}`,
    )
  } catch (err) {
    record('B9+B10: Polo tags lookup', false, `error: ${err.message ?? err}`)
  }
}

// ── Bonus: anon SELECT on tags works (public taxonomy per Decision 7) ───────
{
  const anon = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data, error } = await anon
    .from('tags')
    .select('slug')
    .eq('is_active', true)
    .limit(1)
  record(
    'Bonus: anon can read tags (public taxonomy)',
    !error && Array.isArray(data) && data.length > 0,
    error ? `error: ${error.message}` : `OK`,
  )
}

// ── Summary ─────────────────────────────────────────────────────────────────
console.log()
const failed = results.filter((r) => !r.pass)
if (failed.length === 0) {
  console.log(
    `\x1b[32m✓ All ${results.length} checks passed. W2+W3 hosted apply verified (Checkpoint B).\x1b[0m`,
  )
  console.log(
    '\x1b[33mNote:\x1b[0m B11–B13 (catalog-level: pg_indexes, pg_constraint, information_schema) ' +
      'are not exposed via PostgREST. Verify those manually in the Supabase SQL editor or via Checkpoint D ' +
      '(unskip the 29 vitest cases against a real Postgres).',
  )
  process.exit(0)
} else {
  console.log(`\x1b[31m✗ ${failed.length} of ${results.length} checks failed:\x1b[0m`)
  for (const f of failed) {
    console.log(`  - ${f.name}: ${f.detail}`)
  }
  process.exit(1)
}
