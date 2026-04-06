import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { getMyBookings } from '@/lib/supabase/queries/profile'
import { getReviewableEvents } from '@/lib/supabase/queries/reviews'
import { splitBookings } from '@/lib/utils/bookings'
import { BookingsList } from '@/components/profile/BookingsList'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'My Bookings — The Social Seen',
}

export default async function BookingsPage() {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  // Fetch bookings, reviewable events, and profile in parallel
  const [bookings, reviewableEvents, profileResult] = await Promise.all([
    getMyBookings(user.id),
    getReviewableEvents(),
    supabase
      .from('profiles')
      .select('full_name, avatar_url')
      .eq('id', user.id)
      .single(),
  ])

  const { upcoming, past, waitlisted } = splitBookings(bookings)
  const reviewableEventIds = new Set(reviewableEvents.map((e) => e.id))

  const userName = profileResult.data?.full_name ?? user.user_metadata?.full_name ?? 'Member'
  const userAvatar = profileResult.data?.avatar_url ?? null

  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 md:py-20">
      <h1 className="mb-6 font-serif text-2xl font-bold text-text-primary md:text-3xl">
        My Bookings
      </h1>
      <BookingsList
        upcoming={upcoming}
        past={past}
        waitlisted={waitlisted}
        reviewableEventIds={reviewableEventIds}
        userName={userName}
        userAvatar={userAvatar}
      />
    </div>
  )
}
