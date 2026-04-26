#!/usr/bin/env node
/**
 * One-off verification for F1a (data-layer half) — confirms the new
 * event_tags + tags JOIN returns primary_tag: { slug, label } alongside
 * the legacy events.category column for a known seeded event.
 *
 * Spec: docs/member-data-layer-spec.md (Decisions 4, 5, 6).
 *
 * Usage:
 *   node --env-file=.env.local scripts/verify-f1a-primary-tag.mjs [slug]
 *
 * Exits 0 on pass, 1 on failure.
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

const TARGET_SLUG = process.argv[2] ?? 'summer-party-upstairs-langans-jun-2026'

let passed = 0
let failed = 0
function check(name, ok, detail) {
  const icon = ok ? '✓' : '✗'
  const colour = ok ? '\x1b[32m' : '\x1b[31m'
  console.log(`${colour}${icon}\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`)
  if (ok) passed++
  else failed++
}

// 0. Sanity check — does the event exist at all (without the inner join)?
const sanity = await supabase
  .from('events')
  .select('id, slug, category, is_published, deleted_at')
  .eq('slug', TARGET_SLUG)
  .maybeSingle()

if (sanity.error) {
  check(`Sanity SELECT events`, false, sanity.error.message)
  process.exit(1)
}
if (!sanity.data) {
  console.log(`\nNo event found with slug "${TARGET_SLUG}". Listing dining events for reference:`)
  const list = await supabase
    .from('events')
    .select('slug, title, category, is_published, deleted_at')
    .eq('category', 'dining')
    .is('deleted_at', null)
    .eq('is_published', true)
    .order('date_time', { ascending: false })
    .limit(10)
  if (list.data) console.table(list.data)
  process.exit(1)
}
check(
  `Event exists (id=${sanity.data.id.slice(0, 8)}…, category=${sanity.data.category}, published=${sanity.data.is_published})`,
  true,
)

// 1. Replicates getEventBySlug's F1a JOIN — events + event_tags!inner + tags!inner
const { data: event, error } = await supabase
  .from('events')
  .select(
    '*, event_tags!inner(is_primary, tags!inner(slug, label))',
  )
  .eq('slug', TARGET_SLUG)
  .eq('is_published', true)
  .eq('event_tags.is_primary', true)
  .is('deleted_at', null)
  .single()

if (error) {
  check(`SELECT events + event_tags inner JOIN for ${TARGET_SLUG}`, false, error.message)
  process.exit(1)
}

check(`Event found by slug "${TARGET_SLUG}" via inner JOIN`, !!event)

// 2. Legacy category still populated (dual-write window)
check(
  `event.category === "${sanity.data.category}" (legacy column still populated)`,
  event.category === sanity.data.category,
  `actual: ${event.category}`,
)

// 3. event_tags embed present and contains exactly one primary
const eventTags = event.event_tags
const tagsArr = Array.isArray(eventTags) ? eventTags : [eventTags]
check(
  'event_tags embed contains exactly one row (the primary)',
  tagsArr.length === 1,
  `actual length: ${tagsArr.length}`,
)
check(
  'event_tags[0].is_primary === true',
  tagsArr[0]?.is_primary === true,
  `actual: ${tagsArr[0]?.is_primary}`,
)

// 4. Nested tags inner join returns slug + label
const tagInner = Array.isArray(tagsArr[0]?.tags) ? tagsArr[0].tags[0] : tagsArr[0]?.tags
check('primary_tag has a slug', !!tagInner?.slug, `actual: ${tagInner?.slug}`)
check('primary_tag has a label', !!tagInner?.label, `actual: ${tagInner?.label}`)

// 5. Print the synthesized shape (what getEventBySlug returns)
console.log('\nSynthesized row shape (what callers see):')
console.log(
  JSON.stringify(
    {
      id: event.id,
      slug: event.slug,
      title: event.title,
      category: event.category,
      primary_tag: tagInner ? { slug: tagInner.slug, label: tagInner.label } : null,
    },
    null,
    2,
  ),
)

console.log(`\n${passed} passed, ${failed} failed.`)
process.exit(failed > 0 ? 1 : 0)
