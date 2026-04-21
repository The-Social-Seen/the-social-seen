import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { getEventBySlug } from '@/lib/supabase/queries/events'
import { formatDateFull, formatTime } from '@/lib/utils/dates'
import { CheckCircle2, Calendar, Clock, MapPin } from 'lucide-react'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: "You're booked — The Social Seen",
  robots: { index: false, follow: false },
}

interface PageProps {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ session_id?: string }>
}

/**
 * Stripe Checkout success landing page. Stripe redirects here after a
 * completed payment with `?session_id=cs_...`. We don't TRUST the URL
 * (anyone could hit this with a made-up session id) — the webhook is
 * the authoritative confirmation. This page is just a friendly "all
 * done" surface that reads the booking state from the DB.
 *
 * Race: the webhook usually fires before the user's browser gets the
 * redirect, but occasionally not — the page checks for confirmed +
 * falls back to "we're finalising your booking" messaging.
 */
export default async function BookingSuccessPage({
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

  // Look up the booking. We match on stripe_checkout_session_id when
  // Stripe passed it back — otherwise fall back to the most recent
  // pending_payment/confirmed row for this user+event.
  let bookingQuery = supabase
    .from('bookings')
    .select('id, status, stripe_checkout_session_id')
    .eq('user_id', user.id)
    .eq('event_id', event.id)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(1)

  if (sp.session_id) {
    bookingQuery = supabase
      .from('bookings')
      .select('id, status, stripe_checkout_session_id')
      .eq('user_id', user.id)
      .eq('event_id', event.id)
      .eq('stripe_checkout_session_id', sp.session_id)
      .is('deleted_at', null)
      .limit(1)
  }

  const { data: bookings } = await bookingQuery
  const booking = bookings?.[0]

  const isConfirmed = booking?.status === 'confirmed'
  const isStillProcessing = booking?.status === 'pending_payment'

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <div className="rounded-2xl border border-blush/40 bg-bg-card p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-success/10">
          <CheckCircle2 className="h-7 w-7 text-success" aria-hidden="true" />
        </div>

        {isConfirmed ? (
          <>
            <h1 className="font-serif text-3xl font-bold text-text-primary">
              You&rsquo;re booked.
            </h1>
            <p className="mt-3 text-text-primary/70">
              Payment received. We&rsquo;ve sent a confirmation email with
              the details.
            </p>
          </>
        ) : isStillProcessing ? (
          <>
            <h1 className="font-serif text-3xl font-bold text-text-primary">
              Finalising your booking&hellip;
            </h1>
            <p className="mt-3 text-text-primary/70">
              Payment received. We&rsquo;re just confirming with our
              system &mdash; this usually takes a few seconds. Refresh in
              a moment, or check
              {' '}
              <Link
                href="/bookings"
                className="font-medium text-gold hover:text-gold-hover"
              >
                your bookings page
              </Link>
              .
            </p>
          </>
        ) : (
          <>
            <h1 className="font-serif text-3xl font-bold text-text-primary">
              Thanks!
            </h1>
            <p className="mt-3 text-text-primary/70">
              We couldn&rsquo;t find a matching booking yet. If your
              payment went through, check your email for the
              confirmation, or head to
              {' '}
              <Link
                href="/bookings"
                className="font-medium text-gold hover:text-gold-hover"
              >
                your bookings
              </Link>
              .
            </p>
          </>
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
            href="/bookings"
            className="rounded-full bg-gold px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-gold-dark"
          >
            View my bookings
          </Link>
          <Link
            href={`/events/${event.slug}`}
            className="rounded-full border border-blush/60 px-6 py-2.5 text-sm font-medium text-text-primary transition-colors hover:bg-bg-primary"
          >
            Back to event
          </Link>
        </div>
      </div>
    </main>
  )
}
