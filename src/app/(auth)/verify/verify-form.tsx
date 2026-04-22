'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { motion } from 'framer-motion'
import { CheckCircle2, Mail } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { sanitizeRedirectPath } from '@/lib/utils/redirect'
import { track } from '@/lib/analytics/track'
import { OtpDigits } from '@/components/auth/OtpDigits'
import {
  sendVerificationOtp,
  verifyEmailOtp,
  type SendVerificationOtpErrorCode,
} from '../actions'

const CODE_LENGTH = 6
const RESEND_COOLDOWN_SECONDS = 60
const SUCCESS_REDIRECT_DELAY_MS = 1500

type Status = 'sending' | 'ready' | 'verifying' | 'success' | 'send_error'

export function VerifyForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirectTo = sanitizeRedirectPath(searchParams.get('from'))
  // `source` query param — set by the UnverifiedBanner (`source=banner`)
  // and VerifyPromptModal (`source=modal`) so PostHog can attribute the
  // verification request to its trigger surface. Anything else → direct.
  const sourceParam = searchParams.get('source')
  const autoSendSource: 'banner' | 'modal' | 'direct' =
    sourceParam === 'banner' || sourceParam === 'modal' ? sourceParam : 'direct'

  const [status, setStatus] = useState<Status>('sending')
  const [digits, setDigits] = useState<string[]>(Array(CODE_LENGTH).fill(''))
  const [error, setError] = useState<string | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)
  const [sendErrorCode, setSendErrorCode] = useState<
    SendVerificationOtpErrorCode | null
  >(null)
  const [secondsLeft, setSecondsLeft] = useState(RESEND_COOLDOWN_SECONDS)

  // Guards against double auto-send in React StrictMode and against re-sending
  // on pathname/search-param changes after the initial mount.
  const hasAutoSentRef = useRef(false)

  // Submission guard — prevents double-submit when all 6 digits fill quickly.
  const isSubmittingRef = useRef(false)

  const fullCode = digits.join('')

  // ── Countdown tick while resend is disabled ──────────────────────────────
  useEffect(() => {
    if (secondsLeft <= 0) return
    const timer = setInterval(() => {
      setSecondsLeft((s) => Math.max(0, s - 1))
    }, 1000)
    return () => clearInterval(timer)
  }, [secondsLeft])

  // ── Handlers (declared before auto-send effect so the effect can call them)
  const handleSend = useCallback(
    async (source: 'banner' | 'modal' | 'direct') => {
      setSendError(null)
      setSendErrorCode(null)
      track('email_verification_requested', { source })

      const result = await sendVerificationOtp()

      if ('error' in result) {
        // Branch on the machine-readable `code` so UI logic doesn't
        // depend on backend copy. `error` is display-only.
        if (result.code === 'unauthenticated') {
          setStatus('send_error')
          setSendError(result.error)
          setSendErrorCode(result.code)
          return
        }
        track('email_verification_failed', {
          reason: result.code === 'rate_limited' ? 'rate_limit' : 'send_failed',
        })

        if (result.code === 'rate_limited') {
          // Keep them on the input screen but show the error and extend the
          // cooldown so they can't immediately re-send.
          setStatus('ready')
          setSendError(result.error)
          setSendErrorCode(result.code)
          setSecondsLeft(RESEND_COOLDOWN_SECONDS)
          return
        }
        setStatus('send_error')
        setSendError(result.error)
        setSendErrorCode(result.code)
        return
      }

      // If the backend short-circuited because the user is already verified,
      // skip the code-entry screen entirely and go straight to success.
      // Otherwise the user would see "Enter the 6-digit code we sent" with
      // no actual code to enter (verifyOtp would fail "invalid" for any input).
      if ('alreadyVerified' in result && result.alreadyVerified) {
        track('email_verification_completed', {})
        setStatus('success')
        setTimeout(() => {
          router.push(redirectTo)
          router.refresh()
        }, SUCCESS_REDIRECT_DELAY_MS)
        return
      }

      setStatus('ready')
      setSecondsLeft(RESEND_COOLDOWN_SECONDS)
    },
    [redirectTo, router],
  )

  // ── Auto-send once on mount ──────────────────────────────────────────────
  useEffect(() => {
    if (hasAutoSentRef.current) return
    hasAutoSentRef.current = true
    // handleSend is async; setState calls inside happen after the awaited
    // server action. The lint rule conservatively flags the call chain,
    // but firing a one-shot OTP request on mount is exactly what we want.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void handleSend(autoSendSource)
  }, [handleSend, autoSendSource])

  // ── Submit the code ──────────────────────────────────────────────────────
  const submit = useCallback(
    async (code: string) => {
      if (isSubmittingRef.current) return
      if (!/^\d{6}$/.test(code)) {
        setError('Enter all six digits')
        return
      }

      isSubmittingRef.current = true
      setStatus('verifying')
      setError(null)

      const result = await verifyEmailOtp({ code })

      isSubmittingRef.current = false

      if ('error' in result) {
        // Keep the analytics taxonomy stable ('invalid_code' / 'rate_limit' /
        // 'other') for historical continuity, but derive it from the
        // machine-readable `code` instead of substring-matching the message.
        const reason: 'invalid_code' | 'rate_limit' | 'other' =
          result.code === 'invalid_otp' ? 'invalid_code' : 'other'
        track('email_verification_failed', { reason })

        setStatus('ready')
        setError(result.error)
        // Clear digits so user can retry. OtpDigits is uncontrolled-focus
        // beyond what its own keyboard handlers manage; the user will land
        // back in the first cell as soon as they start typing.
        setDigits(Array(CODE_LENGTH).fill(''))
        return
      }

      track('email_verification_completed', {})
      setStatus('success')

      // Redirect after a brief success pause so the tick animation is visible.
      setTimeout(() => {
        router.push(redirectTo)
        router.refresh()
      }, SUCCESS_REDIRECT_DELAY_MS)
    },
    [redirectTo, router],
  )

  // OtpDigits owns digit-cell focus & paste/backspace mechanics.
  // Parent receives flat `digits[]` updates and the joined `code` once
  // all six are entered (whether typed or pasted).
  const handleDigitsChange = useCallback((next: string[]) => {
    setDigits(next)
    setError(null)
  }, [])

  // ── Render ───────────────────────────────────────────────────────────────
  const isInputDisabled = status === 'verifying' || status === 'success'
  const canResend = secondsLeft === 0 && status !== 'verifying' && status !== 'success'

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-bg-primary">
      {/* Decorative blurs — match other auth pages */}
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

        <div className="rounded-2xl border border-border bg-bg-card p-8 shadow-xl shadow-charcoal/5 md:p-10">
          {status === 'success' ? (
            <div className="text-center">
              <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-gold/10">
                <CheckCircle2 className="h-7 w-7 text-gold" aria-hidden="true" />
              </div>
              <h1 className="font-serif text-2xl font-bold text-text-primary">
                Email Verified
              </h1>
              <p className="mt-3 text-sm text-text-secondary">
                You&apos;re all set. Taking you back now&hellip;
              </p>
            </div>
          ) : status === 'send_error' ? (
            <div className="text-center">
              <h1 className="font-serif text-2xl font-bold text-text-primary">
                Couldn&apos;t Send Code
              </h1>
              <p className="mt-3 text-sm text-danger">{sendError}</p>
              {sendErrorCode === 'unauthenticated' ? (
                <Link
                  href="/login"
                  className="mt-8 inline-flex w-full items-center justify-center rounded-full bg-gold px-8 py-3 text-sm font-semibold text-white transition-all hover:bg-gold-dark hover:shadow-lg hover:shadow-gold/25"
                >
                  Sign in
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    hasAutoSentRef.current = false
                    setStatus('sending')
                    void handleSend('direct')
                  }}
                  className="mt-8 inline-flex w-full items-center justify-center rounded-full bg-gold px-8 py-3 text-sm font-semibold text-white transition-all hover:bg-gold-dark hover:shadow-lg hover:shadow-gold/25"
                >
                  Try Again
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="mb-8 text-center">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-gold/10">
                  <Mail className="h-6 w-6 text-gold" aria-hidden="true" />
                </div>
                <h1 className="font-serif text-3xl font-bold text-text-primary">
                  Verify Your Email
                </h1>
                <p className="mt-2 text-sm text-text-secondary">
                  Enter the 6-digit code we just sent to your inbox.
                </p>
              </div>

              <OtpDigits
                digits={digits}
                onChange={handleDigitsChange}
                onComplete={(code) => void submit(code)}
                disabled={isInputDisabled}
                hasError={!!error}
                length={CODE_LENGTH}
              />

              {error && (
                <p className="mt-4 text-center text-xs text-danger">{error}</p>
              )}

              {/* Hidden submit for accessibility: pressing Enter submits */}
              <div className="mt-6">
                <button
                  type="button"
                  onClick={() => void submit(fullCode)}
                  disabled={
                    isInputDisabled || fullCode.length !== CODE_LENGTH
                  }
                  className={cn(
                    'w-full rounded-full bg-gold px-8 py-3 text-sm font-semibold text-white transition-all',
                    'hover:bg-gold-dark hover:shadow-lg hover:shadow-gold/25',
                    'disabled:cursor-not-allowed disabled:opacity-60',
                  )}
                >
                  {status === 'verifying' ? 'Verifying…' : 'Verify'}
                </button>
              </div>

              {/* Resend + rate-limit feedback */}
              <div className="mt-6 text-center text-xs text-text-tertiary">
                {sendError && sendError !== error && (
                  <p className="mb-2 text-danger">{sendError}</p>
                )}
                {canResend ? (
                  <button
                    type="button"
                    onClick={() => void handleSend('direct')}
                    className="font-medium text-gold transition-colors hover:text-gold-dark"
                  >
                    Resend code
                  </button>
                ) : (
                  <span>Resend in {secondsLeft}s</span>
                )}
              </div>
            </>
          )}
        </div>

        <p className="mt-8 text-center text-sm text-text-tertiary">
          <Link
            href={redirectTo}
            className="font-medium text-gold transition-colors hover:text-gold-dark"
          >
            Not now — I&apos;ll verify later
          </Link>
        </p>
      </motion.div>
    </div>
  )
}
