import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { getEventBySlug } from '@/lib/supabase/queries/events'
import { formatDateFull, formatTime } from '@/lib/utils/dates'
import { formatPrice } from '@/lib/utils/currency'
import { CheckCircle2, Calendar, Clock, MapPin } from 'lucide-react'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Cancellation confirmed — The Social Seen',
  robots: { index: false, follow: false },
}

interface PageProps {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ refunded_pence?: string }>
}

/**
 * Cancellation acknowledgement page. Mirrors the booking-success page
 * so a user who cancels gets the same kind of clear confirmation
 * surface as a user who booked.
 *
 * The cancel Server Action has already issued the refund (if any) and
 * marked the booking cancelled before redirecting here. We don't
 * re-cancel; we just read the URL hint (`refunded_pence`) and the
 * event price to choose the right copy:
 *   - refunded > 0  → refund-issued message
 *   - free event    → "spot released" message
 *   - paid + 0      → "no refund per policy" message
 */
export default async function CancellationConfirmedPage({
  params,
  searchParams,
}: PageProps) {
  const { slug } = await params
  const sp = await searchParams

  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    redirect(`/login?redirect=/events/${slug}`)
  }

  const event = await getEventBySlug(slug)
  if (!event) {
    redirect('/events')
  }

  const refundedPence = parseInt(sp.refunded_pence ?? '0', 10) || 0
  const isPaid = event.price > 0
  const wasRefunded = refundedPence > 0
  const noRefundIssued = isPaid && !wasRefunded

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <div className="rounded-2xl border border-blush/40 bg-bg-card p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-success/10">
          <CheckCircle2 className="h-7 w-7 text-success" aria-hidden="true" />
        </div>

        <h1 className="font-serif text-3xl font-bold text-text-primary">
          Sorry you can&rsquo;t make it.
        </h1>

        {wasRefunded ? (
          <p className="mt-3 text-text-primary/70">
            Your booking has been cancelled and we&rsquo;ve refunded{' '}
            <span className="font-semibold text-text-primary">
              {formatPrice(refundedPence)}
            </span>{' '}
            to your card. Refunds usually appear within 2&ndash;3 working
            days. We hope to see you at another event soon.
          </p>
        ) : noRefundIssued ? (
          <p className="mt-3 text-text-primary/70">
            Your booking has been cancelled and your spot has been
            released for someone on the waitlist. As this cancellation
            falls outside the event&rsquo;s refund window, no refund has
            been issued. We hope to see you at another event soon.
          </p>
        ) : (
          <p className="mt-3 text-text-primary/70">
            Your spot has been released for someone on the waitlist. We
            hope to see you at another event soon.
          </p>
        )}

        <div className="mx-auto my-8 max-w-sm space-y-3 rounded-xl border border-blush/40 bg-bg-primary/40 p-4 text-left">
          <div className="flex items-start gap-3">
            <Calendar className="mt-0.5 h-4 w-4 flex-shrink-0 text-gold" />
            <p className="text-sm text-text-primary">
              {formatDateFull(event.date_time)}
            </p>
          </div>
          <div className="flex items-start gap-3">
            <Clock className="mt-0.5 h-4 w-4 flex-shrink-0 text-gold" />
            <p className="text-sm text-text-primary">
              {formatTime(event.date_time)}
            </p>
          </div>
          <div className="flex items-start gap-3">
            <MapPin className="mt-0.5 h-4 w-4 flex-shrink-0 text-gold" />
            <p className="text-sm text-text-primary">
              {event.venue_revealed
                ? event.venue_name
                : 'Venue revealed 1 week before'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap justify-center gap-3">
          <Link
            href="/events"
            className="rounded-full bg-gold px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-gold-dark"
          >
            Browse other events
          </Link>
          <Link
            href="/bookings"
            className="rounded-full border border-blush/60 px-6 py-2.5 text-sm font-medium text-text-primary transition-colors hover:bg-bg-primary"
          >
            My bookings
          </Link>
        </div>
      </div>
    </main>
  )
}
