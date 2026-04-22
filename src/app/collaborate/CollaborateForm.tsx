'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { Send } from 'lucide-react'
import { sendCollaborationPitch } from '../contact/actions'
import { COLLABORATION_TYPE_OPTIONS } from '@/lib/email/templates/collaboration-pitch'

const MAX_MESSAGE = 5000

export default function CollaborateForm() {
  const formRef = useRef<HTMLFormElement>(null)
  // See ContactForm for rationale on useRef vs useState here.
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
      const result = await sendCollaborationPitch(formData)
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
          Pitch received.
        </h2>
        <p className="mt-2 text-sm text-emerald-700/80 dark:text-emerald-300/80">
          Thanks for reaching out — we&rsquo;ll review and reply within a few
          working days. The right partnerships make our events better.
        </p>
        <button
          type="button"
          onClick={() => setSuccess(false)}
          className="mt-4 text-sm font-medium text-gold underline-offset-2 hover:underline"
        >
          Submit another pitch
        </button>
      </div>
    )
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-5">
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
            htmlFor="collab-company"
            className="block text-sm font-medium text-text-primary mb-1"
          >
            Company / venue
          </label>
          <input
            id="collab-company"
            name="company_name"
            type="text"
            required
            minLength={2}
            maxLength={150}
            disabled={isPending}
            autoComplete="organization"
            className="w-full px-3 py-2 rounded-lg border border-border bg-bg-card text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-gold/50 disabled:opacity-50"
          />
        </div>
        <div>
          <label
            htmlFor="collab-type"
            className="block text-sm font-medium text-text-primary mb-1"
          >
            Type
          </label>
          <select
            id="collab-type"
            name="collaboration_type"
            required
            disabled={isPending}
            defaultValue="venue"
            className="w-full px-3 py-2 rounded-lg border border-border bg-bg-card text-text-primary focus:outline-none focus:ring-2 focus:ring-gold/50 disabled:opacity-50"
          >
            {COLLABORATION_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label
            htmlFor="collab-name"
            className="block text-sm font-medium text-text-primary mb-1"
          >
            Your name
          </label>
          <input
            id="collab-name"
            name="contact_name"
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
            htmlFor="collab-email"
            className="block text-sm font-medium text-text-primary mb-1"
          >
            Email
          </label>
          <input
            id="collab-email"
            name="contact_email"
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
          htmlFor="collab-website"
          className="block text-sm font-medium text-text-primary mb-1"
        >
          Website <span className="font-normal text-text-tertiary">(optional)</span>
        </label>
        <input
          id="collab-website"
          name="website"
          type="url"
          maxLength={300}
          disabled={isPending}
          placeholder="https://"
          autoComplete="url"
          className="w-full px-3 py-2 rounded-lg border border-border bg-bg-card text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-gold/50 disabled:opacity-50"
        />
      </div>

      <div>
        <label
          htmlFor="collab-message"
          className="block text-sm font-medium text-text-primary mb-1"
        >
          Tell us about the partnership
        </label>
        <textarea
          id="collab-message"
          name="message"
          rows={6}
          required
          minLength={20}
          maxLength={MAX_MESSAGE}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          disabled={isPending}
          placeholder="A bit about your venue/brand, what you're proposing, and what you'd want from us."
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

      <button
        type="submit"
        disabled={isPending}
        className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-gold text-white hover:bg-gold-hover transition-colors text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px]"
      >
        <Send className="w-4 h-4" />
        {isPending ? 'Sending\u2026' : 'Send Pitch'}
      </button>
    </form>
  )
}
