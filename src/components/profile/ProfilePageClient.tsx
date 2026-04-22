'use client'

import { useState } from 'react'
import { AlertCircle } from 'lucide-react'
import { ProfileHeader } from '@/components/profile/ProfileHeader'
import { ProfileCompletionBanner } from '@/components/profile/ProfileCompletionBanner'
import { EditProfileForm } from '@/components/profile/EditProfileForm'
import { BookingsList } from '@/components/profile/BookingsList'
import DataPrivacySection from '@/components/profile/DataPrivacySection'
import { EmailPreferencesSection } from '@/components/profile/EmailPreferencesSection'
import { SmsPreferencesSection } from '@/components/profile/SmsPreferencesSection'
import type {
  EmailPreferences,
  SmsPreferences,
} from '@/app/(member)/profile/preferences-actions'
import type { Profile, BookingWithEvent } from '@/types'

interface ProfilePageClientProps {
  profile: Profile & { interests: string[] }
  upcoming: BookingWithEvent[]
  past: BookingWithEvent[]
  waitlisted: BookingWithEvent[]
  reviewableEventIds: Set<string>
  emailPreferences: EmailPreferences | null
  smsPreferences: SmsPreferences | null
}

export function ProfilePageClient({
  profile,
  upcoming,
  past,
  waitlisted,
  reviewableEventIds,
  emailPreferences,
  smsPreferences,
}: ProfilePageClientProps) {
  const [editOpen, setEditOpen] = useState(false)

  const isSuspended = profile.status === 'suspended'

  return (
    <>
      {/* P2-8a: suspension notice. Banned users are redirected to
          /account-suspended by the middleware so they never see this
          page. Suspended users CAN still view their profile + past
          bookings; they just can't book anything new. */}
      {isSuspended && (
        <div
          role="status"
          className="mb-6 flex items-start gap-3 rounded-xl border border-gold/40 bg-gold/5 p-4"
        >
          <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-gold" />
          <div className="text-sm">
            <p className="font-semibold text-text-primary">
              Your account is currently suspended.
            </p>
            <p className="mt-1 text-text-primary/70">
              You can still view your profile and past bookings, but you
              won&rsquo;t be able to book new events. If you believe this
              is a mistake, email us at{' '}
              <a
                href="mailto:info@the-social-seen.com"
                className="font-medium text-gold hover:text-gold-hover"
              >
                info@the-social-seen.com
              </a>
              .
            </p>
          </div>
        </div>
      )}

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

      {emailPreferences && <EmailPreferencesSection initial={emailPreferences} />}
      {smsPreferences && <SmsPreferencesSection initial={smsPreferences} />}

      <DataPrivacySection />

      <EditProfileForm profile={profile} open={editOpen} onOpenChange={setEditOpen} />
    </>
  )
}
