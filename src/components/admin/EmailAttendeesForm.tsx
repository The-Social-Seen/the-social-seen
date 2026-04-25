'use client'

import { useRef, useState, useTransition } from 'react'
import { Send } from 'lucide-react'
import { emailEventAttendees } from '@/app/(admin)/admin/actions'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'

interface EmailAttendeesFormProps {
  eventId: string
  confirmedCount: number
}

const MAX_SUBJECT = 150
const MAX_BODY = 5000

export default function EmailAttendeesForm({
  eventId,
  confirmedCount,
}: EmailAttendeesFormProps) {
  const formRef = useRef<HTMLFormElement>(null)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [confirmOpen, setConfirmOpen] = useState(false)

  const disabled = confirmedCount === 0

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    // Capture the form snapshot now — the dialog will dispatch on confirm.
    // Can't rely on `e.currentTarget` after the event loop yields.
    setConfirmOpen(true)
  }

  async function handleConfirmSend() {
    if (!formRef.current) return
    const formData = new FormData(formRef.current)
    startTransition(async () => {
      const result = await emailEventAttendees(eventId, formData)
      if ('error' in result) {
        setError(result.error)
        setConfirmOpen(false)
        return
      }
      setSuccess(
        `Sending to ${result.recipientCount} attendee${result.recipientCount === 1 ? '' : 's'}. Check the Failed Notifications view if any don't arrive.`,
      )
      setSubject('')
      setBody('')
      formRef.current?.reset()
      setConfirmOpen(false)
    })
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label
          htmlFor="announcement-subject"
          className="block text-sm font-medium text-text-primary mb-1"
        >
          Subject
        </label>
        <input
          id="announcement-subject"
          name="subject"
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          maxLength={MAX_SUBJECT}
          disabled={disabled || isPending}
          placeholder="Quick update on tonight's venue"
          className="w-full px-3 h-11 md:h-9 rounded-lg border border-border bg-bg-card text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-gold/50 disabled:opacity-50"
          required
        />
        <p className="text-xs text-text-tertiary mt-1">
          {subject.length}/{MAX_SUBJECT}
        </p>
      </div>

      <div>
        <label
          htmlFor="announcement-body"
          className="block text-sm font-medium text-text-primary mb-1"
        >
          Message
        </label>
        <textarea
          id="announcement-body"
          name="body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={MAX_BODY}
          disabled={disabled || isPending}
          rows={8}
          placeholder="Plain text only. Blank lines separate paragraphs."
          className="w-full px-3 py-2 rounded-lg border border-border bg-bg-card text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-gold/50 disabled:opacity-50 font-sans"
          required
        />
        <p className="text-xs text-text-tertiary mt-1">
          {body.length}/{MAX_BODY}
        </p>
      </div>

      {error && (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
      {success && (
        <p className="text-sm text-emerald-600" role="status">
          {success}
        </p>
      )}

      <div className="flex flex-col-reverse gap-3 md:flex-row md:items-center md:justify-between">
        <p className="text-sm text-text-tertiary">
          {disabled
            ? 'No confirmed attendees to email yet.'
            : `Will send to ${confirmedCount} confirmed attendee${confirmedCount === 1 ? '' : 's'}.`}
        </p>
        <button
          type="submit"
          disabled={disabled || isPending || subject.length < 3 || body.length < 10}
          className="inline-flex items-center justify-center gap-2 px-5 py-2 rounded-full bg-gold text-white hover:bg-gold-hover transition-colors text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px] w-full md:w-auto"
        >
          <Send className="w-4 h-4" />
          {isPending ? (
            'Sending…'
          ) : (
            <>
              {/*
                On mobile the form is stacked and "Send to {N}" anchors the
                action to the actual recipient count. On md+ the count sits
                in the helper text above and the CTA reads "Send to Attendees"
                to avoid duplicating the number.
              */}
              <span className="md:hidden">
                Send to {confirmedCount}
              </span>
              <span className="hidden md:inline">Send to Attendees</span>
            </>
          )}
        </button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Send to ${confirmedCount} attendee${confirmedCount === 1 ? '' : 's'}?`}
        description={
          <>
            <p>
              This will immediately email every confirmed attendee of this
              event. There&rsquo;s no undo.
            </p>
            <p className="rounded-lg border border-gold/30 bg-gold/5 p-3 text-xs">
              <strong>Subject:</strong> {subject || '(empty)'}
            </p>
          </>
        }
        confirmLabel="Send"
        onConfirm={handleConfirmSend}
      />
    </form>
  )
}
