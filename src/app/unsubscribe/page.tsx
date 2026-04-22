import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { CheckCircle2, AlertTriangle } from 'lucide-react'
import {
  confirmUnsubscribe,
  previewUnsubscribe,
} from './actions'

export const metadata: Metadata = {
  title: 'Unsubscribe · The Social Seen',
  description:
    'Confirm unsubscribe from The Social Seen emails. You can update your preferences from your profile at any time.',
  robots: {
    // Don't index unsubscribe confirmation pages — they only make sense
    // when arrived at via a signed token from an email.
    index: false,
    follow: false,
  },
}

/**
 * Unsubscribe landing — two-step flow:
 *
 *   GET  → verifies the token, renders a confirmation form.
 *          Does NOT mutate. This matters because email security
 *          scanners (Outlook ATP, Proofpoint, Mimecast, Gmail image
 *          proxies) routinely prefetch every link in an email to
 *          detonate for phishing — they'd silently unsubscribe users
 *          if a GET flipped the preference.
 *   POST → actually flips the preference, via `confirmUnsubscribe()`.
 *          Scanners don't issue POSTs; a human click does.
 *
 * Success / error state on the form POST is rendered via a redirect
 * back to this page with ?done=1 / ?done=0 so the URL reflects the
 * final state (and is shareable / refresh-safe).
 */
export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string; done?: string; cat?: string }>
}) {
  const { t, done, cat } = await searchParams

  // Post-submission: render success (or failure) without re-checking
  // the token. `cat` carries the category label forward so the success
  // copy is specific.
  if (done === '1') {
    return (
      <FinalState
        ok
        categoryLabel={cat ? decodeURIComponent(cat) : 'these emails'}
      />
    )
  }
  if (done === '0') {
    return (
      <FinalState
        ok={false}
        message={
          cat
            ? decodeURIComponent(cat)
            : 'Something went wrong. Please try again shortly.'
        }
      />
    )
  }

  // Initial GET — show the confirmation form. No DB mutation.
  const preview = await previewUnsubscribe(t ?? '')

  // The POST action. 'use server' is required inline because this is
  // defined inside a Server Component.
  async function submit(formData: FormData) {
    'use server'
    const token = (formData.get('t') as string | null) ?? ''
    const result = await confirmUnsubscribe(token)
    if (result.success) {
      redirect(
        `/unsubscribe?done=1&cat=${encodeURIComponent(result.categoryLabel)}`,
      )
    }
    redirect(
      `/unsubscribe?done=0&cat=${encodeURIComponent(result.message)}`,
    )
  }

  return (
    <main className="min-h-screen bg-bg-primary pt-24 pb-16 sm:pt-28">
      <div className="mx-auto max-w-xl px-4 sm:px-6 lg:px-8">
        <div className="rounded-xl border border-border bg-bg-card p-8 shadow-sm">
          {preview.ok ? (
            <>
              <h1 className="mb-3 font-serif text-2xl text-text-primary">
                Unsubscribe from {preview.categoryLabel}?
              </h1>
              <p className="mb-6 text-sm text-text-secondary">
                Confirm below to turn these off. Transactional emails
                (booking confirmations, venue reveals, event reminders)
                will still send — they&rsquo;re part of the service
                you&rsquo;ve booked.
              </p>
              <form action={submit} className="flex flex-col gap-3 sm:flex-row">
                <input type="hidden" name="t" value={t ?? ''} />
                <button
                  type="submit"
                  className="inline-flex items-center justify-center rounded-full bg-gold px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-gold-hover min-h-[44px]"
                >
                  Unsubscribe me
                </button>
                <Link
                  href="/profile"
                  className="inline-flex items-center justify-center rounded-full border border-border px-6 py-3 text-sm font-medium text-text-primary transition-colors hover:border-gold hover:text-gold min-h-[44px]"
                >
                  Keep emails, go to profile
                </Link>
              </form>
              <p className="mt-6 text-xs text-text-tertiary">
                You can flip this back on any time from your profile.
              </p>
            </>
          ) : (
            <>
              <div className="mb-4 flex items-center gap-3">
                <AlertTriangle className="h-6 w-6 text-[color:var(--color-danger)]" />
                <h1 className="font-serif text-2xl text-text-primary">
                  We couldn&rsquo;t verify that link.
                </h1>
              </div>
              <p className="text-sm text-text-secondary">{preview.message}</p>
              <p className="mt-4 text-sm text-text-secondary">
                You can update email preferences directly on your{' '}
                <Link
                  href="/profile"
                  className="text-gold underline underline-offset-2 hover:text-gold-hover"
                >
                  profile page
                </Link>{' '}
                after signing in.
              </p>
            </>
          )}
        </div>
      </div>
    </main>
  )
}

interface FinalStateProps {
  ok: boolean
  categoryLabel?: string
  message?: string
}

function FinalState({ ok, categoryLabel, message }: FinalStateProps) {
  return (
    <main className="min-h-screen bg-bg-primary pt-24 pb-16 sm:pt-28">
      <div className="mx-auto max-w-xl px-4 sm:px-6 lg:px-8">
        <div className="rounded-xl border border-border bg-bg-card p-8 shadow-sm">
          {ok ? (
            <>
              <div className="mb-4 flex items-center gap-3">
                <CheckCircle2 className="h-6 w-6 text-[color:var(--color-success)]" />
                <h1 className="font-serif text-2xl text-text-primary">
                  You&rsquo;re unsubscribed.
                </h1>
              </div>
              <p className="text-sm text-text-secondary">
                We&rsquo;ve turned off {categoryLabel} for your account.
                You&rsquo;ll still receive transactional emails (booking
                confirmations, venue reveals, event reminders) because
                those are part of the service you&rsquo;ve booked.
              </p>
              <p className="mt-4 text-sm text-text-secondary">
                Change your mind? Update preferences any time from your{' '}
                <Link
                  href="/profile"
                  className="text-gold underline underline-offset-2 hover:text-gold-hover"
                >
                  profile page
                </Link>
                .
              </p>
            </>
          ) : (
            <>
              <div className="mb-4 flex items-center gap-3">
                <AlertTriangle className="h-6 w-6 text-[color:var(--color-danger)]" />
                <h1 className="font-serif text-2xl text-text-primary">
                  We couldn&rsquo;t process that.
                </h1>
              </div>
              <p className="text-sm text-text-secondary">
                {message ?? 'Something went wrong. Please try again shortly.'}
              </p>
              <p className="mt-4 text-sm text-text-secondary">
                You can update email preferences directly on your{' '}
                <Link
                  href="/profile"
                  className="text-gold underline underline-offset-2 hover:text-gold-hover"
                >
                  profile page
                </Link>{' '}
                after signing in.
              </p>
            </>
          )}
        </div>
      </div>
    </main>
  )
}
