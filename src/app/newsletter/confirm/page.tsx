import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { CheckCircle2, AlertTriangle } from 'lucide-react'
import {
  confirmNewsletter,
  previewNewsletterConfirm,
} from '../actions'

export const metadata: Metadata = {
  title: 'Confirm newsletter · The Social Seen',
  description:
    'Confirm your newsletter signup. Two-step to keep email security scanners from auto-confirming.',
  robots: { index: false, follow: false },
}

/**
 * Two-step confirm flow. GET render = preview only (verify token,
 * show a button); POST = actual flip + Brevo sync. Same pattern as
 * /unsubscribe (Batch 2) — email security scanners prefetch links,
 * so a single-GET confirm would let them silently opt users in.
 * Requiring an explicit human POST guards against that.
 */
export default async function NewsletterConfirmPage({
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

  const preview = await previewNewsletterConfirm(t ?? '')

  async function submit(formData: FormData) {
    'use server'
    const token = (formData.get('t') as string | null) ?? ''
    const result = await confirmNewsletter(token)
    redirect(
      result.success ? '/newsletter/confirm?done=1' : '/newsletter/confirm?done=0',
    )
  }

  return (
    <main className="min-h-screen bg-bg-primary pt-24 pb-16 sm:pt-28">
      <div className="mx-auto max-w-xl px-4 sm:px-6 lg:px-8">
        <div className="rounded-xl border border-border bg-bg-card p-8 shadow-sm">
          {preview.ok ? (
            <>
              <h1 className="mb-3 font-serif text-2xl text-text-primary">
                Confirm your subscription?
              </h1>
              <p className="mb-6 text-sm text-text-secondary">
                You&rsquo;re about to subscribe{' '}
                <span className="font-medium text-text-primary">
                  {preview.email}
                </span>{' '}
                to the Social Seen newsletter. One click to confirm, never more
                than a couple of emails a month.
              </p>
              <form action={submit} className="flex flex-col gap-3 sm:flex-row">
                <input type="hidden" name="t" value={t ?? ''} />
                <button
                  type="submit"
                  className="inline-flex items-center justify-center rounded-full bg-gold px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-gold-hover min-h-[44px]"
                >
                  Yes, subscribe me
                </button>
                <Link
                  href="/"
                  className="inline-flex items-center justify-center rounded-full border border-border px-6 py-3 text-sm font-medium text-text-primary transition-colors hover:border-gold hover:text-gold min-h-[44px]"
                >
                  Not me, go back
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
                  You&rsquo;re in.
                </h1>
              </div>
              <p className="text-sm text-text-secondary">
                Welcome to the Social Seen newsletter. First edition will
                land in your inbox soon.
              </p>
              <p className="mt-4 text-sm text-text-secondary">
                In the meantime, check out{' '}
                <Link
                  href="/events"
                  className="text-gold underline underline-offset-2 hover:text-gold-hover"
                >
                  what&rsquo;s coming up
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
                Please try signing up again from the footer — if it keeps
                failing, drop us a line via{' '}
                <Link
                  href="/contact"
                  className="text-gold underline underline-offset-2 hover:text-gold-hover"
                >
                  the contact page
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
