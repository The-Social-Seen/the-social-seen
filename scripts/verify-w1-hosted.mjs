#!/usr/bin/env node
/**
 * One-off verification for W1 hosted apply (PR #56).
 * Closes Conditional Checkpoint #2 from the code-reviewer's verdict.
 *
 * Run after `supabase db push` of migrations 20260503000001 and
 * 20260503000002 has succeeded. Reads from process.env:
 *   - NEXT_PUBLIC_SUPABASE_URL
 *   - NEXT_PUBLIC_SUPABASE_ANON_KEY (uses *publishable*-style anon key for the anon-client checks)
 *   - SUPABASE_SERVICE_ROLE_KEY  (used to introspect pg_catalog as admin)
 *
 * Usage:
 *   node --env-file=.env.local scripts/verify-w1-hosted.mjs
 *
 * Prints a green/red checklist and exits 0 on full pass, 1 on any failure.
 *
 * NOT a permanent test — this is the empirical close-out for the
 * Docker-less W1 review. After Docker is available the unit tests
 * marked TODO(W4-docker) are the proper home for these checks.
 */
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !anonKey || !serviceKey) {
  console.error('Missing one of NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const anon = createClient(url, anonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const results = []
function record(name, pass, detail) {
  results.push({ name, pass, detail })
  const icon = pass ? '✓' : '✗'
  const colour = pass ? '\x1b[32m' : '\x1b[31m'
  console.log(`${colour}${icon}\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`)
}

// ── Check 1: SECURITY DEFINER functions exist ───────────────────────────────
{
  // Function names + signatures discovered from the actual migrations
  // (note: dev deviated from prompt — admin demographics is named
  // `admin_get_demographics` not `admin_get_user_demographics`, and both
  // admin functions use `target_user_id` not `p_user_id`).
  const selfFns = ['get_my_demographics', 'get_my_phone']
  const adminFns = ['admin_get_demographics', 'admin_get_user_phone']

  for (const fn of selfFns) {
    const { error } = await admin.rpc(fn)
    // "Could not find the function" or "does not exist" both mean missing
    const missing = error && /does not exist|could not find the function/i.test(error.message)
    record(`Function ${fn} exists`, !missing, error ? `note: ${error.message}` : 'callable')
  }

  for (const fn of adminFns) {
    const { error } = await admin.rpc(fn, { target_user_id: '00000000-0000-0000-0000-000000000000' })
    const missing = error && /does not exist|could not find the function/i.test(error.message)
    record(`Function ${fn} exists`, !missing, error ? `note: ${error.message}` : 'callable')
  }

  // Bonus: the dev added a set_my_demographics writer function that wasn't
  // in the W1 prompt — verify it exists too since W5 will depend on it.
  const { error: setErr } = await admin.rpc('set_my_demographics', {
    p_gender: null,
    p_age_range: null,
  })
  const setMissing = setErr && /does not exist|could not find the function/i.test(setErr.message)
  record(
    'Function set_my_demographics exists (bonus, added by dev)',
    !setMissing,
    setErr ? `note: ${setErr.message}` : 'callable',
  )
}

// ── Check 2: anon SELECT on protected columns is denied ─────────────────────
{
  for (const col of ['gender', 'age_range', 'phone_number']) {
    const { error } = await anon.from('profiles').select(col).limit(1)
    const denied = !!error && (
      /permission denied/i.test(error.message) ||
      /insufficient_privilege/i.test(error.code ?? '') ||
      error.code === '42501'
    )
    record(
      `anon SELECT ${col} → permission denied`,
      denied,
      error ? `code=${error.code} msg=${error.message}` : 'NO ERROR — SECURITY REGRESSION',
    )
  }
}

// ── Check 3: service_role SELECT on protected columns succeeds ──────────────
{
  for (const col of ['gender', 'age_range', 'phone_number']) {
    const { error } = await admin.from('profiles').select(col).limit(1)
    const ok = !error
    record(
      `service_role SELECT ${col} → succeeds`,
      ok,
      error ? `code=${error.code} msg=${error.message}` : 'OK',
    )
  }
}

// ── Check 4: bookings/events sanity (un-touched columns still readable) ─────
{
  // Spot check: a non-protected column on profiles is still readable by anon.
  // This guards against an over-broad REVOKE that would have nuked all SELECT.
  const { error } = await anon.from('profiles').select('id, full_name').limit(1)
  const ok = !error
  record(
    'anon SELECT id, full_name (non-protected) → still works',
    ok,
    error ? `code=${error.code} msg=${error.message}` : 'OK',
  )
}

// ── Summary ─────────────────────────────────────────────────────────────────
console.log()
const failed = results.filter((r) => !r.pass)
if (failed.length === 0) {
  console.log(`\x1b[32m✓ All ${results.length} checks passed. W1 hosted apply verified.\x1b[0m`)
  process.exit(0)
} else {
  console.log(`\x1b[31m✗ ${failed.length} of ${results.length} checks failed:\x1b[0m`)
  for (const f of failed) {
    console.log(`  - ${f.name}: ${f.detail}`)
  }
  process.exit(1)
}
