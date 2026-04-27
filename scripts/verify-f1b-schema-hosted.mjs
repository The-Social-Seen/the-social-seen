#!/usr/bin/env node
/**
 * One-off verification for F1b-schema hosted apply.
 *
 * Confirms that Migration 20260506000001 dropped:
 *   - the `events.category` column
 *   - the `event_category` Postgres enum type
 *   - the bidirectional sync triggers (`trg_sync_primary_tag_from_category`
 *     on events, `trg_sync_category_from_primary_tag` on event_tags)
 *   - the trigger functions (`_sync_primary_tag_from_category`,
 *     `_sync_category_from_primary_tag`)
 *   - the slug→enum helper (`_tag_slug_to_legacy_category(text)`)
 *
 * AND that the F1a primary_tag JOIN still works post-drop (i.e. no
 * regression from the trigger removal).
 *
 * ── Coverage caveat (same constraint as W2+W3 Checkpoint B) ────────────
 * The catalog tables (information_schema.columns, pg_type, pg_proc,
 * pg_trigger) are NOT exposed via PostgREST without a custom
 * SECURITY DEFINER helper. The five catalog-level checks below MUST be
 * verified manually in the Supabase SQL editor — copy-paste the block
 * under "MANUAL CATALOG CHECKS" into the SQL editor and confirm each
 * query returns zero rows.
 *
 * The script automates one PostgREST-reachable check: the F1a primary_tag
 * JOIN against a known seeded event. If the JOIN still returns the
 * expected slug + label after migration apply, the data path is healthy
 * (no regression from the trigger removal — the JOIN doesn't depend on
 * triggers anyway, but a green pass here rules out collateral damage).
 *
 * Run after `supabase db push` of migration 20260506000001 has succeeded.
 * Reads from process.env:
 *   - NEXT_PUBLIC_SUPABASE_URL
 *   - NEXT_PUBLIC_SUPABASE_ANON_KEY
 *
 * Usage:
 *   node --env-file=.env.local scripts/verify-f1b-schema-hosted.mjs
 *
 * Exits 0 on full pass, 1 on any failure.
 *
 *
 * ─────────────────────────────────────────────────────────────────────────
 * MANUAL CATALOG CHECKS — paste into Supabase SQL editor
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Each query MUST return zero rows post-apply. If any returns a row,
 * the migration didn't fully take and the embedded RAISE EXCEPTION
 * verification block in the SQL would have failed — re-check the apply
 * log.
 *
 *   -- 1. events.category column gone
 *   SELECT column_name FROM information_schema.columns
 *    WHERE table_schema = 'public'
 *      AND table_name = 'events'
 *      AND column_name = 'category';
 *
 *   -- 2. event_category enum type gone
 *   SELECT typname FROM pg_type t
 *     JOIN pg_namespace n ON n.oid = t.typnamespace
 *    WHERE n.nspname = 'public' AND t.typname = 'event_category';
 *
 *   -- 3. Triggers gone
 *   SELECT tgname FROM pg_trigger
 *    WHERE tgname IN (
 *            'trg_sync_primary_tag_from_category',
 *            'trg_sync_category_from_primary_tag'
 *          )
 *      AND NOT tgisinternal;
 *
 *   -- 4. Trigger + helper functions gone
 *   SELECT proname FROM pg_proc p
 *     JOIN pg_namespace n ON n.oid = p.pronamespace
 *    WHERE n.nspname = 'public'
 *      AND p.proname IN (
 *            '_sync_primary_tag_from_category',
 *            '_sync_category_from_primary_tag',
 *            '_tag_slug_to_legacy_category'
 *          );
 */
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  console.error(
    'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY',
  )
  process.exit(1)
}

const supabase = createClient(url, anonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

let passed = 0
let failed = 0
function check(name, ok, detail) {
  const icon = ok ? '✓' : '✗'
  const colour = ok ? '\x1b[32m' : '\x1b[31m'
  console.log(`${colour}${icon}\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`)
  if (ok) passed++
  else failed++
}

// ── Check 1 — selecting `category` from events fails (column gone) ─────────
//
// The cleanest behavioural proof that the column dropped: PostgREST will
// 4xx with a clear "column events.category does not exist" error if we
// try to SELECT it. If it succeeds, the column is still there.
{
  const { data, error } = await supabase
    .from('events')
    .select('id, category')
    .limit(1)

  if (error) {
    const msg = error.message ?? ''
    const looksLikeColumnGone =
      /column.*category.*does not exist/i.test(msg) ||
      /column events\.category does not exist/i.test(msg)
    check(
      'events.category column dropped (SELECT raises column-does-not-exist)',
      looksLikeColumnGone,
      msg,
    )
  } else {
    check(
      'events.category column dropped (SELECT raises column-does-not-exist)',
      false,
      `SELECT id, category returned ${data?.length ?? 0} rows — column may still exist`,
    )
  }
}

// ── Check 2 — F1a primary_tag JOIN still works against a known seed event ──
//
// Same target event as scripts/verify-f1a-primary-tag.mjs. If the F1b
// schema cleanup somehow broke the F1a JOIN (e.g. CASCADE took out
// event_tags grants), this fails loudly. Otherwise the JOIN proves the
// data path is healthy post-drop.
const TARGET_SLUG = 'meet-over-pizza-breadstall-feb-2025'
{
  const { data, error } = await supabase
    .from('events')
    .select('id, slug, event_tags!inner(is_primary, tags!inner(slug, label))')
    .eq('slug', TARGET_SLUG)
    .eq('event_tags.is_primary', true)
    .is('deleted_at', null)
    .single()

  if (error) {
    check(
      `F1a primary_tag JOIN still works (slug=${TARGET_SLUG})`,
      false,
      error.message,
    )
  } else if (!data) {
    check(
      `F1a primary_tag JOIN still works (slug=${TARGET_SLUG})`,
      false,
      'no row returned',
    )
  } else {
    const eventTags = Array.isArray(data.event_tags)
      ? data.event_tags
      : data.event_tags
      ? [data.event_tags]
      : []
    const tagInner = eventTags[0]?.tags
    const tag = Array.isArray(tagInner) ? tagInner[0] : tagInner
    const ok = tag?.slug === 'dining-supper-clubs' && tag?.label === 'Dining & Supper Clubs'
    check(
      `F1a primary_tag JOIN still works (slug=${TARGET_SLUG})`,
      ok,
      `primary_tag = { slug: ${tag?.slug}, label: ${tag?.label} }`,
    )
  }
}

// ── Check 3 — broader sample: 3 published events all expose primary_tag ────
//
// If the JOIN succeeds for one event but fails across the wider set
// (some events lost their primary_tag row), this would catch a partial
// CASCADE casualty.
{
  const { data, error } = await supabase
    .from('events')
    .select('id, slug, event_tags!inner(is_primary, tags!inner(slug, label))')
    .eq('event_tags.is_primary', true)
    .eq('is_published', true)
    .is('deleted_at', null)
    .limit(3)

  if (error) {
    check('Broader sample: 3 published events have primary_tag', false, error.message)
  } else {
    const allOk = (data ?? []).every((row) => {
      const eventTags = Array.isArray(row.event_tags)
        ? row.event_tags
        : row.event_tags
        ? [row.event_tags]
        : []
      const tagInner = eventTags[0]?.tags
      const tag = Array.isArray(tagInner) ? tagInner[0] : tagInner
      return Boolean(tag?.slug && tag?.label)
    })
    check(
      'Broader sample: 3 published events have primary_tag',
      allOk && (data?.length ?? 0) === 3,
      `received ${data?.length ?? 0} rows`,
    )
  }
}

console.log(
  `\n${passed} passed, ${failed} failed.\n` +
    'Manual catalog checks (4 queries) still required — see header comment.',
)
process.exit(failed > 0 ? 1 : 0)
