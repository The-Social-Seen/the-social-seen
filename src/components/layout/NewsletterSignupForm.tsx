'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { subscribeToNewsletter } from '@/app/newsletter/actions'
import { TurnstileWidget } from '@/components/forms/TurnstileWidget'

interface NewsletterSignupFormProps {
  source?: 'footer' | 'landing'
  /** Layout tweaks — "footer" is the compact inline version. */
  variant?: 'footer' | 'standalone'
}

/**
 * Public newsletter signup form. Used in the footer today, can be
 * reused for a landing hero strip later.
 *
 * Minimal UX: one email input, one submit button. On success, swaps
 * to a short confirmation message ("check your inbox") so the user
 * knows it worked without a full page reload.
 */
export default function NewsletterSignupForm({
  source = 'footer',
  variant = 'footer',
}: NewsletterSignupFormProps) {
  const formRef = useRef<HTMLFormElement>(null)
  const renderedAtRef = useRef<number>(0)
  const [isPending, startTransition] = useTransition()
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    renderedAtRef.current = Date.now()
  }, [])

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setStatus('idle')
    setMessage(null)

    const formData = new FormData(e.currentTarget)
    formData.set('source', source)
    formData.set('ts', String(renderedAtRef.current))

    startTransition(async () => {
      const result = await subscribeToNewsletter(formData)
      if (!result.success) {
        setStatus('error')
        setMessage(result.error)
        return
      }
      setStatus('success')
      setMessage(result.message)
      formRef.current?.reset()
    })
  }

  if (status === 'success') {
    return (
      <p
        role="status"
        className={cn(
          'text-sm leading-snug',
          variant === 'footer' ? 'text-text-secondary' : 'text-text-primary',
        )}
      >
        {message ?? 'Thanks — check your inbox to confirm.'}
      </p>
    )
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="mt-4 flex gap-2">
      {/* Honeypot — visually hidden field. Bots fill this in. */}
      <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px' }}>
        <label htmlFor={`newsletter-cw-${source}`}>Leave this blank</label>
        <input
          id={`newsletter-cw-${source}`}
          name="company_website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>

      <input
        type="email"
        name="email"
        placeholder="Your email"
        required
        maxLength={200}
        disabled={isPending}
        aria-label="Email address for newsletter"
        className={cn(
          'flex-1 rounded-lg border border-border bg-bg-primary px-4 py-2.5',
          'text-sm text-text-primary placeholder:text-text-tertiary',
          'transition-all duration-200',
          'focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold',
          'disabled:opacity-50',
        )}
      />
      <button
        type="submit"
        disabled={isPending}
        aria-label="Subscribe to newsletter"
        className={cn(
          'flex items-center justify-center rounded-lg px-4 py-2.5',
          'bg-gold text-text-inverse',
          'text-sm font-medium transition-all duration-200',
          'hover:bg-gold-dark',
          'focus:outline-none focus:ring-2 focus:ring-gold focus:ring-offset-2',
          'disabled:opacity-50 disabled:cursor-not-allowed',
        )}
      >
        <ArrowRight className="h-4 w-4" />
      </button>
      {/* Turnstile — invisible for most users. See Batch 1 rate-limiting. */}
      <TurnstileWidget />
      {status === 'error' && (
        <p
          role="alert"
          className="mt-2 basis-full text-xs text-[color:var(--color-danger)]"
        >
          {message}
        </p>
      )}
    </form>
  )
}
