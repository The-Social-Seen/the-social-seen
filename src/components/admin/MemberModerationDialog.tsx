'use client'

import { useState, useTransition } from 'react'
import { X } from 'lucide-react'
import {
  banMember,
  reinstateMember,
  suspendMember,
} from '@/app/(admin)/admin/actions'
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
 * Admin-facing dialog for ban/suspend/reinstate. One dialog handles all
 * three transitions — the buttons shown depend on the member's current
 * status:
 *   - active:    [Suspend] [Ban]
 *   - suspended: [Reinstate] [Ban]  (ban is an escalation)
 *   - banned:    [Reinstate]
 *
 * A free-text reason is required on every action (including reinstate —
 * "why are you unlocking?"). The reason is internal-only; the member
 * never sees it.
 */
export default function MemberModerationDialog({ open, member, onClose }: Props) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  if (!open) return null

  function run(action: (id: string, reason: string) => Promise<{ success: true } | { error: string }>) {
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

  const isActive = member.status === 'active'
  const isSuspended = member.status === 'suspended'
  const isBanned = member.status === 'banned'

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="mod-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-border bg-bg-card p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2
              id="mod-dialog-title"
              className="font-serif text-xl font-bold text-text-primary"
            >
              Moderate {member.full_name}
            </h2>
            <p className="mt-1 text-sm text-text-primary/60">
              Current status:{' '}
              <span className="font-medium text-text-primary">{member.status}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-text-tertiary hover:bg-bg-secondary hover:text-text-primary"
            aria-label="Close moderation dialog"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-4">
          <label
            htmlFor="moderation-reason"
            className="mb-1 block text-sm font-medium text-text-primary"
          >
            Reason <span className="text-text-tertiary">(internal only, not shown to the member)</span>
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
            Stored on the member&rsquo;s record for future reference. Max 500 chars.
          </p>
        </div>

        {error && (
          <p className="mb-4 rounded-lg border border-danger/20 bg-danger/5 p-3 text-sm text-danger">
            {error}
          </p>
        )}

        <div className="flex flex-wrap gap-2 justify-end">
          {(isSuspended || isBanned) && (
            <button
              type="button"
              onClick={() => run(reinstateMember)}
              disabled={isPending}
              className="rounded-full bg-success px-4 py-2 text-sm font-medium text-white hover:bg-success/90 disabled:opacity-50"
            >
              Reinstate
            </button>
          )}
          {(isActive || isBanned) && (
            <button
              type="button"
              onClick={() => run(suspendMember)}
              disabled={isPending || isBanned}
              className="rounded-full border border-gold/40 bg-gold/10 px-4 py-2 text-sm font-medium text-gold hover:bg-gold/20 disabled:opacity-50"
            >
              Suspend
            </button>
          )}
          {(isActive || isSuspended) && (
            <button
              type="button"
              onClick={() => run(banMember)}
              disabled={isPending}
              className="rounded-full bg-danger px-4 py-2 text-sm font-medium text-white hover:bg-danger/90 disabled:opacity-50"
            >
              Ban
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-border px-4 py-2 text-sm font-medium text-text-primary hover:bg-bg-secondary"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
