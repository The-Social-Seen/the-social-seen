'use client'

/**
 * Admin "Cancel & Refund" confirmation modal.
 *
 * Opens from the EventsTable row action. Shows one of four copy variants
 * depending on the booking mix at the moment of confirmation
 * (paid / free / waitlist-only / zero) — spec §8.8.
 *
 * On submit, calls the `cancelEventAndRefundBookings` Server Action
 * (passed in as `onConfirm` so this component stays presentational and
 * easy to test). The destructive CTA is NOT auto-focused — admin must
 * deliberately tab to or click it. Cancel ("Keep Event") is the natural
 * close.
 *
 * Partial-failure surface: when the server returns `failedRefunds[]`,
 * the modal stays open after submit and renders an expandable
 * "Failed refunds" panel showing bookingId + email + error per row so
 * admin can manually retry from the Stripe dashboard.
 *
 * Copy strings are FINAL — verbatim from spec §8.8. Do not paraphrase.
 */

import { useState, useTransition } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, AlertTriangle, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { formatPrice } from '@/lib/utils/currency'
import type { CancelEventResult } from '@/app/(admin)/admin/actions'

export interface CancelEventModalProps {
  open: boolean
  event: {
    id: string
    title: string
    slug: string
  }
  /**
   * Pre-fetched counts that drive the copy variant. The parent fetches
   * these via `getEventCancelPreview` before opening the modal so the
   * admin sees the actual booking mix, not a stale EventWithStats
   * aggregate. See spec §8.8.
   *
   * Decision: Option B (new preview Server Action) — chosen over
   * Option A (re-use existing data) because EventsTable's
   * `EventWithStats` row only exposes `confirmed_count` (no paid/free
   * split, no waitlist count, no booking_fee_pence sum), so a derived
   * client-side calculation isn't possible. The preview helper is
   * a tiny read-only round-trip and keeps the diff focused.
   */
  bookingCounts: {
    confirmedPaid: number
    confirmedFree: number
    waitlisted: number
    totalRefundPence: number
  }
  onConfirm: (reason?: string) => Promise<CancelEventResult>
  onClose: () => void
}

type Outcome =
  | { kind: 'idle' }
  | { kind: 'success'; summary: NonNullable<CancelEventResult['summary']> }
  | { kind: 'partial'; summary: NonNullable<CancelEventResult['summary']> }
  | { kind: 'error'; message: string }

function pickVariant(
  c: CancelEventModalProps['bookingCounts'],
): 'paid' | 'free' | 'waitlist' | 'empty' {
  // Order matters: "paid" wins over "free"/"waitlist" if both exist on
  // the event so the admin always sees the refund disclosure when any
  // money is moving.
  if (c.confirmedPaid > 0) return 'paid'
  if (c.confirmedFree > 0) return 'free'
  if (c.waitlisted > 0) return 'waitlist'
  return 'empty'
}

function bodyCopy(
  variant: ReturnType<typeof pickVariant>,
  c: CancelEventModalProps['bookingCounts'],
): React.ReactNode {
  // Copy is FINAL — see spec §8.8 / cheat-sheet §8.9.
  switch (variant) {
    case 'paid':
      return (
        <>
          <p>
            This will cancel the event and refund a total of{' '}
            <span className="font-semibold text-text-primary">
              {formatPrice(c.totalRefundPence)}
            </span>{' '}
            to {c.confirmedPaid}{' '}
            {c.confirmedPaid === 1 ? 'member' : 'members'}. Refunds include
            the booking fees we charge for card processing — these will
            be absorbed by the platform. Members will receive a
            cancellation email.
          </p>
          <p className="font-semibold text-text-primary">
            This action cannot be undone.
          </p>
        </>
      )
    case 'free':
      return (
        <>
          <p>
            This will cancel the event and notify {c.confirmedFree}{' '}
            confirmed {c.confirmedFree === 1 ? 'member' : 'members'}. No
            refunds needed (free event).
          </p>
          <p className="font-semibold text-text-primary">
            This action cannot be undone.
          </p>
        </>
      )
    case 'waitlist':
      return (
        <>
          <p>
            This will cancel the event and notify {c.waitlisted} waitlisted{' '}
            {c.waitlisted === 1 ? 'member' : 'members'}.
          </p>
          <p className="font-semibold text-text-primary">
            This action cannot be undone.
          </p>
        </>
      )
    case 'empty':
      return (
        <>
          <p>This will cancel the event. No members will be affected.</p>
          <p className="font-semibold text-text-primary">
            This action cannot be undone.
          </p>
        </>
      )
  }
}

export default function CancelEventModal({
  open,
  event,
  bookingCounts,
  onConfirm,
  onClose,
}: CancelEventModalProps) {
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'idle' })
  const [isPending, startTransition] = useTransition()
  const [failedExpanded, setFailedExpanded] = useState(false)

  const variant = pickVariant(bookingCounts)

  function handleConfirm() {
    startTransition(async () => {
      const result = await onConfirm()

      if (!result.success || !result.summary) {
        setOutcome({
          kind: 'error',
          message: result.error ?? 'Something went wrong. Please try again.',
        })
        return
      }

      // Partial failure path: any Stripe refund attempt failed. Modal
      // stays open and surfaces the failed rows so the admin can
      // manually retry from Stripe.
      if (result.summary.failedRefunds.length > 0) {
        // Also console.group the failures so they're discoverable in
        // devtools regardless of modal interaction — spec §8.8 line 1154.
        if (typeof console !== 'undefined' && console.group) {
          console.group(
            `[cancelEventAndRefundBookings] ${result.summary.failedRefunds.length} refund(s) failed`,
          )
          for (const f of result.summary.failedRefunds) {
            console.error(`booking ${f.bookingId} (${f.userEmail}): ${f.error}`)
          }
          console.groupEnd()
        }
        setOutcome({ kind: 'partial', summary: result.summary })
        return
      }

      setOutcome({ kind: 'success', summary: result.summary })
    })
  }

  function handleOpenChange(next: boolean) {
    // Block close while submission is in flight to prevent accidental
    // dismissal of an action that's still running.
    if (!next && isPending) return
    if (!next) {
      // Reset local state so a re-open of the modal starts fresh.
      setOutcome({ kind: 'idle' })
      setFailedExpanded(false)
      onClose()
    }
  }

  // The submit button hides once we have a success or partial outcome —
  // the modal becomes a result panel with a single "Done" close.
  const showSubmit = outcome.kind === 'idle' || outcome.kind === 'error'

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        {/*
          Bottom-sheet on mobile, centred card on desktop — same pattern
          as MemberModerationDialog and ConfirmDialog for coherence.
        */}
        <Dialog.Content
          className={cn(
            'fixed z-50 border border-border bg-bg-card shadow-xl',
            // Mobile bottom-sheet positioning
            'inset-x-0 bottom-0 top-auto w-full max-h-[90vh] overflow-y-auto rounded-t-2xl rounded-b-none p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]',
            // Desktop centred-card overrides
            'md:inset-x-auto md:left-1/2 md:top-1/2 md:bottom-auto md:max-w-md md:max-h-none md:overflow-visible md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl md:pb-6',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold',
            // Mobile slide-up animation, desktop zoom animation
            'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
            'data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom',
            'md:data-[state=closed]:slide-out-to-bottom-0 md:data-[state=open]:slide-in-from-bottom-0',
            'md:data-[state=closed]:zoom-out-95 md:data-[state=open]:zoom-in-95',
          )}
        >
          {/* Mobile drag handle (visual cue only — not interactive) */}
          <div className="md:hidden -mt-2 mb-3 flex justify-center">
            <span aria-hidden="true" className="h-1 w-10 rounded-full bg-border" />
          </div>

          <div className="mb-3 flex items-start justify-between gap-3">
            <Dialog.Title className="font-serif text-xl font-bold text-text-primary">
              Cancel &ldquo;{event.title}&rdquo;?
            </Dialog.Title>
            <Dialog.Close
              className="rounded-lg p-1 text-text-tertiary transition-colors hover:bg-bg-secondary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold disabled:opacity-50 disabled:cursor-not-allowed min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 flex items-center justify-center"
              aria-label="Close dialog"
              disabled={isPending}
            >
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          <Dialog.Description asChild>
            <div className="space-y-3 text-sm text-text-primary/80">
              {outcome.kind === 'idle' || outcome.kind === 'error'
                ? bodyCopy(variant, bookingCounts)
                : null}

              {outcome.kind === 'success' && (
                <div
                  role="status"
                  className="rounded-xl border border-success/30 bg-success/10 p-3 text-text-primary"
                >
                  <p>
                    Cancelled &ldquo;{event.title}&rdquo;.{' '}
                    {outcome.summary.refundedCount > 0
                      ? `Refunded ${formatPrice(outcome.summary.refundedTotalPence)} to ${outcome.summary.refundedCount} ${outcome.summary.refundedCount === 1 ? 'member' : 'members'}.`
                      : 'No refunds were needed.'}
                  </p>
                </div>
              )}

              {outcome.kind === 'partial' && (
                <PartialFailurePanel
                  eventTitle={event.title}
                  summary={outcome.summary}
                  expanded={failedExpanded}
                  onToggle={() => setFailedExpanded((v) => !v)}
                />
              )}
            </div>
          </Dialog.Description>

          {outcome.kind === 'error' && (
            <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-danger/30 bg-danger/10 p-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-danger" />
              <p className="text-sm text-danger">{outcome.message}</p>
            </div>
          )}

          {/*
            Mobile: stack actions full-width, primary at the bottom
            (closest to the thumb) via flex-col-reverse. Desktop:
            horizontal row, right-aligned, destructive on the right.
            Note: NO autoFocus on the destructive button — admin must
            deliberately click/tab to it (spec §8.8 hard rule).
          */}
          <div className="mt-5 flex flex-col-reverse gap-2 md:flex-row md:justify-end">
            <Dialog.Close
              className={cn(
                'rounded-full border border-border px-4 py-2 text-sm font-medium text-text-primary transition-colors hover:bg-bg-secondary disabled:opacity-50 min-h-[44px] md:min-h-0 w-full md:w-auto',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold',
              )}
              disabled={isPending}
            >
              {showSubmit ? 'Keep Event' : 'Done'}
            </Dialog.Close>
            {showSubmit && (
              <button
                type="button"
                onClick={handleConfirm}
                disabled={isPending}
                className={cn(
                  'rounded-full bg-danger px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-danger/90 disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px] md:min-h-0 w-full md:w-auto',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold',
                )}
              >
                {isPending ? 'Cancelling…' : 'Cancel Event & Refund'}
              </button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

// ── Partial-failure panel ────────────────────────────────────────────────────
//
// Renders the partial-failure copy from spec §8.8 plus an expandable
// list of every booking whose Stripe refund failed. Surface is in-modal
// (no toast system in this codebase yet) so the admin can copy the
// bookingId / email straight from here to retry in Stripe.

function PartialFailurePanel({
  eventTitle,
  summary,
  expanded,
  onToggle,
}: {
  eventTitle: string
  summary: NonNullable<CancelEventResult['summary']>
  expanded: boolean
  onToggle: () => void
}) {
  const failedCount = summary.failedRefunds.length
  // Total bookings the admin was trying to refund (successful + failed).
  // Matches the `M` in the spec's partial-failure toast copy.
  const totalAttempted = summary.refundedCount + failedCount

  return (
    <div
      role="alert"
      className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-text-primary"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-danger" />
        <p>
          Cancelled &ldquo;{eventTitle}&rdquo;. {summary.refundedCount} of{' '}
          {totalAttempted} refunds processed. {failedCount} failed — see
          Stripe dashboard for manual retry.
        </p>
      </div>

      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-danger transition-colors hover:text-danger/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold rounded-md"
      >
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 transition-transform',
            expanded && 'rotate-180',
          )}
          aria-hidden="true"
        />
        {expanded
          ? 'Hide failed refunds'
          : `Show ${failedCount} failed refund${failedCount === 1 ? '' : 's'}`}
      </button>

      {expanded && (
        <ul className="mt-3 space-y-2 text-xs">
          {summary.failedRefunds.map((failure) => (
            <li
              key={failure.bookingId}
              className="rounded-lg border border-border bg-bg-card p-2"
            >
              <p className="font-mono text-text-primary">{failure.bookingId}</p>
              <p className="text-text-primary/70">{failure.userEmail}</p>
              <p className="mt-1 text-danger">{failure.error}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
