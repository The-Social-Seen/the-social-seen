/**
 * Manual-probe surface for the orphan `pending_payment` booking reaper.
 *
 * SCHEDULING — this route is NOT scheduled by Vercel cron any more. The
 * scheduled invocation runs every 15 minutes via pg_cron, installed by
 * migration `20260515095343_reaper_pgcron_schedule.sql` (cadence string
 * defined there in standard crontab form). That migration defines
 * `public.reap_stale_pending_bookings()` (SECURITY DEFINER) and
 * registers the pg_cron schedule that calls it. No env var dependency,
 * no Bearer auth, no Sentry alarm path. As long as the DB is up, the
 * reaper runs. The pg_cron path cannot silent-fail the way the Vercel-
 * cron path did during the 2026-05-15 Roza incident — there were 17
 * days of 401s because `CRON_SECRET` was unset in Vercel and the
 * scheduled ticks were reaching this route without an `x-vercel-cron`
 * header to fall back on. The `vercel.json` `"crons"` entry that
 * previously pointed here was removed in the same PR as the pg_cron
 * migration.
 *
 * WHAT THIS ROUTE IS FOR — ad-hoc manual probes during incidents. Hit
 * it with `curl -H "Authorization: Bearer ${CRON_SECRET}" ...` to force
 * a reap pass NOW and see the count without waiting for the next
 * pg_cron tick. Useful when a stuck `pending_payment` is blocking a
 * specific user from re-booking and 15 minutes is too long to wait.
 *
 * AUTHENTICATION — `Authorization: Bearer ${CRON_SECRET}`. The
 * `x-vercel-cron` header fallback is retained as defence-in-depth, but
 * no scheduled invocation exercises it in prod any more — there's no
 * `vercel.json` cron entry pointing here. The fallback stays so the
 * route still behaves correctly if a future operator re-enables a
 * Vercel cron entry for any reason. CRON_SECRET must be set in Vercel
 * Production env for manual probes to work.
 *
 * SENTRY — PR #107 added a missing-CRON_SECRET alarm on the
 * `missing_secret` auth branch. We keep it: even though the scheduled
 * invocation path is gone, a manual probe that 401s because
 * CRON_SECRET is unset is still a useful signal that Vercel env is
 * misconfigured. `bad_credentials` (valid request shape, wrong bearer)
 * is deliberately NOT alarmed — that branch is dominated by probe
 * traffic and would just be noise.
 *
 * SAFETY — the inline `UPDATE` below uses the same four predicates as
 * `public.reap_stale_pending_bookings()`:
 *   - status = 'pending_payment'
 *   - stripe_payment_id IS NULL  (webhook is source of truth for paid)
 *   - deleted_at IS NULL          (skip soft-deleted rows)
 *   - created_at < now() - 35 minutes
 * If you change ONE, change BOTH — two paths to the same effect must
 * stay in sync. The route test at `__tests__/route.test.ts` pins the
 * predicate shape; if a future refactor breaks alignment with the SQL
 * function, the route tests fail and this docstring is your starting
 * point for re-syncing.
 */
import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type AuthResult =
  | { ok: true }
  | { ok: false; reason: 'missing_secret' | 'bad_credentials' }

function authorize(req: NextRequest): AuthResult {
  if (req.headers.get('x-vercel-cron')) return { ok: true }
  const expected = process.env.CRON_SECRET
  if (!expected) return { ok: false, reason: 'missing_secret' }
  const header = req.headers.get('authorization')
  return header === `Bearer ${expected}`
    ? { ok: true }
    : { ok: false, reason: 'bad_credentials' }
}

export async function GET(req: NextRequest): Promise<Response> {
  const auth = authorize(req)
  if (!auth.ok) {
    // Surface the env-var-missing case to Sentry — a silent 401 is how
    // the cron sat dead for 17 days after PR #77 landed (see the
    // 2026-05-15 Roza incident). If CRON_SECRET is missing in Vercel,
    // every scheduled tick 401s and reaps zero rows.
    if (auth.reason === 'missing_secret') {
      Sentry.captureMessage(
        'reap-stale-bookings: CRON_SECRET env var is not set — scheduled runs will all 401',
        {
          tags: {
            surface: 'reap-stale-bookings',
            reason: 'missing_secret',
          },
          level: 'error',
        },
      )
    }
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const startedAt = new Date().toISOString()
  const cutoff = new Date(Date.now() - 35 * 60 * 1000).toISOString()

  try {
    const admin = createAdminClient()
    const { data, error } = await admin
      .from('bookings')
      .update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
      })
      .eq('status', 'pending_payment')
      .is('stripe_payment_id', null)
      .is('deleted_at', null)
      .lt('created_at', cutoff)
      .select('id')

    if (error) {
      throw new Error(`reap-stale-bookings update failed: ${error.message}`)
    }

    const reaped = data?.length ?? 0
    Sentry.addBreadcrumb({
      category: 'cron',
      message: 'reap-stale-bookings tick',
      level: 'info',
      data: { reaped, cutoff, startedAt },
    })

    return NextResponse.json({ reaped, ranAt: startedAt })
  } catch (err) {
    Sentry.captureException(err, {
      tags: { surface: 'reap-stale-bookings' },
      extra: { startedAt, cutoff },
      level: 'error',
    })
    return new NextResponse('Reaper run failed', { status: 500 })
  }
}
