'use client'

import { useState, useTransition } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { RotateCw } from 'lucide-react'
import { retryNotification } from '@/app/(admin)/admin/actions'
import type { FailedNotification } from '@/app/(admin)/admin/actions'

interface FailedNotificationsTableProps {
  notifications: FailedNotification[]
}

export default function FailedNotificationsTable({
  notifications,
}: FailedNotificationsTableProps) {
  const [retryingId, setRetryingId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{
    id: string
    kind: 'success' | 'error'
    message: string
  } | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleRetry(id: string) {
    setFeedback(null)
    setRetryingId(id)
    startTransition(async () => {
      const result = await retryNotification(id)
      if ('error' in result) {
        setFeedback({ id, kind: 'error', message: result.error })
      } else {
        setFeedback({ id, kind: 'success', message: 'Retry sent.' })
      }
      setRetryingId(null)
    })
  }

  if (notifications.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-text-tertiary">
          No failed notifications. Everything&rsquo;s landing in inboxes.
        </p>
      </div>
    )
  }

  return (
    <>
      {/* Desktop table (≥ md) */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <th className="pb-3 font-medium text-text-tertiary">When</th>
              <th className="pb-3 font-medium text-text-tertiary">Template</th>
              <th className="pb-3 font-medium text-text-tertiary">Recipient</th>
              <th className="pb-3 font-medium text-text-tertiary hidden lg:table-cell">
                Subject
              </th>
              <th className="pb-3 font-medium text-text-tertiary">Error</th>
              <th className="pb-3 font-medium text-text-tertiary text-right">
                Action
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {notifications.map((n) => {
              const row = feedback?.id === n.id ? feedback : null
              return (
                <tr key={n.id} className="align-top">
                  <td className="py-3 pr-4 whitespace-nowrap text-text-secondary">
                    {formatDistanceToNow(new Date(n.sent_at), { addSuffix: true })}
                    {n.retried_at && (
                      <span className="block text-[11px] text-text-tertiary">
                        Last retry:{' '}
                        {formatDistanceToNow(new Date(n.retried_at), {
                          addSuffix: true,
                        })}
                      </span>
                    )}
                  </td>
                  <td className="py-3 pr-4 text-text-secondary">
                    {n.template_name ?? '—'}
                  </td>
                  <td className="py-3 pr-4 text-text-secondary truncate max-w-[200px]">
                    {n.recipient_email ?? '—'}
                  </td>
                  <td className="py-3 pr-4 text-text-secondary hidden lg:table-cell truncate max-w-[240px]">
                    {n.subject}
                  </td>
                  <td className="py-3 pr-4 text-text-secondary max-w-[280px]">
                    <span className="block truncate" title={n.error_message ?? ''}>
                      {n.error_message ?? 'Unknown error'}
                    </span>
                    {row && (
                      <span
                        className={
                          row.kind === 'success'
                            ? 'block text-xs text-emerald-600 mt-1'
                            : 'block text-xs text-red-600 mt-1'
                        }
                        role={row.kind === 'error' ? 'alert' : 'status'}
                      >
                        {row.message}
                      </span>
                    )}
                  </td>
                  <td className="py-3 text-right">
                    <button
                      type="button"
                      onClick={() => handleRetry(n.id)}
                      disabled={isPending && retryingId === n.id}
                      className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-border hover:bg-bg-secondary transition-colors text-xs font-medium text-text-primary disabled:opacity-50 min-h-[44px]"
                      aria-label={`Retry send for ${n.subject}`}
                    >
                      <RotateCw
                        className={`w-3.5 h-3.5 ${isPending && retryingId === n.id ? 'animate-spin' : ''}`}
                      />
                      Retry
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile cards (< md) */}
      <ul className="md:hidden space-y-3">
        {notifications.map((n) => {
          const row = feedback?.id === n.id ? feedback : null
          const isRetrying = isPending && retryingId === n.id
          return (
            <li key={n.id}>
              <article className="rounded-lg border border-border bg-bg-card p-4 space-y-3">
                {/* Title row */}
                <div className="flex items-start justify-between gap-3">
                  <p className="font-medium text-text-primary truncate min-w-0 flex-1">
                    {n.template_name ?? 'Unknown template'}
                  </p>
                  <span className="text-xs text-text-tertiary whitespace-nowrap shrink-0">
                    {formatDistanceToNow(new Date(n.sent_at), { addSuffix: true })}
                  </span>
                </div>

                {/* Body */}
                <dl className="space-y-1.5 text-sm">
                  {n.recipient_email && (
                    <div className="flex items-start justify-between gap-3">
                      <dt className="text-text-tertiary shrink-0">Recipient</dt>
                      <dd
                        className="text-text-secondary text-right truncate max-w-[60%]"
                        title={n.recipient_email}
                      >
                        {n.recipient_email}
                      </dd>
                    </div>
                  )}
                  {n.subject && (
                    <div className="flex items-start justify-between gap-3">
                      <dt className="text-text-tertiary shrink-0">Subject</dt>
                      <dd
                        className="text-text-secondary text-right truncate max-w-[60%]"
                        title={n.subject}
                      >
                        {n.subject}
                      </dd>
                    </div>
                  )}
                  <div className="pt-1">
                    <dt className="text-text-tertiary text-xs mb-1">Error</dt>
                    <dd className="text-text-secondary text-xs break-words">
                      {n.error_message ?? 'Unknown error'}
                    </dd>
                  </div>
                  {n.retried_at && (
                    <p className="text-[11px] text-text-tertiary">
                      Last retry:{' '}
                      {formatDistanceToNow(new Date(n.retried_at), {
                        addSuffix: true,
                      })}
                    </p>
                  )}
                </dl>

                {/* Action row */}
                <div className="flex items-center border-t border-border pt-3">
                  <button
                    type="button"
                    onClick={() => handleRetry(n.id)}
                    disabled={isRetrying}
                    className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-full border border-border text-sm font-medium text-text-primary hover:bg-bg-secondary transition-colors disabled:opacity-50 min-h-[44px]"
                    aria-label={`Retry send for ${n.subject}`}
                  >
                    <RotateCw className={`w-4 h-4 ${isRetrying ? 'animate-spin' : ''}`} />
                    {isRetrying ? 'Retrying…' : 'Retry'}
                  </button>
                </div>

                {row && (
                  <p
                    className={
                      row.kind === 'success'
                        ? 'text-xs text-emerald-600'
                        : 'text-xs text-red-600'
                    }
                    role={row.kind === 'error' ? 'alert' : 'status'}
                  >
                    {row.message}
                  </p>
                )}
              </article>
            </li>
          )
        })}
      </ul>
    </>
  )
}
