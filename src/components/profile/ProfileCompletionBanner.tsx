'use client'

import { useState } from 'react'
import { X, UserCircle } from 'lucide-react'
import type { Profile } from '@/types'
import { computeProfileCompletion } from '@/lib/utils/profile-completion'

interface ProfileCompletionBannerProps {
  profile: Profile
  onCompleteClick: () => void
}

export function ProfileCompletionBanner({
  profile,
  onCompleteClick,
}: ProfileCompletionBannerProps) {
  const [dismissed, setDismissed] = useState(false)

  const { score, missingLabels } = computeProfileCompletion(profile)

  // Hide entirely at 100%. Below that, show — progress bar + missing field list.
  if (score >= 100 || dismissed) return null

  // Show up to 3 missing labels; the rest collapse into "+N more".
  const visibleLabels = missingLabels.slice(0, 3)
  const remaining = missingLabels.length - visibleLabels.length

  return (
    <div className="relative rounded-xl border border-gold/20 border-l-4 border-l-gold bg-bg-card p-4">
      <button
        onClick={() => setDismissed(true)}
        className="absolute right-3 top-3 text-text-tertiary transition-colors hover:text-text-primary"
        aria-label="Dismiss banner"
      >
        <X className="h-4 w-4" />
      </button>

      <div className="flex items-start gap-3 pr-6">
        <UserCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-gold" />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <p className="text-sm font-medium text-text-primary">
              Complete your profile
            </p>
            <p className="text-sm font-semibold text-gold tabular-nums">
              {score}%
            </p>
          </div>

          {/* Progress bar */}
          <div
            className="mt-2 h-2 w-full overflow-hidden rounded-full bg-blush/40"
            role="progressbar"
            aria-valuenow={score}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Profile ${score}% complete`}
          >
            <div
              className="h-full rounded-full bg-gold transition-[width] duration-500 ease-out"
              style={{ width: `${score}%` }}
            />
          </div>

          {/* Missing fields + CTA */}
          <p className="mt-3 text-xs text-text-secondary">
            Still to add:{' '}
            <span className="text-text-primary">
              {visibleLabels.join(', ')}
              {remaining > 0 && ` + ${remaining} more`}
            </span>
          </p>
          <button
            onClick={onCompleteClick}
            className="mt-2 text-sm font-medium text-gold underline-offset-2 hover:underline"
          >
            Complete yours &rarr;
          </button>
        </div>
      </div>
    </div>
  )
}
