import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { CheckCircle2, AlertTriangle } from 'lucide-react'
import {
  confirmNewsletterUnsubscribe,
  previewNewsletterUnsubscribe,
} from '../actions'

export const metadata: Metadata = {
  title: 'Unsubscribe newsletter · The Social Seen',
  description:
    'Unsubscribe from the Social Seen newsletter. You can update your preferences from your profile at any time.',
  robots: { index: false, follow: false },
}

/**
 * Same two-step pattern as /unsubscribe (Batch 2) — GET previews,
 * POST mutates. Scanner-safe.
 */
export default async function NewsletterUnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string; done?: string }>
}) {
  const { t, done } = await searchParams

  if (done === '1') {
    return <FinalState ok />
  }
  if (done === '0') {
    return <FinalState ok={false} />
  }

  const preview = await previewNewsletterUnsubscribe(t ?? '')

  async function submit(formData: FormData) {
    'use server'
    const token = (formData.get('t') as string | null) ?? ''
    const result = await confirmNewsletterUnsubscribe(token)
    redirect(
      result.success
        ? '/newsletter/unsubscribe?done=1'
        : '/newsletter/unsubscribe?done=0',
    )
  }

  return (
    <main className="min-h-screen bg-bg-primary pt-24 pb-16 sm:pt-28">
      <div className="mx-auto max-w-xl px-4 sm:px-6 lg:px-8">
        <div className="rounded-xl border border-border bg-bg-card p-8 shadow-sm">
          {preview.ok ? (
            <>
              <h1 className="mb-3 font-serif text-2xl text-text-primary">
                Unsubscribe from the newsletter?
              </h1>
              <p className="mb-6 text-sm text-text-secondary">
                Confirm below to stop newsletter emails to{' '}
                <span className="font-medium text-text-primary">
                  {preview.email}
                </span>
                . Transactional emails (booking confirmations, venue reveals,
                reminders) still send — they&rsquo;re tied to events you book.
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
                  href="/"
                  className="inline-flex items-center justify-center rounded-full border border-border px-6 py-3 text-sm font-medium text-text-primary transition-colors hover:border-gold hover:text-gold min-h-[44px]"
                >
                  Keep me subscribed
                </Link>
              </form>
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
            </>
          )}
        </div>
      </div>
    </main>
  )
}

function FinalState({ ok }: { ok: boolean }) {
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
                No more newsletter emails. Transactional emails tied to events
                you&rsquo;ve booked (confirmations, venue reveals, reminders)
                still send.
              </p>
              <p className="mt-4 text-sm text-text-secondary">
                Change your mind? Sign in and flip newsletter back on from
                your{' '}
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
                  Something went wrong.
                </h1>
              </div>
              <p className="text-sm text-text-secondary">
                Please try the link again or{' '}
                <Link
                  href="/contact"
                  className="text-gold underline underline-offset-2 hover:text-gold-hover"
                >
                  contact us
                </Link>
                .
              </p>
            </>
          )}
        </div>
      </div>
    </main>
  )
}
