/* Google brand colours — exempt from hex token rule per brand guidelines */
'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { motion } from 'framer-motion'
import { Eye, EyeOff } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { signIn } from '../actions'

export function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const rawRedirect = searchParams.get('redirect')
  const redirectTo =
    rawRedirect &&
    rawRedirect.startsWith('/') &&
    !rawRedirect.startsWith('//') &&
    !rawRedirect.startsWith('\\/') &&
    !rawRedirect.includes('://')
      ? rawRedirect
      : '/events'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (!email.trim() || !password.trim()) {
      setError('Please enter your email and password')
      return
    }

    setError(null)
    setLoading(true)

    const result = await signIn({
      email: email.trim(),
      password,
      redirectTo,
    })

    if ('error' in result) {
      setError(result.error)
      setLoading(false)
      return
    }

    try {
      const { createClient } = await import("@/lib/supabase/client")
      const supabase = createClient()
      await supabase.auth.getUser()
    } catch {
      // Client-side sync failed — session still exists server-side
      // Header will pick up auth state on next page load
    }

    router.push(result.redirectTo)
    router.refresh()
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
          <Link href="/" className="font-serif text-2xl font-bold text-text-primary">
            The Social Seen
          </Link>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-border bg-bg-card p-8 shadow-xl shadow-charcoal/5 md:p-10">
          <div className="mb-8 text-center">
            <h1 className="font-serif text-3xl font-bold text-text-primary">
              Welcome Back
            </h1>
            <p className="mt-2 text-sm text-text-secondary">
              Sign in to access your events and community
            </p>
          </div>

          {/* Disabled Google OAuth button */}
          <div className="group relative mb-6">
            <button
              type="button"
              disabled
              className="flex w-full cursor-not-allowed items-center justify-center gap-3 rounded-full border border-border bg-bg-card px-4 py-3 text-sm font-medium text-text-tertiary opacity-60 transition-all"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
              </svg>
              Continue with Google
            </button>
            <div className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 rounded-lg bg-text-primary px-3 py-1.5 text-xs text-text-inverse opacity-0 transition-opacity group-hover:opacity-100">
              Coming soon
            </div>
          </div>

          {/* Divider */}
          <div className="relative mb-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center">
              <span className="bg-bg-card px-4 text-xs uppercase tracking-wider text-text-tertiary">
                or sign in with email
              </span>
            </div>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Email */}
            <div className="space-y-1.5">
              <label htmlFor="login-email" className="block text-sm font-medium text-text-secondary">
                Email Address
              </label>
              <input
                id="login-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                className={cn(
                  'w-full rounded-xl border bg-bg-card px-4 py-3 text-sm text-text-primary outline-none transition-all',
                  'placeholder:text-text-tertiary focus:border-border-focus focus:ring-2 focus:ring-gold/20',
                  error ? 'border-danger' : 'border-border'
                )}
              />
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label htmlFor="login-password" className="block text-sm font-medium text-text-secondary">
                  Password
                </label>
                <div className="group relative">
                  <button
                    type="button"
                    disabled
                    className="cursor-not-allowed text-xs text-text-tertiary"
                  >
                    Forgot password?
                  </button>
                  <div className="pointer-events-none absolute -top-8 right-0 rounded-lg bg-text-primary px-3 py-1.5 text-xs text-text-inverse opacity-0 transition-opacity group-hover:opacity-100 whitespace-nowrap">
                    Coming soon
                  </div>
                </div>
              </div>
              <div className="relative">
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  className={cn(
                    'w-full rounded-xl border bg-bg-card px-4 py-3 pr-11 text-sm text-text-primary outline-none transition-all',
                    'placeholder:text-text-tertiary focus:border-border-focus focus:ring-2 focus:ring-gold/20',
                    error ? 'border-danger' : 'border-border'
                  )}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-text-tertiary transition-colors hover:text-text-secondary"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
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
                'disabled:cursor-not-allowed disabled:opacity-60'
              )}
            >
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>
        </div>

        {/* Footer */}
        <p className="mt-8 text-center text-sm text-text-tertiary">
          Don&apos;t have an account?{' '}
          <Link
            href="/join"
            className="font-medium text-gold transition-colors hover:text-gold-dark"
          >
            Join now
          </Link>
        </p>
      </motion.div>
    </div>
  )
}
