import { test, expect } from '@playwright/test'
import { createTestEvent, createTestUser, purgeRun } from './helpers/fixtures'
import {
  getAdminClient,
  getE2EServiceRoleKey,
  getE2EUrl,
} from './helpers/supabase'

/**
 * Edge-function integration test — invokes `daily-notifications`
 * against the local Supabase stack and asserts that the expected
 * `notifications` rows are created.
 *
 * **Preconditions**: `supabase functions serve daily-notifications`
 * running on the Supabase local functions port. `supabase start`
 * alone does not serve functions — they need the separate
 * `functions serve` command, or a `supabase functions deploy` to a
 * local studio.
 *
 * If the function isn't reachable the test is skipped with a clear
 * diagnostic rather than failing — that way `pnpm e2e` still covers
 * the booking-RPC suite on boxes where only `supabase start` is up.
 */

async function isFunctionReachable(): Promise<boolean> {
  try {
    const res = await fetch(
      `${getE2EUrl()}/functions/v1/daily-notifications`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer invalid-token-ping`,
          'Content-Type': 'application/json',
        },
      },
    )
    // Any non-5xx response (including the expected 401) means the
    // function runtime is up. 5xx or network error = not serving.
    return res.status > 0 && res.status < 500
  } catch {
    return false
  }
}

test.describe('daily-notifications edge function', () => {
  test.afterAll(async () => {
    await purgeRun(getAdminClient())
  })

  test('venue-reveal send produces a notifications row', async () => {
    if (!(await isFunctionReachable())) {
      test.skip(
        true,
        'daily-notifications function is not serving. Start it with ' +
          '`supabase functions serve daily-notifications` in a separate ' +
          'terminal and re-run.',
      )
    }

    const admin = getAdminClient()

    // Seed: one attendee + one event 6 days out with venue hidden.
    // The function's 7-day window should pick it up and fire a reveal.
    const attendee = await createTestUser(admin, { tag: 'reveal' })
    const event = await createTestEvent(admin, {
      tag: 'reveal',
      capacity: 5,
      daysFromNow: 6,
    })
    // Manually hide venue (default is revealed=true from fixture).
    await admin
      .from('events')
      .update({ venue_revealed: false })
      .eq('id', event.id)

    const { error: bookingErr } = await admin.from('bookings').insert({
      user_id: attendee.id,
      event_id: event.id,
      status: 'confirmed',
      price_at_booking: 0,
    })
    if (bookingErr) throw bookingErr

    // Invoke the function.
    const invoked = await fetch(
      `${getE2EUrl()}/functions/v1/daily-notifications`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${getE2EServiceRoleKey()}`,
          'Content-Type': 'application/json',
        },
      },
    )
    expect(invoked.ok).toBe(true)
    const body = (await invoked.json()) as { ok: boolean; counts?: Record<string, number> }
    expect(body.ok).toBe(true)

    // Verify the audit row — search by dedupe_key which is stable
    // (`venue_reveal:<event_id>:<user_id>`). The row exists whether
    // the upstream Resend send succeeded or failed; this asserts that
    // the cron correctly identified the recipient + template, which
    // is the integration we care about. (CI runs with a dummy
    // RESEND_API_KEY so the actual send returns 401 and the row
    // status ends up `failed` — that's expected; we don't want real
    // emails to fly during E2E.)
    const dedupeKey = `venue_reveal:${event.id}:${attendee.id}`
    const { data: rows, error: rowErr } = await admin
      .from('notifications')
      .select('id, template_name, channel, status, dedupe_key')
      .eq('dedupe_key', dedupeKey)
    if (rowErr) throw rowErr

    expect(rows ?? []).toHaveLength(1)
    const row = rows![0] as { template_name: string; channel: string; status: string }
    expect(row.template_name).toBe('venue_reveal')
    expect(row.channel).toBe('email')
    // Status will be 'sent' with a real Resend key, 'failed' with the
    // CI dummy. Either is acceptable proof that the send was attempted
    // through our wrapper.
    expect(['sent', 'failed']).toContain(row.status)
  })
})
