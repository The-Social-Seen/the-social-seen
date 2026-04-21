'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { Mail, X } from 'lucide-react'
import { cn } from '@/lib/utils/cn'

interface VerifyPromptModalProps {
  isOpen: boolean
  onClose: () => void
}

/**
 * Small modal shown when an unverified user clicks "Book". Does NOT trigger
 * the OTP send here — we defer that to the /verify page so the user has a
 * single place to land that handles the full flow. The "Verify now" button
 * is a navigation link (no Server Action on click), keeping this component
 * presentational.
 */
export function VerifyPromptModal({ isOpen, onClose }: VerifyPromptModalProps) {
  const pathname = usePathname()

  // Escape key closes — matches the BookingModal pattern.
  useEffect(() => {
    if (!isOpen) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [isOpen, onClose])

  // Lock body scroll while open.
  useEffect(() => {
    if (!isOpen) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [isOpen])

  const verifyHref = `/verify?from=${encodeURIComponent(pathname ?? '/events')}`

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="fixed inset-0 z-50 bg-charcoal/40 backdrop-blur-sm"
            aria-hidden="true"
          />

          {/* Panel */}
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="verify-prompt-title"
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.96 }}
            transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
            className={cn(
              'fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md',
              '-translate-x-1/2 -translate-y-1/2',
              'rounded-2xl border border-border bg-bg-card p-6 shadow-2xl shadow-charcoal/20 md:p-8',
            )}
          >
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className={cn(
                'absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full text-text-tertiary',
                'transition-colors hover:bg-bg-secondary hover:text-text-primary',
              )}
            >
              <X className="h-4 w-4" />
            </button>

            <div className="text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-gold/10">
                <Mail className="h-5 w-5 text-gold" aria-hidden="true" />
              </div>
              <h2
                id="verify-prompt-title"
                className="font-serif text-2xl font-bold text-text-primary"
              >
                Verify Your Email to Book
              </h2>
              <p className="mt-3 text-sm text-text-secondary">
                We need to confirm your email before you can book events. It
                takes about 30 seconds.
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
                <button
                  type="button"
                  onClick={onClose}
                  className={cn(
                    'rounded-full border border-border bg-bg-card px-6 py-3 text-sm font-medium text-text-primary transition-all',
                    'hover:bg-bg-secondary',
                  )}
                >
                  Cancel
                </button>
                <Link
                  href={verifyHref}
                  className={cn(
                    'rounded-full bg-gold px-8 py-3 text-sm font-semibold text-white transition-all',
                    'hover:bg-gold-dark hover:shadow-lg hover:shadow-gold/25',
                  )}
                  data-source="modal"
                >
                  Verify now
                </Link>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
