/**
 * Vercel-cron-driven reaper for orphan `pending_payment` bookings.
 *
 * Closes Task B from the 2026-04-27 Stripe-credentials-rotation
 * incident. The `book_event_paid` RPC duplicate-check
 * (migration 20260422000002, line 88) blocks any non-cancelled
 * status — including `pending_payment`. The catch block at
 * src/app/events/[slug]/actions.ts:353 is the only happy-path
 * cleanup; if the user closes the tab mid-Stripe-error or the
 * Server Action otherwise doesn't reach the catch, the orphan
 * persists forever — invisible to the user (the bookings page
 * filters `pending_payment` out) AND blocks re-booking the same
 * event. Mitesh hit this twice on 2026-04-28.
 *
 * Drives: Vercel cron, daily at 03:00 UTC (see vercel.json). The
 * Hobby plan caps cron frequency at once-per-day, so a stuck
 * `pending_payment` row can persist up to ~24 hours before reaping.
 * For ad-hoc cleanup during incidents, hit the route manually with
 * Bearer ${CRON_SECRET} — same code path, same safety net.
 *
 * Authentication accepts EITHER:
 *   - x-vercel-cron header. Kept as a defensive fallback — Vercel does
 *     document this header as set on cron-originated requests, but the
 *     2026-05-15 Roza incident showed scheduled ticks reaching us
 *     without it on the Hobby tier. Don't rely on it as the sole auth.
 *   - Authorization: Bearer ${CRON_SECRET} — the path Vercel cron
 *     actually uses for scheduled invocations AND what manual probes
 *     use. CRON_SECRET MUST be set in Vercel env (Production) or every
 *     scheduled tick will 401 and reap zero rows. The `missing_secret`
 *     branch in `authorize()` raises a Sentry alarm so a missing env
 *     var is loud rather than silent (root cause of the 2026-05-15
 *     Roza incident — see route tests for the pinned signal).
 *
 * Note: `bad_credentials` (valid request shape, wrong bearer) is
 * deliberately NOT alarmed. That branch is dominated by probe traffic
 * and would just be noise.
 *
 * Safety net: `stripe_payment_id IS NULL` ensures we never touch a
 * booking that actually paid. The webhook is the source of truth for
 * paid bookings and writes that column on `checkout.session.completed`.
 * `deleted_at IS NULL` skips already-soft-deleted rows.
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
