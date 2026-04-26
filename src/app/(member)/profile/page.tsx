import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import {
  getProfile,
  getMyBookings,
  getMyPhone,
} from '@/lib/supabase/queries/profile'
import { getReviewableEvents } from '@/lib/supabase/queries/reviews'
import { splitBookings } from '@/lib/utils/bookings'
import { ProfilePageClient } from '@/components/profile/ProfilePageClient'
import { getMyEmailPreferences, getMySmsPreferences } from './preferences-actions'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'My Profile — The Social Seen',
  description: 'Manage your profile, interests, and account settings.',
  robots: { index: false, follow: false },
}

export default async function ProfilePage() {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  // `phone` is fetched via the SECURITY DEFINER `get_my_phone()` RPC
  // because Phase 3 W1 narrowed the `authenticated` GRANT to exclude
  // `phone_number`. It's merged into the profile object before passing
  // to the client so existing consumers (ProfileHeader, EditProfileForm)
  // keep reading `profile.phone_number` unchanged.
  const [
    profile,
    phone,
    bookings,
    reviewableEvents,
    emailPreferences,
    smsPreferences,
  ] = await Promise.all([
    getProfile(user.id),
    getMyPhone(),
    getMyBookings(user.id),
    getReviewableEvents(),
    getMyEmailPreferences(),
    getMySmsPreferences(),
  ])

  if (!profile) redirect('/login')

  const profileWithPhone = { ...profile, phone_number: phone }

  const { upcoming, past, waitlisted } = splitBookings(bookings)
  const reviewableEventIds = new Set(reviewableEvents.map((e) => e.id))

  return (
    <div className="mx-auto max-w-4xl px-4 pb-12 pt-20 sm:px-6 sm:pt-24 md:pb-20">
      <h1 className="sr-only">My Profile</h1>
      <div className="space-y-6">
        <ProfilePageClient
          profile={profileWithPhone}
          upcoming={upcoming}
          past={past}
          waitlisted={waitlisted}
          reviewableEventIds={reviewableEventIds}
          emailPreferences={emailPreferences}
          smsPreferences={smsPreferences}
        />
      </div>
    </div>
  )
}
