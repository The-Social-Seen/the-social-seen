'use client'

import { useState } from 'react'
import { ProfileHeader } from '@/components/profile/ProfileHeader'
import { ProfileCompletionBanner } from '@/components/profile/ProfileCompletionBanner'
import { EditProfileForm } from '@/components/profile/EditProfileForm'
import { BookingsList } from '@/components/profile/BookingsList'
import type { Profile, BookingWithEvent } from '@/types'

interface ProfilePageClientProps {
  profile: Profile & { interests: string[] }
  upcoming: BookingWithEvent[]
  past: BookingWithEvent[]
  waitlisted: BookingWithEvent[]
  reviewableEventIds: Set<string>
}

export function ProfilePageClient({
  profile,
  upcoming,
  past,
  waitlisted,
  reviewableEventIds,
}: ProfilePageClientProps) {
  const [editOpen, setEditOpen] = useState(false)

  return (
    <>
      <ProfileCompletionBanner profile={profile} onCompleteClick={() => setEditOpen(true)} />
      <ProfileHeader profile={profile} onEditClick={() => setEditOpen(true)} />

      <section className="mt-8">
        <h2 className="mb-4 font-serif text-xl font-bold text-text-primary">
          My Bookings
        </h2>
        <BookingsList
          upcoming={upcoming}
          past={past}
          waitlisted={waitlisted}
          reviewableEventIds={reviewableEventIds}
          userName={profile.full_name}
          userAvatar={profile.avatar_url}
        />
      </section>

      <EditProfileForm profile={profile} open={editOpen} onOpenChange={setEditOpen} />
    </>
  )
}
