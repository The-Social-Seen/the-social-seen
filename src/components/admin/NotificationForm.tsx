'use client'

import { useState, useTransition } from 'react'
import { Send, Info } from 'lucide-react'
import { sendNotification } from '@/app/(admin)/admin/actions'

export default function NotificationForm() {
  const [isPending, startTransition] = useTransition()
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [recipientType, setRecipientType] = useState('all')

  function handleSubmit(formData: FormData) {
    setError(null)
    setSuccess(false)
    startTransition(async () => {
      const result = await sendNotification(formData)
      if (result.error) {
        setError(result.error)
      } else {
        setSuccess(true)
        // Reset form after short delay
        setTimeout(() => setSuccess(false), 3000)
      }
    })
  }

  return (
    <form action={handleSubmit} className="space-y-4">
      {/* Demo banner */}
      <div className="flex items-center gap-2 p-3 rounded-lg bg-gold/10 border border-gold/20">
        <Info className="w-4 h-4 text-gold shrink-0" />
        <p className="text-xs text-gold">
          Demo mode — notifications are logged but not sent
        </p>
      </div>

      {success && (
        <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 text-sm text-emerald-600 dark:text-emerald-400">
          Notification logged successfully
        </div>
      )}

      {error && (
        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 text-sm text-red-600 dark:text-red-400">
          {error}
        </div>
      )}

      <div>
        <label htmlFor="recipient_type" className="block text-sm font-medium text-text-primary mb-1">
          To
        </label>
        <select
          id="recipient_type"
          name="recipient_type"
          required
          value={recipientType}
          onChange={(e) => setRecipientType(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-border bg-bg-card text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-gold/50"
        >
          <option value="all">All Members</option>
          <option value="event_attendees">Event Attendees</option>
          <option value="waitlisted">Waitlisted</option>
        </select>
      </div>

      {/* Hidden type field */}
      <input type="hidden" name="type" value="announcement" />

      <div>
        <label htmlFor="subject" className="block text-sm font-medium text-text-primary mb-1">
          Subject
        </label>
        <input
          id="subject"
          name="subject"
          type="text"
          required
          className="w-full px-3 py-2 rounded-lg border border-border bg-bg-card text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-gold/50"
          placeholder="New event this Saturday!"
        />
      </div>

      <div>
        <label htmlFor="body" className="block text-sm font-medium text-text-primary mb-1">
          Body
        </label>
        <textarea
          id="body"
          name="body"
          required
          rows={4}
          className="w-full px-3 py-2 rounded-lg border border-border bg-bg-card text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-gold/50 resize-none"
          placeholder="Write your notification message..."
        />
      </div>

      <button
        type="submit"
        disabled={isPending}
        className="inline-flex items-center gap-2 bg-gold hover:bg-gold-dark text-white font-medium text-sm px-6 py-2.5 rounded-full transition-colors disabled:opacity-50"
      >
        <Send className="w-4 h-4" />
        {isPending ? 'Sending...' : 'Send Notification'}
      </button>
    </form>
  )
}
