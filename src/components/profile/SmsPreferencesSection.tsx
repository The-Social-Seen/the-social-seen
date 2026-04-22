'use client'

import { useState, useTransition } from 'react'
import { MessageSquare, Check, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import {
  updateSmsConsent,
  type SmsPreferences,
} from '@/app/(member)/profile/preferences-actions'

interface SmsPreferencesSectionProps {
  initial: SmsPreferences
}

/**
 * Single-toggle SMS consent control. Separate from EmailPreferencesSection
 * because SMS consent is one master boolean (profiles.sms_consent),
 * unlike the per-category email preferences, and because the toggle must
 * be disabled when the user has no phone number on file.
 *
 * Matches the email-prefs visual language — same toggle style, same
 * "Saved" flash — so members see it as one unified preferences surface.
 */
export function SmsPreferencesSection({ initial }: SmsPreferencesSectionProps) {
  const [smsConsent, setSmsConsent] = useState(initial.sms_consent)
  const [isPending, startTransition] = useTransition()
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const hasPhoneNumber = Boolean(initial.phone_number)

  function handleToggle() {
    if (!hasPhoneNumber) return
    const next = !smsConsent
    setSmsConsent(next) // optimistic
    setError(null)

    startTransition(async () => {
      const result = await updateSmsConsent(next)
      if (!result.success) {
        setSmsConsent(!next)
        setError(result.error)
        return
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    })
  }

  return (
    <section
      aria-labelledby="sms-prefs-heading"
      className="rounded-xl border border-border bg-bg-card p-6"
    >
      <div className="mb-4 flex items-start gap-3">
        <MessageSquare
          className="h-5 w-5 flex-shrink-0 text-gold"
          aria-hidden="true"
        />
        <div>
          <h2
            id="sms-prefs-heading"
            className="font-serif text-lg text-text-primary"
          >
            SMS preferences
          </h2>
          <p className="mt-1 text-sm text-text-secondary">
            We only text for venue reveals (1 week before) and day-of
            reminders — never marketing. UK standard rates apply on
            inbound SMS; no charge from us.
          </p>
        </div>
      </div>

      {error && (
        <p
          className="mb-3 text-sm text-[color:var(--color-danger)]"
          role="alert"
        >
          {error}
        </p>
      )}

      <div className="flex items-start justify-between gap-4 py-1">
        <div className="min-w-0">
          <p className="text-sm font-medium text-text-primary">
            Text me venue reveals &amp; event reminders
            {saved && (
              <span
                className="ml-2 inline-flex items-center gap-1 text-xs font-normal text-[color:var(--color-success)]"
                aria-live="polite"
              >
                <Check className="h-3 w-3" /> Saved
              </span>
            )}
          </p>
          {hasPhoneNumber ? (
            <p className="mt-0.5 text-xs text-text-secondary">
              Delivered from <span className="font-mono">SocialSeen</span>.
              Turn off any time here; SMS stops immediately.
            </p>
          ) : (
            <p className="mt-1 inline-flex items-start gap-1.5 rounded-lg border border-gold/30 bg-gold/5 px-2.5 py-1.5 text-xs text-text-primary">
              <AlertCircle className="mt-0.5 h-3 w-3 flex-shrink-0 text-gold" />
              Add a phone number via &ldquo;Edit profile&rdquo; to enable
              SMS.
            </p>
          )}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={smsConsent}
          aria-label={`SMS reminders — ${smsConsent ? 'on' : 'off'}`}
          disabled={isPending || !hasPhoneNumber}
          onClick={handleToggle}
          className={cn(
            'relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors',
            'disabled:cursor-not-allowed disabled:opacity-50',
            smsConsent ? 'bg-gold' : 'bg-border',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/50 focus-visible:ring-offset-2',
          )}
        >
          <span
            className={cn(
              'inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform',
              smsConsent ? 'translate-x-6' : 'translate-x-1',
            )}
          />
        </button>
      </div>
    </section>
  )
}
