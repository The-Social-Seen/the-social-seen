'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { MailWarning, X } from 'lucide-react'
import { cn } from '@/lib/utils/cn'

const DISMISS_STORAGE_KEY = 'unverified-banner-dismissed'

/**
 * A soft-gold strip reminding logged-in, unverified users to verify their
 * email before booking. Dismissable for the current browser session only —
 * reappears on next tab open (sessionStorage, not localStorage).
 *
 * Only renders when `verified === false`. Verified users and non-members
 * should see nothing (parent layout controls this).
 */
interface UnverifiedBannerProps {
  verified: boolean
}

export function UnverifiedBanner({ verified }: UnverifiedBannerProps) {
  const pathname = usePathname()
  const [dismissed, setDismissed] = useState(false)
  // Start hidden on the server so SSR markup matches an anonymous client;
  // we'll reveal (or keep hidden) on mount once sessionStorage is readable.
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    // Mount-only sync of sessionStorage. We deliberately render `null` on
    // both server and client first paint to avoid hydration mismatch when
    // the user has dismissed in another tab; this effect then reveals the
    // banner (or keeps it hidden) on the second paint.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true)
    if (typeof window === 'undefined') return
    const stored = sessionStorage.getItem(DISMISS_STORAGE_KEY)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (stored === '1') setDismissed(true)
  }, [])

  if (verified) return null
  if (!mounted) return null
  if (dismissed) return null

  function handleDismiss() {
    setDismissed(true)
    try {
      sessionStorage.setItem(DISMISS_STORAGE_KEY, '1')
    } catch {
      // Some browsers block sessionStorage in private mode — fail silently.
    }
  }

  // `source=banner` propagates to the verify-form auto-send so PostHog
   // can attribute which surface (banner vs modal vs direct) drove the
   // verification request. Matches the schema in track.ts.
  const verifyHref = `/verify?from=${encodeURIComponent(pathname ?? '/events')}&source=banner`

  // Top margin matches the fixed Header's height (h-16 mobile, sm:h-20 desktop
  // in src/components/layout/Header.tsx). Without this the banner would render
  // at flow position 0 and disappear behind the fixed header.
  return (
    <div
      role="status"
      className={cn(
        'relative w-full border-b border-gold/20 bg-gold/10',
        'text-text-primary',
        'mt-16 sm:mt-20',
      )}
    >
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
        <MailWarning
          className="h-5 w-5 shrink-0 text-gold"
          aria-hidden="true"
        />
        <p className="flex-1 text-sm">
          <span className="font-medium">Verify your email</span> to book events.
        </p>
        <Link
          href={verifyHref}
          className={cn(
            'inline-flex shrink-0 items-center justify-center rounded-full bg-gold px-4 py-1.5 text-xs font-semibold text-white transition-all',
            'hover:bg-gold-dark hover:shadow-md hover:shadow-gold/20',
          )}
          data-source="banner"
        >
          Verify now
        </Link>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss banner"
          className={cn(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-text-tertiary',
            'transition-colors hover:bg-gold/10 hover:text-text-primary',
          )}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
