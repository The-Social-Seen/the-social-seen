import { test, expect } from '@playwright/test'
import { getAdminClient } from '../helpers/supabase'
import {
  E2E_SLUG_PREFIX,
  purgeRun,
  type TestEvent,
} from '../helpers/fixtures'

/**
 * UI E2E coverage for the admin event-create round-trip.
 *
 * Follow-up B from PR #96 (BST timezone fix) + PR #97 (inverse direction).
 * The unit tests in src/lib/utils/__tests__/dates.test.ts pin both directions
 * of the wall-clock <-> UTC conversion in isolation. This suite validates
 * the full integration boundary — that an event row stored at a known UTC
 * timestamp renders the matching wall-clock time on the public page when
 * the rest of Next.js (RSC streaming, hydration, the dates.ts helpers used
 * by EventDetailClient) is exercised end-to-end.
 *
 * We seed events directly in the DB rather than driving the admin form
 * UI. The form has interactive TagPicker + MemberPicker components that
 * make a full e2e fragile and tightly-coupled to UI internals; the
 * regression risk those would catch (correct datetime-local handling) is
 * already pinned by the unit tests for `normaliseLondonDatetimeToUtc`
 * and `londonDatetimeFromUtc`. What seeded-event public-render tests
 * uniquely catch is a regression in the **render** path: a hydration TZ
 * drift, an SSR mismatch, or a future change to formatTimeRange.
 *
 * Tests run against the local Supabase stack (default
 * http://127.0.0.1:54321). They DO NOT need Inbucket or auth — public
 * event pages are anon-readable. The events are tagged with the run-
 * scoped E2E_SLUG_PREFIX so afterAll's purgeRun sweeps them.
 */

interface SeedOpts {
  /** UTC ISO timestamp the event should start at. */
  startUtcIso: string
  /** Hours from start until end_time. Default 3. */
  durationHours?: number
  tag: string
}

async function seedEventAt(opts: SeedOpts): Promise<TestEvent> {
  const { startUtcIso, durationHours = 3, tag } = opts
  const admin = getAdminClient()
  const suffix = Math.random().toString(36).slice(2, 8)
  const slug = `${E2E_SLUG_PREFIX}${tag}-${suffix}`
  const title = `E2E ${tag} ${suffix}`

  const startMs = new Date(startUtcIso).getTime()
  const endMs = startMs + durationHours * 60 * 60 * 1000
  const endIso = new Date(endMs).toISOString()

  const { data, error } = await admin
    .from('events')
    .insert({
      slug,
      title,
      description: 'Seeded by the admin-events e2e suite.',
      short_description: 'E2E timezone seed',
      date_time: startUtcIso,
      end_time: endIso,
      venue_name: 'E2E Venue',
      venue_address: '1 Test Road, London',
      venue_revealed: true,
      price: 0,
      capacity: 5,
      image_url: null,
      is_published: true,
      is_cancelled: false,
      deleted_at: null,
    })
    .select('id, slug, title')
    .single()

  if (error || !data) {
    throw new Error(`seedEventAt: insert failed: ${error?.message ?? 'no row'}`)
  }
  return data as TestEvent
}

test.describe('Admin event time round-trip — public page rendering', () => {
  // The booking-rpcs suite teaches us CI can be slow. Two retries absorbs
  // transient slowness without masking a real regression.
  test.describe.configure({ retries: 2 })

  test.afterAll(async () => {
    await purgeRun(getAdminClient())
  })

  // ── Scenario 1: BST event renders at the correct London wall-clock time
  test('BST event stored at 18:00 UTC renders as "7:00 PM" on the public page', async ({
    page,
  }) => {
    // 2026-06-15 19:00 London (BST) = 18:00 UTC. End +3h: 21:00 BST = 20:00 UTC.
    // formatTimeRange in src/lib/utils/dates.ts produces "7:00 PM – 10:00 PM".
    const event = await seedEventAt({
      startUtcIso: '2026-06-15T18:00:00.000Z',
      durationHours: 3,
      tag: 'tz-bst',
    })

    await page.goto(`/events/${event.slug}`)

    // The event detail page renders the time range via formatTimeRange.
    // We assert the start hour explicitly — the en-dash separator is
    // load-bearing for the format but not for this regression.
    await expect(page.getByText('7:00 PM – 10:00 PM')).toBeVisible({
      timeout: 10_000,
    })
  })

  // ── Scenario 2: GMT event renders at the correct London wall-clock time
  test('GMT event stored at 19:00 UTC renders as "7:00 PM" on the public page', async ({
    page,
  }) => {
    // 2026-12-15 19:00 London (GMT) = 19:00 UTC. End +3h: 22:00 GMT = 22:00 UTC.
    const event = await seedEventAt({
      startUtcIso: '2026-12-15T19:00:00.000Z',
      durationHours: 3,
      tag: 'tz-gmt',
    })

    await page.goto(`/events/${event.slug}`)

    await expect(page.getByText('7:00 PM – 10:00 PM')).toBeVisible({
      timeout: 10_000,
    })
  })

  // ── Scenario 3: BST→GMT transition Sunday (last Sunday of October).
  // Defensive: a regression in either dates.ts helper at the transition
  // moment would silently shift this event by 1h. The unit tests pin this
  // for the conversion, but only an integration test catches a render-side
  // drift (e.g. a future change that does its own getTimezoneOffset()).
  test('event the day after BST ends (GMT) renders correctly', async ({
    page,
  }) => {
    // 2026-10-26 19:00 London (GMT — BST ended 25 Oct at 02:00 BST).
    // 19:00 GMT = 19:00 UTC. End 22:00.
    const event = await seedEventAt({
      startUtcIso: '2026-10-26T19:00:00.000Z',
      durationHours: 3,
      tag: 'tz-after-bst',
    })

    await page.goto(`/events/${event.slug}`)

    await expect(page.getByText('7:00 PM – 10:00 PM')).toBeVisible({
      timeout: 10_000,
    })
  })
})

// ── Scenario 4 (skipped — see comment) ────────────────────────────────────
// Full admin form drive: log in as admin, navigate to /admin/events/new,
// fill the form (including TagPicker primary selection), submit, then
// verify the public page. This was deferred because:
//
// 1. The TagPicker is a custom interactive component — picking a primary
//    tag requires clicking specific elements that are likely to change as
//    the picker UI evolves. Brittle.
// 2. The MemberPicker for hosts has a similar coupling problem.
// 3. The same regression risk (datetime conversion) is already pinned
//    end-to-end above by the seed-and-render scenarios; the unit tests
//    in dates.test.ts cover the conversion logic itself.
//
// To resume: drop the skip below, look at MemberPicker.test.tsx and
// TagPicker.test.tsx for stable selectors, drive the form via stable
// `data-testid` attributes (add them if needed — coordinate with
// frontend-developer first).
test.skip('full admin event-create form drive — deferred', async () => {})
