'use client'

import { useState } from 'react'
import { X, UserCircle } from 'lucide-react'
import type { Profile } from '@/types'

interface ProfileCompletionBannerProps {
  profile: Profile
  onCompleteClick: () => void
}

export function ProfileCompletionBanner({ profile, onCompleteClick }: ProfileCompletionBannerProps) {
  const [dismissed, setDismissed] = useState(false)

  const isIncomplete = !profile.job_title || !profile.avatar_url

  if (!isIncomplete || dismissed) return null

  return (
    <div className="relative rounded-xl border border-gold/20 border-l-4 border-l-gold bg-bg-card p-4 sm:flex sm:items-center sm:justify-between sm:gap-4">
      <div className="flex items-start gap-3 sm:items-center">
        <UserCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-gold sm:mt-0" />
        <p className="text-sm text-text-primary">
          Profiles with a photo get noticed more.{' '}
          <button
            onClick={onCompleteClick}
            className="font-medium text-gold underline-offset-2 hover:underline"
          >
            Complete yours &rarr;
          </button>
        </p>
      </div>
      <button
        onClick={() => setDismissed(true)}
        className="absolute right-3 top-3 text-text-tertiary transition-colors hover:text-text-primary sm:static"
        aria-label="Dismiss banner"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
