#!/usr/bin/env node
/**
 * One-off verification for F2-schema hosted apply.
 *
 * Confirms that Migration 20260507000001 dropped:
 *   - the `user_interests.interest` text column
 *   - the legacy `uq_user_interests_user_interest` unique constraint
 *
 * AND that the F2-app read paths (getProfile-style SELECT, the
 * tags JOIN populating user_interests rows) still work post-drop.
 *
 * ── Coverage caveat (same constraint as F1b-schema's verify) ────────────
 * The catalog tables (information_schema.columns, pg_constraint) are NOT
 * exposed via PostgREST without a custom SECURITY DEFINER helper. The
 * two catalog-level checks below MUST be verified manually in the
 * Supabase SQL editor — copy-paste the block under "MANUAL CATALOG
 * CHECKS" into the SQL editor and confirm each query returns zero rows.
 *
 * The script automates two PostgREST-reachable checks:
 *   1. `SELECT id, interest FROM user_interests LIMIT 1` — must FAIL
 *      with a "column does not exist" error. This is the cleanest
 *      behavioural proof that the column dropped.
 *   2. The F2-app read path (`SELECT id, user_id, tag_id, created_at,
 *      tags(slug, label) FROM user_interests` shape) must succeed and
 *      return rows where the joined `tags.label` is non-empty. This
 *      proves the new read path is healthy post-drop.
 *
 * Run after `supabase db push` of migration 20260507000001 has
 * succeeded. Reads from process.env:
 *   - NEXT_PUBLIC_SUPABASE_URL
 *   - NEXT_PUBLIC_SUPABASE_ANON_KEY
 *   - SUPABASE_SERVICE_ROLE_KEY (optional, for read of user_interests
 *      rows — the table's RLS policy limits SELECT to the owning user
 *      or admins; without a service-role key the second check resolves
 *      to "RLS-protected, cannot verify behaviour" and is reported as
 *      a soft pass with a note).
 *
 * Usage:
 *   node --env-file=.env.local scripts/verify-f2-schema-hosted.mjs
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
 *   -- 1. user_interests.interest column gone
 *   SELECT column_name FROM information_schema.columns
 *    WHERE table_schema = 'public'
 *      AND table_name = 'user_interests'
 *      AND column_name = 'interest';
 *
 *   -- 2. uq_user_interests_user_interest constraint gone
 *   SELECT conname FROM pg_constraint
 *    WHERE conname = 'uq_user_interests_user_interest'
 *      AND conrelid = 'public.user_interests'::regclass;
 *
 *   -- 3. (sanity) the replacement constraint is still present
 *   SELECT conname FROM pg_constraint
 *    WHERE conname = 'uq_user_interests_user_tag'
 *      AND conrelid = 'public.user_interests'::regclass;
 */
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !anonKey) {
  console.error(
    'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY',
  )
  process.exit(1)
}

const anon = createClient(url, anonKey, {
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

// ── Check 1 — selecting `interest` from user_interests fails (column gone) ─
//
// The cleanest behavioural proof that the column dropped: PostgREST will
// 4xx with a "column user_interests.interest does not exist" error if
// we try to SELECT it. RLS is irrelevant — the column-existence check
// happens before the row filter.
{
  const { data, error } = await anon
    .from('user_interests')
    .select('id, interest')
    .limit(1)

  if (error) {
    const msg = error.message ?? ''
    const looksLikeColumnGone =
      /column.*interest.*does not exist/i.test(msg) ||
      /column user_interests\.interest does not exist/i.test(msg)
    check(
      'user_interests.interest column dropped (SELECT raises column-does-not-exist)',
      looksLikeColumnGone,
      msg,
    )
  } else {
    check(
      'user_interests.interest column dropped (SELECT raises column-does-not-exist)',
      false,
      `SELECT id, interest returned ${data?.length ?? 0} rows — column may still exist`,
    )
  }
}

// ── Check 2 — F2-app read path still works (tags JOIN populates label) ────
//
// Mirrors getProfile's SELECT shape. Needs service-role to bypass RLS
// (anon can't SELECT another user's rows; the seed users aren't logged
// in here). If SUPABASE_SERVICE_ROLE_KEY isn't set, this is a soft-pass
// with a note — the catalog checks above already prove the column is
// gone, so this check is mostly defence-in-depth against breaking the
// JOIN itself.
if (!serviceKey) {
  console.log(
    '\x1b[33m·\x1b[0m F2-app read path JOIN (tags.label populated) — skipped (no SUPABASE_SERVICE_ROLE_KEY in env; check 1 already proves the column drop)',
  )
} else {
  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data, error } = await admin
    .from('user_interests')
    .select('id, user_id, tag_id, created_at, tags(slug, label)')
    .limit(5)

  if (error) {
    check('F2-app read path JOIN works (tags.label populated)', false, error.message)
  } else if (!data || data.length === 0) {
    check(
      'F2-app read path JOIN works (tags.label populated)',
      false,
      'no rows returned — seed data may be missing',
    )
  } else {
    const allOk = data.every((row) => {
      const tag = Array.isArray(row.tags) ? row.tags[0] : row.tags
      return Boolean(tag?.slug && tag?.label && row.tag_id)
    })
    check(
      'F2-app read path JOIN works (tags.label populated)',
      allOk,
      `received ${data.length} rows; sample tag = { slug: ${
        Array.isArray(data[0].tags) ? data[0].tags[0]?.slug : data[0].tags?.slug
      }, label: ${
        Array.isArray(data[0].tags) ? data[0].tags[0]?.label : data[0].tags?.label
      } }`,
    )
  }
}

console.log(
  `\n${passed} passed, ${failed} failed.\n` +
    'Manual catalog checks (3 queries) still required — see header comment.',
)
process.exit(failed > 0 ? 1 : 0)
