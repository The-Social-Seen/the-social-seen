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
 * Drives: Vercel cron, every 15 min (see vercel.json). Combined
 * with the 35-min staleness threshold, max time-to-cleanup is
 * ~50 min. Stripe Checkout Sessions auto-expire at 30 min; the
 * 5-min buffer absorbs clock skew + Vercel cron drift.
 *
 * Authentication accepts EITHER:
 *   - x-vercel-cron header (set automatically by Vercel cron) — the
 *     primary auth path for the scheduled tick.
 *   - Authorization: Bearer ${CRON_SECRET} — for ad-hoc curl during
 *     ops/debug. CRON_SECRET must be set in Vercel env (Production
 *     and Preview) before manual probes will work; the cron tick
 *     does not depend on it.
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

function isAuthorized(req: NextRequest): boolean {
  if (req.headers.get('x-vercel-cron')) return true
  const expected = process.env.CRON_SECRET
  if (!expected) return false
  const header = req.headers.get('authorization')
  return header === `Bearer ${expected}`
}

export async function GET(req: NextRequest): Promise<Response> {
  if (!isAuthorized(req)) {
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
