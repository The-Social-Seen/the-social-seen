'use client'

import { useState, useTransition } from 'react'
import { Download, Trash2, ShieldCheck, X } from 'lucide-react'
import {
  deleteMyAccount,
  exportMyData,
} from '@/app/(member)/profile/privacy-actions'

/**
 * P2-8b — GDPR self-service surface on `/profile`.
 *
 * Two buttons:
 *   • Download my data — calls the `exportMyData` Server Action, writes
 *     the returned JSON to a blob, and triggers a browser download.
 *   • Delete my account — opens a confirm dialog requiring the user
 *     to type "delete my account" before the action fires. On success
 *     the action redirects to `/?account_deleted=1`; on failure we
 *     surface the error inline.
 *
 * Accessibility: dialog uses role="dialog" + aria-modal + labelled-by.
 * Focus trap + Escape-key are not implemented here for parity with the
 * existing moderation dialog — both follow a future a11y cleanup pass
 * (logged in FOLLOW-UPS).
 */
export default function DataPrivacySection() {
  const [isExporting, startExport] = useTransition()
  const [isDeleting, startDelete] = useTransition()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [confirmation, setConfirmation] = useState('')
  const [deleteError, setDeleteError] = useState<string | null>(null)

  function handleExport() {
    startExport(async () => {
      try {
        const json = await exportMyData()
        const blob = new Blob([json], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        const stamp = new Date().toISOString().split('T')[0]
        a.download = `the-social-seen-${stamp}.json`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
      } catch (err) {
        console.error('[DataPrivacySection] export failed:', err)
        alert('Could not export your data. Please try again.')
      }
    })
  }

  function handleDelete() {
    setDeleteError(null)
    startDelete(async () => {
      const result = await deleteMyAccount(confirmation)
      if (!result.success) {
        setDeleteError(result.error ?? 'Could not delete your account.')
      }
      // Success path redirects server-side; no client-side navigation needed.
    })
  }

  return (
    <section className="mt-10">
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gold/10">
          <ShieldCheck className="h-4 w-4 text-gold" aria-hidden="true" />
        </div>
        <div>
          <h2 className="font-serif text-xl font-bold text-text-primary">
            Your data &amp; privacy
          </h2>
          <p className="mt-1 text-sm text-text-primary/70">
            Download everything we hold about you, or close your account
            permanently.
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-3 rounded-2xl border border-border bg-bg-card p-5">
        {/* Download */}
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-text-primary">
              Download my data
            </p>
            <p className="text-xs text-text-primary/60">
              Profile, bookings, reviews, and interests as a JSON file.
            </p>
          </div>
          <button
            type="button"
            onClick={handleExport}
            disabled={isExporting}
            className="inline-flex shrink-0 items-center gap-2 rounded-full border border-blush/60 px-4 py-2 text-sm font-medium text-text-primary transition-colors hover:bg-bg-primary disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            {isExporting ? 'Preparing\u2026' : 'Download'}
          </button>
        </div>

        <div className="border-t border-border" />

        {/* Delete */}
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-text-primary">
              Delete my account
            </p>
            <p className="text-xs text-text-primary/60">
              Closes your account and anonymises your data. Hard-deleted
              after 30 days.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setConfirmation('')
              setDeleteError(null)
              setDialogOpen(true)
            }}
            className="inline-flex shrink-0 items-center gap-2 rounded-full border border-danger/40 px-4 py-2 text-sm font-medium text-danger transition-colors hover:bg-danger/5"
          >
            <Trash2 className="h-4 w-4" />
            Delete
          </button>
        </div>
      </div>

      {dialogOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => !isDeleting && setDialogOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-border bg-bg-card p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <h3
                id="delete-dialog-title"
                className="font-serif text-xl font-bold text-text-primary"
              >
                Delete your account?
              </h3>
              <button
                type="button"
                onClick={() => !isDeleting && setDialogOpen(false)}
                className="rounded-lg p-1 text-text-tertiary hover:bg-bg-secondary hover:text-text-primary"
                aria-label="Close delete account dialog"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3 text-sm text-text-primary/80">
              <p>
                This will immediately close your account and anonymise
                your profile. After 30 days the record is hard-deleted.
              </p>
              <p className="rounded-lg border border-gold/30 bg-gold/5 p-3 text-xs">
                <strong>Heads-up:</strong> If you have a confirmed paid
                booking, cancel it first. The 48h refund policy still
                applies &mdash; deleting your account doesn&rsquo;t
                trigger refunds for events within 48 hours.
              </p>
            </div>

            <div className="mt-4">
              <label
                htmlFor="delete-confirm"
                className="block text-sm font-medium text-text-primary"
              >
                Type <span className="font-mono text-danger">delete my account</span> to confirm:
              </label>
              <input
                id="delete-confirm"
                type="text"
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                autoComplete="off"
                className="mt-1 w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-danger/40"
                placeholder="delete my account"
              />
            </div>

            {deleteError && (
              <p className="mt-3 rounded-lg border border-danger/20 bg-danger/5 p-3 text-sm text-danger">
                {deleteError}
              </p>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDialogOpen(false)}
                disabled={isDeleting}
                className="rounded-full border border-border px-4 py-2 text-sm font-medium text-text-primary hover:bg-bg-secondary disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={isDeleting || confirmation !== 'delete my account'}
                className="rounded-full bg-danger px-4 py-2 text-sm font-medium text-white hover:bg-danger/90 disabled:opacity-50"
              >
                {isDeleting ? 'Deleting\u2026' : 'Delete my account'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
