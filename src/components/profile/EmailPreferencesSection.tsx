'use client'

import { useState, useTransition } from 'react'
import { Mail, Check } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import {
  updateEmailPreference,
  type EmailPreferences,
} from '@/app/(member)/profile/preferences-actions'
import type { NotificationCategory } from '@/lib/email/unsubscribe-token'

interface EmailPreferencesSectionProps {
  initial: EmailPreferences
}

interface ToggleRow {
  category: NotificationCategory
  title: string
  blurb: string
}

const ROWS: ToggleRow[] = [
  {
    category: 'review_requests',
    title: 'Post-event review requests',
    blurb:
      'A short email the day after an event you attended, asking how it went.',
  },
  {
    category: 'profile_nudges',
    title: 'Profile-completion reminders',
    blurb:
      'One email sent a few days after signup if your profile is less than half complete.',
  },
  {
    category: 'admin_announcements',
    title: 'Admin announcements',
    blurb:
      'Occasional broadcasts from the team about events, venue changes, or community updates.',
  },
]

export function EmailPreferencesSection({
  initial,
}: EmailPreferencesSectionProps) {
  const [values, setValues] = useState<EmailPreferences>(initial)
  const [isPending, startTransition] = useTransition()
  const [savedFlash, setSavedFlash] = useState<NotificationCategory | null>(null)
  const [error, setError] = useState<string | null>(null)

  function handleToggle(category: NotificationCategory) {
    const next = !values[category]
    // Optimistic flip — rollback on error.
    setValues((prev) => ({ ...prev, [category]: next }))
    setError(null)

    startTransition(async () => {
      const result = await updateEmailPreference(category, next)
      if (!result.success) {
        setValues((prev) => ({ ...prev, [category]: !next }))
        setError(result.error)
        return
      }
      setSavedFlash(category)
      setTimeout(() => setSavedFlash((c) => (c === category ? null : c)), 1500)
    })
  }

  return (
    <section
      aria-labelledby="email-prefs-heading"
      className="rounded-xl border border-border bg-bg-card p-6"
    >
      <div className="mb-4 flex items-start gap-3">
        <Mail className="h-5 w-5 flex-shrink-0 text-gold" aria-hidden="true" />
        <div>
          <h2
            id="email-prefs-heading"
            className="font-serif text-lg text-text-primary"
          >
            Email preferences
          </h2>
          <p className="mt-1 text-sm text-text-secondary">
            Choose what we email you. Booking confirmations, venue reveals,
            and event reminders always send — they&rsquo;re part of the
            service you&rsquo;ve booked.
          </p>
        </div>
      </div>

      {error && (
        <p className="mb-3 text-sm text-[color:var(--color-danger)]" role="alert">
          {error}
        </p>
      )}

      <ul className="divide-y divide-border">
        {ROWS.map(({ category, title, blurb }) => {
          const checked = values[category]
          const flashing = savedFlash === category
          return (
            <li
              key={category}
              className="flex items-start justify-between gap-4 py-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-text-primary">
                  {title}
                  {flashing && (
                    <span
                      className="ml-2 inline-flex items-center gap-1 text-xs font-normal text-[color:var(--color-success)]"
                      aria-live="polite"
                    >
                      <Check className="h-3 w-3" /> Saved
                    </span>
                  )}
                </p>
                <p className="mt-0.5 text-xs text-text-secondary">{blurb}</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={checked}
                aria-label={`${title} — ${checked ? 'on' : 'off'}`}
                disabled={isPending}
                onClick={() => handleToggle(category)}
                className={cn(
                  'relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors',
                  'disabled:cursor-not-allowed disabled:opacity-50',
                  checked ? 'bg-gold' : 'bg-border',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/50 focus-visible:ring-offset-2',
                )}
              >
                <span
                  className={cn(
                    'inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform',
                    checked ? 'translate-x-6' : 'translate-x-1',
                  )}
                />
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
