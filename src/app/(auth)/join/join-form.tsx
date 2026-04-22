/* Google brand colours — exempt from hex token rule per brand guidelines */
'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowLeft, ArrowRight, Check } from 'lucide-react'
import * as Checkbox from '@radix-ui/react-checkbox'
import { cn } from '@/lib/utils/cn'
import { INTEREST_OPTIONS, HEAR_ABOUT_OPTIONS } from '@/lib/constants'
import { track } from '@/lib/analytics/track'
import { signUp, saveInterests, completeOnboarding } from '../actions'

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const STEPS = [
  { label: 'Account' },
  { label: 'Interests' },
  { label: 'Welcome' },
] as const

const SIDE_IMAGES = [
  'https://images.unsplash.com/photo-1527529482837-4698179dc6ce?w=900&q=80',
  'https://images.unsplash.com/photo-1559339352-11d035aa65de?w=900&q=80',
  'https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=900&q=80',
]

const SIDE_CAPTIONS = [
  'Begin your journey',
  'Find your people',
  'Welcome to the community',
]

/* ------------------------------------------------------------------ */
/*  Slide animation variants                                           */
/* ------------------------------------------------------------------ */

const slideVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 300 : -300,
    opacity: 0,
  }),
  center: { x: 0, opacity: 1 },
  exit: (direction: number) => ({
    x: direction > 0 ? -300 : 300,
    opacity: 0,
  }),
}

/* ------------------------------------------------------------------ */
/*  Step Indicator                                                     */
/* ------------------------------------------------------------------ */

interface StepIndicatorProps {
  currentStep: number
}

function StepIndicator({ currentStep }: StepIndicatorProps) {
  return (
    <div className="px-6 py-4 md:px-12">
      <div className="flex items-center justify-center gap-3">
        {STEPS.map((s, i) => (
          <div key={s.label} className="flex items-center gap-3">
            <div className="flex flex-col items-center gap-1.5">
              <div
                className={cn(
                  'flex h-3 w-3 items-center justify-center rounded-full border-2 transition-all duration-300',
                  i < currentStep
                    ? 'border-gold bg-gold'
                    : i === currentStep
                      ? 'border-gold bg-transparent'
                      : 'border-text-tertiary bg-transparent'
                )}
              >
                {i < currentStep && <Check className="h-2 w-2 text-white" />}
              </div>
              <span
                className={cn(
                  'text-xs font-medium',
                  i <= currentStep ? 'text-gold' : 'text-text-tertiary'
                )}
              >
                {s.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div
                className={cn(
                  'mb-5 h-px w-8 transition-all duration-300 md:w-12',
                  i < currentStep ? 'bg-gold' : 'bg-border'
                )}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Step 1 — Create Your Account                                       */
/* ------------------------------------------------------------------ */

interface StepAccountProps {
  name: string
  email: string
  password: string
  phoneNumber: string
  emailConsent: boolean
  hearAbout: string
  onNameChange: (v: string) => void
  onEmailChange: (v: string) => void
  onPasswordChange: (v: string) => void
  onPhoneNumberChange: (v: string) => void
  onEmailConsentChange: (v: boolean) => void
  onHearAboutChange: (v: string) => void
  errors: Record<string, string>
  loading: boolean
  onSubmit: () => void
}

function StepAccount({
  name, email, password, phoneNumber, emailConsent, hearAbout,
  onNameChange, onEmailChange, onPasswordChange,
  onPhoneNumberChange, onEmailConsentChange, onHearAboutChange,
  errors, loading, onSubmit,
}: StepAccountProps) {
  return (
    <div className="space-y-5">
      <div className="mb-2">
        {/* Step screens are rendered one at a time — each step's heading
             is the route's h1 for that point in the flow. */}
        <h1 className="font-serif text-3xl font-bold text-text-primary md:text-4xl">
          Create Your Account
        </h1>
        <p className="mt-2 text-sm text-text-secondary">
          Join London&apos;s most exciting social community.
        </p>
      </div>

      {/* Full Name */}
      <div className="space-y-1.5">
        <label htmlFor="name" className="block text-sm font-medium text-text-secondary">
          Full Name
        </label>
        <input
          id="name"
          type="text"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="Charlotte Moreau"
          autoComplete="name"
          className={cn(
            'w-full rounded-xl border bg-bg-card px-4 py-3 text-sm text-text-primary outline-none transition-all',
            'placeholder:text-text-tertiary focus:border-border-focus focus:ring-2 focus:ring-gold/20',
            errors.name ? 'border-danger ring-2 ring-danger/10' : 'border-border'
          )}
        />
        {errors.name && <p className="text-xs text-danger">{errors.name}</p>}
      </div>

      {/* Email */}
      <div className="space-y-1.5">
        <label htmlFor="email" className="block text-sm font-medium text-text-secondary">
          Email Address
        </label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => onEmailChange(e.target.value)}
          placeholder="charlotte@example.com"
          autoComplete="email"
          className={cn(
            'w-full rounded-xl border bg-bg-card px-4 py-3 text-sm text-text-primary outline-none transition-all',
            'placeholder:text-text-tertiary focus:border-border-focus focus:ring-2 focus:ring-gold/20',
            errors.email ? 'border-danger ring-2 ring-danger/10' : 'border-border'
          )}
        />
        {errors.email && (
          <p className="text-xs text-danger">
            {errors.email}
            {errors.email.includes('already a member') && (
              <>
                {' '}
                <Link href="/login" className="font-medium text-gold underline">
                  Sign in
                </Link>
              </>
            )}
          </p>
        )}
      </div>

      {/* Password */}
      <div className="space-y-1.5">
        <label htmlFor="password" className="block text-sm font-medium text-text-secondary">
          Password
        </label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => onPasswordChange(e.target.value)}
          placeholder="At least 8 characters"
          autoComplete="new-password"
          className={cn(
            'w-full rounded-xl border bg-bg-card px-4 py-3 text-sm text-text-primary outline-none transition-all',
            'placeholder:text-text-tertiary focus:border-border-focus focus:ring-2 focus:ring-gold/20',
            errors.password ? 'border-danger ring-2 ring-danger/10' : 'border-border'
          )}
        />
        {errors.password && <p className="text-xs text-danger">{errors.password}</p>}
      </div>

      {/* Phone Number */}
      <div className="space-y-1.5">
        <label htmlFor="phoneNumber" className="block text-sm font-medium text-text-secondary">
          Phone Number
        </label>
        <input
          id="phoneNumber"
          type="tel"
          inputMode="tel"
          value={phoneNumber}
          onChange={(e) => onPhoneNumberChange(e.target.value)}
          placeholder="07123 456789 or +44 7123 456789"
          autoComplete="tel"
          className={cn(
            'w-full rounded-xl border bg-bg-card px-4 py-3 text-sm text-text-primary outline-none transition-all',
            'placeholder:text-text-tertiary focus:border-border-focus focus:ring-2 focus:ring-gold/20',
            errors.phoneNumber ? 'border-danger ring-2 ring-danger/10' : 'border-border'
          )}
        />
        <p className="text-xs text-text-tertiary">For event reminders and venue details</p>
        {errors.phoneNumber && <p className="text-xs text-danger">{errors.phoneNumber}</p>}
      </div>

      {/* How did you hear about us? (optional) */}
      <div className="space-y-1.5">
        <label htmlFor="hearAbout" className="block text-sm font-medium text-text-secondary">
          How did you hear about us?{' '}
          <span className="text-text-tertiary">(optional)</span>
        </label>
        <select
          id="hearAbout"
          value={hearAbout}
          onChange={(e) => onHearAboutChange(e.target.value)}
          className={cn(
            'w-full appearance-none rounded-xl border border-border bg-bg-card px-4 py-3 text-sm text-text-primary outline-none transition-all',
            'focus:border-border-focus focus:ring-2 focus:ring-gold/20',
            !hearAbout && 'text-text-tertiary'
          )}
        >
          <option value="">Select an option</option>
          {HEAR_ABOUT_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      </div>

      {/* Disabled Google OAuth button */}
      <div className="relative group">
        <button
          type="button"
          disabled
          className="w-full rounded-full border border-border bg-bg-card px-8 py-3 text-sm font-medium text-text-tertiary transition-all cursor-not-allowed opacity-60"
        >
          <span className="flex items-center justify-center gap-2">
            <svg className="h-4 w-4" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
            </svg>
            Continue with Google
          </span>
        </button>
        <div className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 rounded-lg bg-text-primary px-3 py-1.5 text-xs text-text-inverse opacity-0 transition-opacity group-hover:opacity-100">
          Coming soon
        </div>
      </div>

      {/* Email marketing consent (GDPR: unchecked by default) */}
      <label
        htmlFor="emailConsent"
        className="flex cursor-pointer items-start gap-3 text-sm text-text-secondary"
      >
        <Checkbox.Root
          id="emailConsent"
          checked={emailConsent}
          onCheckedChange={(checked) => onEmailConsentChange(checked === true)}
          className={cn(
            'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border bg-bg-card transition-all',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/40',
            emailConsent ? 'border-gold bg-gold' : 'border-border hover:border-gold/50'
          )}
        >
          <Checkbox.Indicator>
            <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />
          </Checkbox.Indicator>
        </Checkbox.Root>
        <span className="leading-snug">
          Keep me updated with new events and community news
        </span>
      </label>

      {/* Submit */}
      <button
        type="button"
        onClick={onSubmit}
        disabled={loading}
        className={cn(
          'inline-flex w-full items-center justify-center gap-2 rounded-full bg-gold px-8 py-3 text-sm font-semibold text-white transition-all',
          'hover:bg-gold-dark hover:shadow-lg hover:shadow-gold/25',
          'disabled:cursor-not-allowed disabled:opacity-60'
        )}
      >
        {loading ? 'Creating account…' : 'Continue'}
        {!loading && <ArrowRight className="h-4 w-4" />}
      </button>

      {errors.server && <p className="text-center text-xs text-danger">{errors.server}</p>}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Step 2 — What Interests You?                                       */
/* ------------------------------------------------------------------ */

interface StepInterestsProps {
  selected: string[]
  onToggle: (interest: string) => void
  error: string | null
  loading: boolean
  onSubmit: () => void
  onBack: () => void
}

function StepInterests({ selected, onToggle, error, loading, onSubmit, onBack }: StepInterestsProps) {
  return (
    <div className="space-y-6">
      <div className="mb-2">
        <h1 className="font-serif text-3xl font-bold text-text-primary md:text-4xl">
          What interests you?
        </h1>
        <p className="mt-2 text-sm text-text-secondary">
          Select the interests that resonate with you. We&apos;ll use these to curate your experience.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        {INTEREST_OPTIONS.map((interest) => {
          const isSelected = selected.includes(interest.value)
          return (
            <button
              key={interest.value}
              type="button"
              onClick={() => onToggle(interest.value)}
              className={cn(
                'rounded-full border px-4 py-2 text-sm font-medium transition-all duration-200',
                isSelected
                  ? 'border-gold bg-gold text-white'
                  : 'border-gold/20 bg-transparent text-gold hover:border-gold/50 hover:bg-gold/5'
              )}
            >
              {interest.label}
            </button>
          )
        })}
      </div>

      {error && <p className="text-xs text-danger">{error}</p>}

      <div className="flex items-center justify-between pt-4">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 text-sm font-medium text-text-tertiary transition-colors hover:text-text-primary"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={loading}
          className={cn(
            'inline-flex items-center gap-2 rounded-full bg-gold px-8 py-3 text-sm font-semibold text-white transition-all',
            'hover:bg-gold-dark hover:shadow-lg hover:shadow-gold/25',
            'disabled:cursor-not-allowed disabled:opacity-60'
          )}
        >
          {loading ? 'Saving…' : 'Continue'}
          {!loading && <ArrowRight className="h-4 w-4" />}
        </button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Step 3 — You're In                                                 */
/* ------------------------------------------------------------------ */

interface StepWelcomeProps {
  name: string
}

function StepWelcome({ name }: StepWelcomeProps) {
  const initials = name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)

  return (
    <div className="flex flex-col items-center justify-center py-8 text-center">
      {/* Initials avatar with gold shimmer */}
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 200, damping: 15, delay: 0.2 }}
        className="gold-shimmer mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-gold/10"
      >
        <span className="font-serif text-3xl font-bold text-gold">
          {initials || 'SS'}
        </span>
      </motion.div>

      <motion.h1
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        className="mb-3 font-serif text-4xl font-bold text-text-primary md:text-5xl"
      >
        You&apos;re In
      </motion.h1>

      <motion.p
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6 }}
        className="mb-8 max-w-sm text-text-secondary"
      >
        Welcome to The Social Seen. London&apos;s best evenings start here.
      </motion.p>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.8 }}
        className="flex flex-col gap-3 sm:flex-row"
      >
        <Link
          href="/events"
          className="inline-flex items-center justify-center rounded-full bg-gold px-8 py-3 text-sm font-semibold text-white transition-all hover:bg-gold-dark hover:shadow-lg hover:shadow-gold/25"
        >
          See What&apos;s On
        </Link>
        <Link
          href="/profile"
          className="inline-flex items-center justify-center rounded-full border border-border bg-bg-card px-8 py-3 text-sm font-semibold text-text-primary transition-all hover:bg-bg-secondary"
        >
          Complete Your Profile
        </Link>
      </motion.div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Main Form Component                                                */
/* ------------------------------------------------------------------ */

export function JoinForm() {
  const searchParams = useSearchParams()

  const stepParam = searchParams.get('step')
  const initialStep = stepParam ? Math.max(0, Math.min(parseInt(stepParam, 10) - 1, 2)) : 0

  const [step, setStep] = useState(initialStep)
  const [direction, setDirection] = useState(1)

  // Step 1 state
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [phoneNumber, setPhoneNumber] = useState('')
  // GDPR: marketing consent defaults to false (opt-in only).
  const [emailConsent, setEmailConsent] = useState(false)
  const [hearAbout, setHearAbout] = useState('')
  const [accountErrors, setAccountErrors] = useState<Record<string, string>>({})
  const [accountLoading, setAccountLoading] = useState(false)

  // Step 2 state
  const [selectedInterests, setSelectedInterests] = useState<string[]>([])
  const [interestError, setInterestError] = useState<string | null>(null)
  const [interestLoading, setInterestLoading] = useState(false)

  // Update URL when step changes
  useEffect(() => {
    const url = new URL(window.location.href)
    url.searchParams.set('step', String(step + 1))
    window.history.replaceState({}, '', url.toString())
  }, [step])

  // Complete onboarding on Step 3 render
  useEffect(() => {
    if (step === 2) {
      completeOnboarding()
    }
  }, [step])

  const goToStep = useCallback((target: number) => {
    setDirection(target > step ? 1 : -1)
    setStep(target)
  }, [step])

  /* ---- Step 1 submit ---- */
  async function handleAccountSubmit() {
    const errors: Record<string, string> = {}
    if (!name.trim()) errors.name = "We'll need your name to get started"
    if (!email.trim()) errors.email = 'Enter your email to create your account'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = 'Enter your email to create your account'
    if (!password.trim() || password.length < 8) errors.password = 'Choose a password (at least 8 characters)'

    // Phone is stored stripped of whitespace (Server Action regex is strict).
    // Users can still type spaces/dashes while the UI matches the looser regex.
    const phoneStripped = phoneNumber.replace(/\s+/g, '')
    if (!phoneStripped) {
      errors.phoneNumber = 'Enter a valid phone number'
    } else if (!/^\+?[0-9]{10,15}$/.test(phoneStripped)) {
      errors.phoneNumber = 'Enter a valid phone number'
    }

    if (Object.keys(errors).length > 0) {
      setAccountErrors(errors)
      return
    }

    setAccountErrors({})
    setAccountLoading(true)

    const result = await signUp({
      fullName: name.trim(),
      email: email.trim(),
      password,
      phoneNumber: phoneStripped,
      emailConsent,
      referralSource: hearAbout || undefined,
    })

    setAccountLoading(false)

    if ('error' in result) {
      if (result.error.includes('already a member') || result.error.includes('already registered')) {
        setAccountErrors({ email: "Looks like you're already a member — sign in instead?" })
      } else {
        setAccountErrors({ server: result.error })
      }
      return
    }

    track('sign_up', { method: 'email' })
    goToStep(1)
  }

  /* ---- Step 2 submit ---- */
  async function handleInterestsSubmit() {
    if (selectedInterests.length === 0) {
      setInterestError("Pick at least one — we'll use this to show you events you'll love")
      return
    }

    setInterestError(null)
    setInterestLoading(true)

    const result = await saveInterests({ interests: selectedInterests })

    setInterestLoading(false)

    if ('error' in result) {
      setInterestError(result.error)
      return
    }

    track('sign_up_completed', { interests_count: selectedInterests.length })
    goToStep(2)
  }

  function toggleInterest(interest: string) {
    setSelectedInterests((prev) =>
      prev.includes(interest)
        ? prev.filter((i) => i !== interest)
        : [...prev, interest]
    )
    setInterestError(null)
  }

  /* ------------------------------------------------------------------ */
  /*  Render                                                             */
  /* ------------------------------------------------------------------ */

  return (
    <div className="flex min-h-screen bg-bg-primary">
      {/* ---- Left: Form Side ---- */}
      <div className="flex w-full flex-col lg:w-1/2">
        {/* Top nav */}
        <div className="flex items-center justify-between px-6 py-6 md:px-12">
          <Link href="/" className="font-serif text-xl font-bold text-text-primary">
            The Social Seen
          </Link>
          <Link
            href="/login"
            className="text-sm text-text-tertiary transition-colors hover:text-gold"
          >
            Already a member? <span className="font-medium text-gold">Sign In</span>
          </Link>
        </div>

        {/* Step indicator */}
        <StepIndicator currentStep={step} />

        {/* Form content */}
        <div className="flex flex-1 items-start px-6 py-6 md:items-center md:px-12 lg:px-16">
          <div className="mx-auto w-full max-w-lg">
            <AnimatePresence mode="wait" custom={direction}>
              <motion.div
                key={step}
                custom={direction}
                variants={slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] }}
              >
                {step === 0 && (
                  <StepAccount
                    name={name}
                    email={email}
                    password={password}
                    phoneNumber={phoneNumber}
                    emailConsent={emailConsent}
                    hearAbout={hearAbout}
                    onNameChange={setName}
                    onEmailChange={setEmail}
                    onPasswordChange={setPassword}
                    onPhoneNumberChange={setPhoneNumber}
                    onEmailConsentChange={setEmailConsent}
                    onHearAboutChange={setHearAbout}
                    errors={accountErrors}
                    loading={accountLoading}
                    onSubmit={handleAccountSubmit}
                  />
                )}
                {step === 1 && (
                  <StepInterests
                    selected={selectedInterests}
                    onToggle={toggleInterest}
                    error={interestError}
                    loading={interestLoading}
                    onSubmit={handleInterestsSubmit}
                    onBack={() => goToStep(0)}
                  />
                )}
                {step === 2 && <StepWelcome name={name} />}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* ---- Right: Atmospheric Image ---- */}
      <div className="relative hidden lg:block lg:w-1/2">
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
            className="absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: `url(${SIDE_IMAGES[step]})` }}
          >
            <div className="absolute inset-0 bg-gradient-to-r from-bg-primary/30 to-transparent" />
            <div className="absolute inset-0 bg-charcoal/20" />

            <div className="absolute bottom-12 left-12 right-12">
              <p className="text-xs font-medium uppercase tracking-[0.3em] text-white/60">
                The Social Seen
              </p>
              <p className="mt-2 font-serif text-2xl font-bold text-white">
                {SIDE_CAPTIONS[step]}
              </p>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}
