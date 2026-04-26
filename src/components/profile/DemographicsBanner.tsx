'use client'

import { useState, useTransition } from 'react'
import { ChevronDown, X, Users } from 'lucide-react'
import { updateMyDemographics } from '@/app/(member)/profile/actions'
import type { AgeRange, Gender } from '@/types'

interface DemographicsBannerProps {
  initialGender: Gender | null
  initialAgeRange: AgeRange | null
}

const GENDER_OPTIONS: ReadonlyArray<{ value: Gender; label: string }> = [
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
  { value: 'non_binary', label: 'Non-binary' },
  { value: 'prefer_not_to_say', label: 'Prefer not to say' },
]

const AGE_RANGE_OPTIONS: ReadonlyArray<{ value: AgeRange; label: string }> = [
  { value: '18-24', label: '18–24' },
  { value: '25-29', label: '25–29' },
  { value: '30-34', label: '30–34' },
  { value: '35-39', label: '35–39' },
  { value: '40-44', label: '40–44' },
  { value: '45-49', label: '45–49' },
  { value: '50+', label: '50+' },
]

/**
 * "Help us keep events balanced" banner — Phase 3 W5.
 *
 * Shown when EITHER `gender` or `age_range` is null on the caller's profile.
 * Both fields are optional; saving one (or both) hides the banner on the
 * next reload because the parent's `getMyDemographics()` will return non-null.
 *
 * Privacy contract — these fields are admin-only on the read side. This
 * banner is the ONLY surface a member sees their own values; member-facing
 * profile views (header, public community list) MUST NOT render them.
 *
 * Save flow uses the `updateMyDemographics()` Server Action which calls the
 * SECURITY DEFINER `set_my_demographics()` RPC scoped to `auth.uid()`.
 */
export function DemographicsBanner({
  initialGender,
  initialAgeRange,
}: DemographicsBannerProps) {
  const [dismissed, setDismissed] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [gender, setGender] = useState<Gender | null>(initialGender)
  const [ageRange, setAgeRange] = useState<AgeRange | null>(initialAgeRange)
  const [error, setError] = useState<string | null>(null)
  const [savedJustNow, setSavedJustNow] = useState(false)
  const [isPending, startTransition] = useTransition()

  // The parent decides whether to render this at all (only when one or
  // both initial values are null). After a successful save we hide it
  // optimistically so the user gets immediate feedback without a reload.
  if (dismissed || savedJustNow) return null

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const result = await updateMyDemographics({
        gender: gender ?? null,
        age_range: ageRange ?? null,
      })
      if (!result.success) {
        setError(result.error ?? 'Something went wrong. Try again.')
        return
      }
      setSavedJustNow(true)
    })
  }

  return (
    <section
      role="region"
      aria-label="Help us keep events balanced"
      className="relative rounded-xl border border-gold/20 border-l-4 border-l-gold bg-bg-card p-4 sm:p-5"
    >
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="absolute right-2 top-2 inline-flex h-11 w-11 items-center justify-center text-text-tertiary transition-colors hover:text-text-primary"
        aria-label="Dismiss banner"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>

      <div className="flex items-start gap-3 pr-10">
        <Users className="mt-0.5 h-5 w-5 flex-shrink-0 text-gold" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-text-primary">
            Help us keep events balanced
          </p>
          <p className="mt-1 text-xs text-text-secondary">
            Optional, only visible to the team. Two short questions to help us
            keep the room a balanced cross-section of the community.
          </p>

          {!expanded ? (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-gold underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50 focus-visible:rounded"
            >
              Add details
              <ChevronDown className="h-4 w-4" aria-hidden />
            </button>
          ) : (
            <form onSubmit={handleSubmit} className="mt-4 space-y-4">
              {/* Gender — radio chip group */}
              <fieldset>
                <legend className="mb-2 block text-xs font-medium text-text-secondary">
                  How do you describe your gender?
                </legend>
                <div className="flex flex-wrap gap-2" role="radiogroup">
                  {GENDER_OPTIONS.map((opt) => {
                    const selected = gender === opt.value
                    return (
                      <label
                        key={opt.value}
                        className={[
                          'inline-flex min-h-[44px] cursor-pointer items-center rounded-full border px-4 text-sm font-medium transition-colors',
                          selected
                            ? 'border-gold bg-gold/10 text-text-primary'
                            : 'border-border bg-transparent text-text-secondary hover:border-gold/40 hover:text-text-primary',
                        ].join(' ')}
                      >
                        <input
                          type="radio"
                          name="gender"
                          value={opt.value}
                          checked={selected}
                          onChange={() => setGender(opt.value)}
                          className="sr-only"
                        />
                        {opt.label}
                      </label>
                    )
                  })}
                </div>
              </fieldset>

              {/* Age range — same chip pattern, single-select */}
              <fieldset>
                <legend className="mb-2 block text-xs font-medium text-text-secondary">
                  Which age band fits you?
                </legend>
                <div className="flex flex-wrap gap-2" role="radiogroup">
                  {AGE_RANGE_OPTIONS.map((opt) => {
                    const selected = ageRange === opt.value
                    return (
                      <label
                        key={opt.value}
                        className={[
                          'inline-flex min-h-[44px] min-w-[64px] cursor-pointer items-center justify-center rounded-full border px-4 text-sm font-medium transition-colors',
                          selected
                            ? 'border-gold bg-gold/10 text-text-primary'
                            : 'border-border bg-transparent text-text-secondary hover:border-gold/40 hover:text-text-primary',
                        ].join(' ')}
                      >
                        <input
                          type="radio"
                          name="age_range"
                          value={opt.value}
                          checked={selected}
                          onChange={() => setAgeRange(opt.value)}
                          className="sr-only"
                        />
                        {opt.label}
                      </label>
                    )
                  })}
                </div>
              </fieldset>

              {error && (
                <p
                  role="alert"
                  className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger"
                >
                  {error}
                </p>
              )}

              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
                <button
                  type="button"
                  onClick={() => setDismissed(true)}
                  className="inline-flex min-h-[44px] items-center justify-center rounded-full border border-border bg-transparent px-5 text-sm font-medium text-text-primary transition-colors hover:bg-bg-secondary"
                >
                  Not now
                </button>
                <button
                  type="submit"
                  disabled={isPending || (gender === null && ageRange === null)}
                  className="inline-flex min-h-[44px] items-center justify-center rounded-full bg-gold px-6 text-sm font-medium text-white transition-colors hover:bg-gold-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isPending ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </section>
  )
}
