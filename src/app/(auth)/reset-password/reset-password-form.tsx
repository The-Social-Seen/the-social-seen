'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { Eye, EyeOff, CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { track } from '@/lib/analytics/track'
import { updatePassword } from '../actions'

const REDIRECT_DELAY_MS = 2000

export function ResetPasswordForm() {
  const router = useRouter()

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [errors, setErrors] = useState<{
    password?: string
    confirm?: string
    server?: string
  }>({})
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [linkExpired, setLinkExpired] = useState(false)

  // Auto-redirect to login after success
  useEffect(() => {
    if (!success) return
    const timer = setTimeout(() => {
      router.push('/login')
    }, REDIRECT_DELAY_MS)
    return () => clearTimeout(timer)
  }, [success, router])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    const nextErrors: typeof errors = {}

    if (!password || password.length < 8) {
      nextErrors.password = 'Password must be at least 8 characters'
    }
    if (password !== confirmPassword) {
      nextErrors.confirm = 'Passwords don\u2019t match'
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors)
      return
    }

    setErrors({})
    setLoading(true)

    const result = await updatePassword({ password })

    setLoading(false)

    if ('error' in result) {
      if (result.error.toLowerCase().includes('expired')) {
        setLinkExpired(true)
        return
      }
      setErrors({ server: result.error })
      return
    }

    track('password_reset_completed', {})
    setSuccess(true)
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
          {success ? (
            <div className="text-center">
              <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-gold/10">
                <CheckCircle2
                  className="h-7 w-7 text-gold"
                  aria-hidden="true"
                />
              </div>
              <h1 className="font-serif text-2xl font-bold text-text-primary">
                Password Updated
              </h1>
              <p className="mt-3 text-sm text-text-secondary">
                You can now sign in with your new password. Redirecting you to
                the sign-in page…
              </p>
              <Link
                href="/login"
                className="mt-8 inline-flex w-full items-center justify-center rounded-full bg-gold px-8 py-3 text-sm font-semibold text-white transition-all hover:bg-gold-dark hover:shadow-lg hover:shadow-gold/25"
              >
                Sign in now
              </Link>
            </div>
          ) : linkExpired ? (
            <div className="text-center">
              <h1 className="font-serif text-2xl font-bold text-text-primary">
                Link Expired
              </h1>
              <p className="mt-3 text-sm text-text-secondary">
                Your password reset link has expired. Request a new one to
                continue.
              </p>
              <Link
                href="/forgot-password"
                className="mt-8 inline-flex w-full items-center justify-center rounded-full bg-gold px-8 py-3 text-sm font-semibold text-white transition-all hover:bg-gold-dark hover:shadow-lg hover:shadow-gold/25"
              >
                Request a new link
              </Link>
            </div>
          ) : (
            <>
              <div className="mb-8 text-center">
                <h1 className="font-serif text-3xl font-bold text-text-primary">
                  Reset Your Password
                </h1>
                <p className="mt-2 text-sm text-text-secondary">
                  Enter a new password below. At least 8 characters.
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-5">
                {/* New password */}
                <div className="space-y-1.5">
                  <label
                    htmlFor="new-password"
                    className="block text-sm font-medium text-text-secondary"
                  >
                    New password
                  </label>
                  <div className="relative">
                    <input
                      id="new-password"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="At least 8 characters"
                      autoComplete="new-password"
                      className={cn(
                        'w-full rounded-xl border bg-bg-card px-4 py-3 pr-11 text-sm text-text-primary outline-none transition-all',
                        'placeholder:text-text-tertiary focus:border-border-focus focus:ring-2 focus:ring-gold/20',
                        errors.password
                          ? 'border-danger ring-2 ring-danger/10'
                          : 'border-border',
                      )}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      aria-label={
                        showPassword ? 'Hide password' : 'Show password'
                      }
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-text-tertiary transition-colors hover:text-text-secondary"
                    >
                      {showPassword ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                  {errors.password && (
                    <p className="text-xs text-danger">{errors.password}</p>
                  )}
                </div>

                {/* Confirm password */}
                <div className="space-y-1.5">
                  <label
                    htmlFor="confirm-password"
                    className="block text-sm font-medium text-text-secondary"
                  >
                    Confirm new password
                  </label>
                  <div className="relative">
                    <input
                      id="confirm-password"
                      type={showConfirmPassword ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Re-enter your new password"
                      autoComplete="new-password"
                      className={cn(
                        'w-full rounded-xl border bg-bg-card px-4 py-3 pr-11 text-sm text-text-primary outline-none transition-all',
                        'placeholder:text-text-tertiary focus:border-border-focus focus:ring-2 focus:ring-gold/20',
                        errors.confirm
                          ? 'border-danger ring-2 ring-danger/10'
                          : 'border-border',
                      )}
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setShowConfirmPassword(!showConfirmPassword)
                      }
                      aria-label={
                        showConfirmPassword
                          ? 'Hide confirm password'
                          : 'Show confirm password'
                      }
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-text-tertiary transition-colors hover:text-text-secondary"
                    >
                      {showConfirmPassword ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                  {errors.confirm && (
                    <p className="text-xs text-danger">{errors.confirm}</p>
                  )}
                </div>

                {errors.server && (
                  <p className="text-center text-xs text-danger">
                    {errors.server}
                  </p>
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
                  {loading ? 'Updating…' : 'Update Password'}
                </button>
              </form>
            </>
          )}
        </div>
      </motion.div>
    </div>
  )
}
