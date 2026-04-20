'use client'

import { useState } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { ArrowLeft, CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { track } from '@/lib/analytics/track'
import { requestPasswordReset } from '../actions'

export function ForgotPasswordForm() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (!email.trim()) {
      setError('Please enter your email address')
      return
    }

    setError(null)
    setLoading(true)

    const result = await requestPasswordReset({ email: email.trim() })

    setLoading(false)

    if ('error' in result) {
      setError(result.error)
      return
    }

    track('password_reset_requested', {})
    setSubmitted(true)
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-bg-primary">
      {/* Decorative blurs */}
      <div className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-gold/10 blur-3xl" />
      <div className="absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-blush/20 blur-3xl" />

      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] }}
        className="relative z-10 w-full max-w-md px-6"
      >
        {/* Logo */}
        <div className="mb-10 text-center">
          <Link
            href="/"
            className="font-serif text-2xl font-bold text-text-primary"
          >
            The Social Seen
          </Link>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-border bg-bg-card p-8 shadow-xl shadow-charcoal/5 md:p-10">
          {submitted ? (
            <div className="text-center">
              <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-gold/10">
                <CheckCircle2 className="h-7 w-7 text-gold" aria-hidden="true" />
              </div>
              <h1 className="font-serif text-2xl font-bold text-text-primary">
                Check Your Inbox
              </h1>
              <p className="mt-3 text-sm text-text-secondary">
                If that email is registered, we&apos;ve sent a reset link. Check
                your inbox — the link expires in 1 hour.
              </p>
              <Link
                href="/login"
                className="mt-8 inline-flex w-full items-center justify-center rounded-full bg-gold px-8 py-3 text-sm font-semibold text-white transition-all hover:bg-gold-dark hover:shadow-lg hover:shadow-gold/25"
              >
                Back to sign in
              </Link>
              <p className="mt-4 text-xs text-text-tertiary">
                Didn&apos;t get the email? Check your spam folder, or{' '}
                <button
                  type="button"
                  onClick={() => {
                    setSubmitted(false)
                    setEmail('')
                  }}
                  className="font-medium text-gold transition-colors hover:text-gold-dark"
                >
                  try again
                </button>
                .
              </p>
            </div>
          ) : (
            <>
              <div className="mb-8 text-center">
                <h1 className="font-serif text-3xl font-bold text-text-primary">
                  Forgot Password?
                </h1>
                <p className="mt-2 text-sm text-text-secondary">
                  Enter your email and we&apos;ll send you a link to reset your
                  password.
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-5">
                {/* Email */}
                <div className="space-y-1.5">
                  <label
                    htmlFor="forgot-email"
                    className="block text-sm font-medium text-text-secondary"
                  >
                    Email Address
                  </label>
                  <input
                    id="forgot-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    autoComplete="email"
                    autoFocus
                    className={cn(
                      'w-full rounded-xl border bg-bg-card px-4 py-3 text-sm text-text-primary outline-none transition-all',
                      'placeholder:text-text-tertiary focus:border-border-focus focus:ring-2 focus:ring-gold/20',
                      error ? 'border-danger ring-2 ring-danger/10' : 'border-border',
                    )}
                  />
                </div>

                {/* Error message */}
                {error && (
                  <p className="text-center text-xs text-danger">{error}</p>
                )}

                {/* Submit */}
                <button
                  type="submit"
                  disabled={loading}
                  className={cn(
                    'w-full rounded-full bg-gold px-8 py-3 text-sm font-semibold text-white transition-all',
                    'hover:bg-gold-dark hover:shadow-lg hover:shadow-gold/25',
                    'disabled:cursor-not-allowed disabled:opacity-60',
                  )}
                >
                  {loading ? 'Sending…' : 'Send Reset Link'}
                </button>
              </form>
            </>
          )}
        </div>

        {/* Footer */}
        {!submitted && (
          <p className="mt-8 text-center text-sm text-text-tertiary">
            <Link
              href="/login"
              className="inline-flex items-center gap-1.5 font-medium text-gold transition-colors hover:text-gold-dark"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to sign in
            </Link>
          </p>
        )}
      </motion.div>
    </div>
  )
}
