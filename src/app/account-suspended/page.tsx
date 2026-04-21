import Link from 'next/link'
import { AlertCircle } from 'lucide-react'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Account closed — The Social Seen',
  robots: { index: false, follow: false },
}

/**
 * Landing page for banned accounts after middleware sign-out.
 *
 * Intentionally light on detail — we don't expose the reason or the
 * moderator's identity. Members in doubt are directed to email us so we
 * can review case-by-case.
 *
 * Unauthenticated: we don't gate this page on auth because the
 * middleware has just signed them out. The URL is the signal.
 */
export default function AccountSuspendedPage() {
  return (
    <main className="mx-auto max-w-lg px-6 py-20">
      <div className="rounded-2xl border border-blush/40 bg-bg-card p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-danger/10">
          <AlertCircle className="h-7 w-7 text-danger" aria-hidden="true" />
        </div>
        <h1 className="font-serif text-2xl font-bold text-text-primary">
          Your account is no longer active.
        </h1>
        <p className="mt-3 text-sm text-text-primary/70">
          If you believe this is a mistake, email us at
          {' '}
          <a
            href="mailto:info@the-social-seen.com"
            className="font-medium text-gold hover:text-gold-hover"
          >
            info@the-social-seen.com
          </a>
          {' '}
          and we&rsquo;ll take another look.
        </p>
        <div className="mt-8">
          <Link
            href="/"
            className="rounded-full border border-blush/60 px-6 py-2.5 text-sm font-medium text-text-primary transition-colors hover:bg-bg-primary"
          >
            Back to home
          </Link>
        </div>
      </div>
    </main>
  )
}
