'use client'

import { useState, useTransition } from 'react'
import { Download, Trash2, ShieldCheck } from 'lucide-react'
import {
  deleteMyAccount,
  exportMyData,
} from '@/app/(member)/profile/privacy-actions'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'

/**
 * P2-8b — GDPR self-service surface on `/profile`.
 *
 * Two buttons:
 *   • Download my data — calls the `exportMyData` Server Action, writes
 *     the returned JSON to a blob, and triggers a browser download.
 *   • Delete my account — opens a typed-confirmation dialog (user must
 *     type "delete my account" before the destructive button enables).
 *     On success the action redirects to `/?account_deleted=1`; on
 *     failure we surface the error inline.
 *
 * Accessibility: Migrated to shared `<ConfirmDialog>` (Radix Dialog
 * underneath) in Phase 2.5 Batch 4 — focus trap, Escape-to-close,
 * return-focus, and scroll-lock all come free.
 */
export default function DataPrivacySection() {
  const [isExporting, startExport] = useTransition()
  const [dialogOpen, setDialogOpen] = useState(false)
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

  async function handleDeleteConfirm() {
    setDeleteError(null)
    // ConfirmDialog manages the startTransition for us, but
    // deleteMyAccount also redirects server-side on success so the
    // dialog close is a no-op in the happy path.
    const result = await deleteMyAccount('delete my account')
    if (!result.success) {
      setDeleteError(result.error ?? 'Could not delete your account.')
    }
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

      <ConfirmDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title="Delete your account?"
        description={
          <>
            <p>
              This will immediately close your account and anonymise your
              profile. After 30 days the record is hard-deleted.
            </p>
            <p className="rounded-lg border border-gold/30 bg-gold/5 p-3 text-xs">
              <strong>Heads-up:</strong> If you have a confirmed paid
              booking, cancel it first. The 48h refund policy still
              applies &mdash; deleting your account doesn&rsquo;t trigger
              refunds for events within 48 hours.
            </p>
          </>
        }
        typedConfirmation={{
          phrase: 'delete my account',
          inputLabel: (
            <>
              Type{' '}
              <span className="font-mono text-danger">delete my account</span>{' '}
              to confirm:
            </>
          ),
          inputPlaceholder: 'delete my account',
        }}
        confirmLabel="Delete my account"
        tone="danger"
        onConfirm={handleDeleteConfirm}
      >
        {deleteError && (
          <p className="rounded-lg border border-danger/20 bg-danger/5 p-3 text-sm text-danger">
            {deleteError}
          </p>
        )}
      </ConfirmDialog>
    </section>
  )
}
