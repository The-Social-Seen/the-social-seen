'use client'

import { useState, useTransition } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import {
  banMember,
  reinstateMember,
  suspendMember,
} from '@/app/(admin)/admin/actions'
import { cn } from '@/lib/utils/cn'
import type { UserStatus } from '@/types'

interface Props {
  open: boolean
  member: {
    id: string
    full_name: string
    status: UserStatus
  }
  onClose: () => void
}

/**
 * Admin-facing moderation dialog — one dialog handles ban / suspend /
 * reinstate depending on the member's current status.
 *
 *   - active:    [Suspend] [Ban]
 *   - suspended: [Reinstate] [Ban]  (ban is an escalation)
 *   - banned:    [Reinstate]
 *
 * A free-text reason is required on every action (including reinstate —
 * "why are you unlocking?"). Reason is internal-only; the member never
 * sees it.
 *
 * Migrated from a home-rolled `<div role="dialog">` to Radix Dialog in
 * Phase 2.5 Batch 4 — Radix gives focus trap + Escape-to-close + return-
 * focus + portal + scroll-lock out of the box.
 */
export default function MemberModerationDialog({
  open,
  member,
  onClose,
}: Props) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function run(
    action: (
      id: string,
      reason: string,
    ) => Promise<{ success: true } | { error: string }>,
  ) {
    setError(null)
    startTransition(async () => {
      const trimmed = reason.trim()
      if (trimmed.length < 3) {
        setError('Please enter a reason (at least 3 characters).')
        return
      }
      const result = await action(member.id, trimmed)
      if ('error' in result) {
        setError(result.error)
        return
      }
      setReason('')
      onClose()
    })
  }

  function handleOpenChange(next: boolean) {
    // Block close while a transition is in flight.
    if (!next && isPending) return
    if (!next) {
      setReason('')
      setError(null)
      onClose()
    }
  }

  const isActive = member.status === 'active'
  const isSuspended = member.status === 'suspended'
  const isBanned = member.status === 'banned'

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        {/*
          Bottom-sheet on mobile, centred card on desktop — matches the
          public BookingModal pattern. See ConfirmDialog for the same
          treatment; this dialog is bespoke (4 stateful action buttons)
          so we duplicate the responsive class set rather than try to
          force everything through ConfirmDialog.
        */}
        <Dialog.Content
          className={cn(
            'fixed z-50 border border-border bg-bg-card shadow-xl',
            'inset-x-0 bottom-0 top-auto w-full max-h-[90vh] overflow-y-auto rounded-t-2xl rounded-b-none p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]',
            'md:inset-x-auto md:left-1/2 md:top-1/2 md:bottom-auto md:max-w-md md:max-h-none md:overflow-visible md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl md:pb-6',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold',
            'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
            'data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom',
            'md:data-[state=closed]:slide-out-to-bottom-0 md:data-[state=open]:slide-in-from-bottom-0',
            'md:data-[state=closed]:zoom-out-95 md:data-[state=open]:zoom-in-95',
          )}
        >
          {/* Mobile drag handle (visual cue only) */}
          <div className="md:hidden -mt-2 mb-3 flex justify-center">
            <span aria-hidden="true" className="h-1 w-10 rounded-full bg-border" />
          </div>

          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <Dialog.Title className="font-serif text-xl font-bold text-text-primary">
                Moderate {member.full_name}
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-text-primary/60">
                Current status:{' '}
                <span className="font-medium text-text-primary">
                  {member.status}
                </span>
              </Dialog.Description>
            </div>
            <Dialog.Close
              className="rounded-lg p-1 text-text-tertiary transition-colors hover:bg-bg-secondary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 flex items-center justify-center shrink-0"
              aria-label="Close moderation dialog"
            >
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          <div className="mb-4">
            <label
              htmlFor="moderation-reason"
              className="mb-1 block text-sm font-medium text-text-primary"
            >
              Reason{' '}
              <span className="text-text-tertiary">
                (internal only, not shown to the member)
              </span>
            </label>
            <textarea
              id="moderation-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={500}
              className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-gold/50"
              placeholder="e.g. 3 consecutive no-shows; payment dispute; abusive email"
            />
            <p className="mt-1 text-xs text-text-tertiary">
              Stored on the member&rsquo;s record for future reference.
              Max 500 chars.
            </p>
          </div>

          {error && (
            <p className="mb-4 rounded-lg border border-danger/20 bg-danger/5 p-3 text-sm text-danger">
              {error}
            </p>
          )}

          {/*
            Mobile: actions stack full-width, top→bottom Reinstate, Suspend,
            Ban, Cancel. Per spec §1.5 — most destructive (Ban) is in the
            primary-thumb zone; Cancel anchors the bottom as the safe exit.
            Desktop: original right-aligned wrap-row.
          */}
          <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:justify-end">
            {(isSuspended || isBanned) && (
              <button
                type="button"
                onClick={() => run(reinstateMember)}
                disabled={isPending}
                className="rounded-full bg-success px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-success/90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold min-h-[44px] md:min-h-0 w-full md:w-auto"
              >
                Reinstate
              </button>
            )}
            {(isActive || isBanned) && (
              <button
                type="button"
                onClick={() => run(suspendMember)}
                disabled={isPending || isBanned}
                className="rounded-full border border-gold/40 bg-gold/10 px-4 py-2 text-sm font-medium text-gold transition-colors hover:bg-gold/20 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold min-h-[44px] md:min-h-0 w-full md:w-auto"
              >
                Suspend
              </button>
            )}
            {(isActive || isSuspended) && (
              <button
                type="button"
                onClick={() => run(banMember)}
                disabled={isPending}
                className="rounded-full bg-danger px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-danger/90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold min-h-[44px] md:min-h-0 w-full md:w-auto"
              >
                Ban
              </button>
            )}
            <Dialog.Close
              className="rounded-full border border-border px-4 py-2 text-sm font-medium text-text-primary transition-colors hover:bg-bg-secondary disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold min-h-[44px] md:min-h-0 w-full md:w-auto"
              disabled={isPending}
            >
              Cancel
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
