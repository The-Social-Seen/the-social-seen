'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { Send } from 'lucide-react'
import { sendContactMessage } from './actions'
import { CONTACT_SUBJECT_OPTIONS } from '@/lib/email/templates/contact-message'
import { TurnstileWidget } from '@/components/forms/TurnstileWidget'

const MAX_MESSAGE = 5000

export default function ContactForm() {
  const formRef = useRef<HTMLFormElement>(null)
  // Honeypot timing — captured on mount so the value reflects when the
  // user actually saw the form, not when the server rendered it.
  // useRef avoids both the SSR/CSR hydration mismatch and the
  // setState-in-effect lint warning that useState would trigger.
  const renderedAtRef = useRef<number>(0)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<boolean>(false)
  const [isPending, startTransition] = useTransition()
  const [message, setMessage] = useState('')

  useEffect(() => {
    renderedAtRef.current = Date.now()
  }, [])

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSuccess(false)

    const formData = new FormData(e.currentTarget)
    formData.set('ts', String(renderedAtRef.current))

    startTransition(async () => {
      const result = await sendContactMessage(formData)
      if ('error' in result) {
        setError(result.error)
        return
      }
      setSuccess(true)
      setMessage('')
      formRef.current?.reset()
    })
  }

  if (success) {
    return (
      <div
        className="rounded-xl border border-emerald-200 bg-emerald-50 p-6 dark:border-emerald-900/40 dark:bg-emerald-950/30"
        role="status"
      >
        <h2 className="font-serif text-xl text-emerald-700 dark:text-emerald-300">
          Thanks — message sent.
        </h2>
        <p className="mt-2 text-sm text-emerald-700/80 dark:text-emerald-300/80">
          We&rsquo;ll get back to you within a few working days. If it&rsquo;s
          urgent, drop us a note on Instagram.
        </p>
        <button
          type="button"
          onClick={() => setSuccess(false)}
          className="mt-4 text-sm font-medium text-gold underline-offset-2 hover:underline"
        >
          Send another message
        </button>
      </div>
    )
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-5">
      {/* Honeypot — visually hidden but DOM-present. Bots fill in
          fields they see; real users don't. */}
      <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px' }}>
        <label htmlFor="company_website">Leave this field blank</label>
        <input
          id="company_website"
          name="company_website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label
            htmlFor="contact-name"
            className="block text-sm font-medium text-text-primary mb-1"
          >
            Your name
          </label>
          <input
            id="contact-name"
            name="name"
            type="text"
            required
            minLength={2}
            maxLength={100}
            disabled={isPending}
            autoComplete="name"
            className="w-full px-3 py-2 rounded-lg border border-border bg-bg-card text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-gold/50 disabled:opacity-50"
          />
        </div>
        <div>
          <label
            htmlFor="contact-email"
            className="block text-sm font-medium text-text-primary mb-1"
          >
            Email
          </label>
          <input
            id="contact-email"
            name="email"
            type="email"
            required
            maxLength={200}
            disabled={isPending}
            autoComplete="email"
            className="w-full px-3 py-2 rounded-lg border border-border bg-bg-card text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-gold/50 disabled:opacity-50"
          />
        </div>
      </div>

      <div>
        <label
          htmlFor="contact-subject"
          className="block text-sm font-medium text-text-primary mb-1"
        >
          Topic
        </label>
        <select
          id="contact-subject"
          name="subject"
          required
          disabled={isPending}
          defaultValue="general"
          className="w-full px-3 py-2 rounded-lg border border-border bg-bg-card text-text-primary focus:outline-none focus:ring-2 focus:ring-gold/50 disabled:opacity-50"
        >
          {CONTACT_SUBJECT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label
          htmlFor="contact-message"
          className="block text-sm font-medium text-text-primary mb-1"
        >
          Message
        </label>
        <textarea
          id="contact-message"
          name="message"
          rows={6}
          required
          minLength={20}
          maxLength={MAX_MESSAGE}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          disabled={isPending}
          placeholder="Tell us what's on your mind."
          className="w-full px-3 py-2 rounded-lg border border-border bg-bg-card text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-gold/50 disabled:opacity-50 font-sans"
        />
        <p className="mt-1 text-xs text-text-tertiary">
          {message.length}/{MAX_MESSAGE}
        </p>
      </div>

      {error && (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      )}

      <TurnstileWidget />

      <button
        type="submit"
        disabled={isPending}
        className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-gold text-white hover:bg-gold-hover transition-colors text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px]"
      >
        <Send className="w-4 h-4" />
        {isPending ? 'Sending\u2026' : 'Send Message'}
      </button>
    </form>
  )
}
