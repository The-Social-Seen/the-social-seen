'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

/**
 * Mounted in the root layout. If the URL carries `?account_deleted=1`
 * (set when the user deletes their own account and is redirected to `/`),
 * show a one-off toast confirming the closure and strip the param via
 * `router.replace` so a refresh doesn't re-fire. Mirrors
 * `BookingCancelledHandler` but layout-scoped, not page-scoped.
 */
export default function AccountDeletedHandler() {
  const router = useRouter()
  const sp = useSearchParams()
  const [showToast, setShowToast] = useState(false)

  useEffect(() => {
    if (sp.get('account_deleted') !== '1') return

    setShowToast(true)
    const url = new URL(window.location.href)
    url.searchParams.delete('account_deleted')
    router.replace(url.pathname + (url.search || ''))

    const timer = window.setTimeout(() => setShowToast(false), 5000)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!showToast) return null

  return (
    <div
      role="status"
      className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full border border-blush/60 bg-bg-card px-5 py-3 text-sm text-text-primary shadow-lg"
    >
      Your account has been closed. Thank you for being part of The Social Seen.
    </div>
  )
}
