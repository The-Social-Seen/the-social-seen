import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { getProfile, getMyBookings } from '@/lib/supabase/queries/profile'
import { isPastEvent } from '@/lib/utils/dates'
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

  const [profile, bookings] = await Promise.all([
    getProfile(user.id),
    getMyBookings(user.id),
  ])

  if (!profile) redirect('/login')

  // Split bookings into upcoming / past / waitlisted
  const upcoming = bookings.filter(
    (b) => b.status === 'confirmed' && !isPastEvent(b.event.date_time),
  )
  const past = bookings.filter(
    (b) =>
      (b.status === 'confirmed' || b.status === 'no_show') &&
      isPastEvent(b.event.date_time),
  )
  const waitlisted = bookings.filter((b) => b.status === 'waitlisted')

  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 md:py-20">
      <h1 className="sr-only">My Profile</h1>
      <div className="space-y-6">
        <ProfilePageClient
          profile={profile}
          upcoming={upcoming}
          past={past}
          waitlisted={waitlisted}
        />
      </div>
    </div>
  )
}
