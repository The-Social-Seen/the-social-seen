import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { getProfile, getMyBookings } from '@/lib/supabase/queries/profile'
import { getReviewableEvents } from '@/lib/supabase/queries/reviews'
import { splitBookings } from '@/lib/utils/bookings'
import { ProfilePageClient } from '@/components/profile/ProfilePageClient'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'My Profile — The Social Seen',
}

export default async function ProfilePage() {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const [profile, bookings, reviewableEvents] = await Promise.all([
    getProfile(user.id),
    getMyBookings(user.id),
    getReviewableEvents(),
  ])

  if (!profile) redirect('/login')

  const { upcoming, past, waitlisted } = splitBookings(bookings)
  const reviewableEventIds = new Set(reviewableEvents.map((e) => e.id))

  return (
    <div className="mx-auto max-w-4xl px-4 pb-12 pt-20 sm:px-6 sm:pt-24 md:pb-20">
      <h1 className="sr-only">My Profile</h1>
      <div className="space-y-6">
        <ProfilePageClient
          profile={profile}
          upcoming={upcoming}
          past={past}
          waitlisted={waitlisted}
          reviewableEventIds={reviewableEventIds}
        />
      </div>
    </div>
  )
}
