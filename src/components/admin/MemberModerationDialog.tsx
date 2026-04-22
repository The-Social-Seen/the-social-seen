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
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-bg-card p-6 shadow-xl',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold',
            'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
          )}
        >
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
              className="rounded-lg p-1 text-text-tertiary transition-colors hover:bg-bg-secondary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
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

          <div className="flex flex-wrap justify-end gap-2">
            {(isSuspended || isBanned) && (
              <button
                type="button"
                onClick={() => run(reinstateMember)}
                disabled={isPending}
                className="rounded-full bg-success px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-success/90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
              >
                Reinstate
              </button>
            )}
            {(isActive || isBanned) && (
              <button
                type="button"
                onClick={() => run(suspendMember)}
                disabled={isPending || isBanned}
                className="rounded-full border border-gold/40 bg-gold/10 px-4 py-2 text-sm font-medium text-gold transition-colors hover:bg-gold/20 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
              >
                Suspend
              </button>
            )}
            {(isActive || isSuspended) && (
              <button
                type="button"
                onClick={() => run(banMember)}
                disabled={isPending}
                className="rounded-full bg-danger px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-danger/90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
              >
                Ban
              </button>
            )}
            <Dialog.Close
              className="rounded-full border border-border px-4 py-2 text-sm font-medium text-text-primary transition-colors hover:bg-bg-secondary disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
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
