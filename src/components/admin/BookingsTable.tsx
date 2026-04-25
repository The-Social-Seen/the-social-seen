'use client'

import { useState, useTransition } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { Download, UserX, Undo2 } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { exportEventAttendeesCSV, setNoShow } from '@/app/(admin)/admin/actions'
import PromoteButton from './PromoteButton'

// Filter tabs use a shorter "Waitlist" label below md: so all five fit
// in a wrap-to-2-rows segmented control without overflowing 375px.
const TAB_LABEL_MOBILE: Record<string, string> = {
  waitlisted: 'Waitlist',
}

interface BookingRow {
  id: string
  status: string
  waitlist_position: number | null
  booked_at: string
  created_at: string
  // P2-7b: payment + refund audit columns. All nullable.
  stripe_payment_id?: string | null
  stripe_refund_id?: string | null
  refunded_amount_pence?: number | null
  cancelled_at?: string | null
  profile: { id: string; full_name: string; email: string; avatar_url: string | null } | null
}

function paymentBadge(b: BookingRow) {
  // Only meaningful for bookings that went through Stripe.
  if (!b.stripe_payment_id && !b.stripe_refund_id) return null
  if (b.stripe_refund_id) {
    const amount = b.refunded_amount_pence ?? 0
    return (
      <span
        className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400"
        title={`Refund id: ${b.stripe_refund_id}`}
      >
        Refunded {amount > 0 ? `£${(amount / 100).toFixed(0)}` : ''}
      </span>
    )
  }
  return (
    <span
      className="text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400"
      title={`PaymentIntent: ${b.stripe_payment_id}`}
    >
      Paid
    </span>
  )
}

interface BookingsTableProps {
  bookings: BookingRow[]
  eventId: string
  /**
   * P2-8a: true if the event's date_time is in the past. Enables the
   * "Mark No-Show" toggle on confirmed attendee rows.
   */
  isPastEvent?: boolean
}

// P2-8a: no_show is a new admin-visible status.
const TABS = [
  { key: 'all', label: 'All' },
  { key: 'confirmed', label: 'Confirmed' },
  { key: 'waitlisted', label: 'Waitlisted' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'no_show', label: 'No-shows' },
] as const

function statusBadge(status: string) {
  switch (status) {
    case 'confirmed':
      return <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400">Confirmed</span>
    case 'waitlisted':
      return <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gold/10 text-gold">Waitlisted</span>
    case 'cancelled':
      return <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400">Cancelled</span>
    case 'no_show':
      return <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-bg-secondary text-text-tertiary">No Show</span>
    default:
      return <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-bg-secondary text-text-tertiary">{status}</span>
  }
}

export default function BookingsTable({
  bookings,
  eventId,
  isPastEvent = false,
}: BookingsTableProps) {
  const [activeTab, setActiveTab] = useState<string>('all')
  const [isExporting, startExport] = useTransition()

  const filtered = activeTab === 'all'
    ? bookings
    : bookings.filter((b) => b.status === activeTab)

  function handleExport() {
    startExport(async () => {
      const csv = await exportEventAttendeesCSV(eventId)
      const blob = new Blob([csv], { type: 'text/csv' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `attendees-${eventId}.csv`
      a.click()
      URL.revokeObjectURL(url)
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between md:flex-wrap">
        {/* Filter tabs — wrap to two rows on mobile */}
        <div className="flex flex-wrap items-center gap-1 bg-bg-secondary rounded-lg p-1">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                'px-3 py-1.5 text-sm font-medium rounded-md transition-colors min-h-[44px] md:min-h-[36px]',
                activeTab === tab.key
                  ? 'bg-bg-card text-text-primary shadow-sm'
                  : 'text-text-tertiary hover:text-text-primary'
              )}
            >
              <span className="md:hidden">{TAB_LABEL_MOBILE[tab.key] ?? tab.label}</span>
              <span className="hidden md:inline">{tab.label}</span>
            </button>
          ))}
        </div>

        <button
          onClick={handleExport}
          disabled={isExporting}
          className="inline-flex items-center justify-center gap-1.5 text-sm font-medium text-gold border border-gold/40 rounded-full px-4 py-2 min-h-[44px] hover:bg-gold/5 transition-colors disabled:opacity-50 md:border-0 md:rounded-none md:px-0 md:py-0 md:min-h-0 md:text-text-secondary md:hover:bg-transparent md:hover:text-text-primary"
        >
          <Download className="w-4 h-4" />
          {isExporting ? 'Exporting...' : 'Export CSV'}
        </button>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-text-tertiary py-8 text-center">No bookings found</p>
      ) : (
        <>
          {/* Desktop table (≥ md) */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="pb-3 font-medium text-text-tertiary">Name</th>
                  <th className="pb-3 font-medium text-text-tertiary">Email</th>
                  <th className="pb-3 font-medium text-text-tertiary">Status</th>
                  <th className="pb-3 font-medium text-text-tertiary">Payment</th>
                  <th className="pb-3 font-medium text-text-tertiary">Booked</th>
                  <th className="pb-3 font-medium text-text-tertiary hidden lg:table-cell">Waitlist #</th>
                  <th className="pb-3 font-medium text-text-tertiary text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((booking) => {
                  const profile = Array.isArray(booking.profile)
                    ? booking.profile[0]
                    : booking.profile
                  return (
                    <tr key={booking.id} className="hover:bg-bg-secondary/50 transition-colors">
                      <td className="py-3 pr-4 font-medium text-text-primary">
                        {profile?.full_name ?? 'Unknown'}
                      </td>
                      <td className="py-3 pr-4 text-text-secondary">
                        {profile?.email ?? '—'}
                      </td>
                      <td className="py-3 pr-4">{statusBadge(booking.status)}</td>
                      <td className="py-3 pr-4">
                        {paymentBadge(booking) ?? (
                          <span className="text-xs text-text-tertiary">&mdash;</span>
                        )}
                      </td>
                      <td className="py-3 pr-4 text-text-tertiary whitespace-nowrap">
                        {formatDistanceToNow(new Date(booking.created_at), { addSuffix: true })}
                      </td>
                      <td className="py-3 pr-4 text-text-tertiary hidden lg:table-cell">
                        {booking.waitlist_position ?? '—'}
                      </td>
                      <td className="py-3 text-right">
                        {booking.status === 'waitlisted' && (
                          <PromoteButton bookingId={booking.id} />
                        )}
                        {isPastEvent && booking.status === 'confirmed' && (
                          <NoShowButton bookingId={booking.id} on={true} />
                        )}
                        {isPastEvent && booking.status === 'no_show' && (
                          <NoShowButton bookingId={booking.id} on={false} />
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards (< md) */}
          <ul className="md:hidden space-y-3">
            {filtered.map((booking) => {
              const profile = Array.isArray(booking.profile)
                ? booking.profile[0]
                : booking.profile
              const showPromote = booking.status === 'waitlisted'
              const showNoShow = isPastEvent && booking.status === 'confirmed'
              const showUndoNoShow = isPastEvent && booking.status === 'no_show'
              const hasAction = showPromote || showNoShow || showUndoNoShow
              const payBadge = paymentBadge(booking)
              return (
                <li key={booking.id}>
                  <article className="rounded-lg border border-border bg-bg-card p-4 space-y-3">
                    {/* Title row */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-text-primary truncate">
                          {profile?.full_name ?? 'Unknown'}
                        </p>
                        {profile?.email && (
                          <p
                            className="text-xs text-text-tertiary truncate"
                            title={profile.email}
                          >
                            {profile.email}
                          </p>
                        )}
                      </div>
                      <div className="shrink-0">{statusBadge(booking.status)}</div>
                    </div>

                    {/* Body */}
                    <dl className="space-y-1.5 text-sm">
                      {payBadge && (
                        <div className="flex items-center justify-between gap-3">
                          <dt className="text-text-tertiary">Payment</dt>
                          <dd>{payBadge}</dd>
                        </div>
                      )}
                      <div className="flex items-center justify-between gap-3">
                        <dt className="text-text-tertiary">Booked</dt>
                        <dd className="text-text-secondary">
                          {formatDistanceToNow(new Date(booking.created_at), { addSuffix: true })}
                        </dd>
                      </div>
                      {booking.waitlist_position !== null && (
                        <div className="flex items-center justify-between gap-3">
                          <dt className="text-text-tertiary">Waitlist #</dt>
                          <dd className="text-text-secondary">
                            {booking.waitlist_position}
                          </dd>
                        </div>
                      )}
                    </dl>

                    {/* Action row */}
                    {hasAction && (
                      <div className="flex items-center gap-2 border-t border-border pt-3">
                        {showPromote && (
                          <PromoteButton bookingId={booking.id} fullWidth />
                        )}
                        {showNoShow && (
                          <NoShowButton bookingId={booking.id} on={true} fullWidth />
                        )}
                        {showUndoNoShow && (
                          <NoShowButton bookingId={booking.id} on={false} fullWidth />
                        )}
                      </div>
                    )}
                  </article>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </div>
  )
}

// ── Per-row no-show toggle ────────────────────────────────────────────────

/**
 * `on={true}` — promote confirmed → no_show.
 * `on={false}` — revert no_show → confirmed (undo a mistaken mark).
 *
 * `fullWidth` is set by the mobile card list so the button fills the
 * action row; default is the desktop pill width.
 */
function NoShowButton({
  bookingId,
  on,
  fullWidth = false,
}: {
  bookingId: string
  on: boolean
  fullWidth?: boolean
}) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleClick() {
    setError(null)
    startTransition(async () => {
      const result = await setNoShow(bookingId, on)
      if ('error' in result) setError(result.error)
    })
  }

  return (
    <span
      className={cn(
        'flex flex-col gap-0.5',
        fullWidth ? 'w-full' : 'inline-flex items-end',
      )}
    >
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        title={on ? 'Mark this attendee as a no-show' : 'Undo no-show — restore to confirmed'}
        className={cn(
          'inline-flex items-center justify-center gap-1 rounded-full border text-xs font-medium transition-colors disabled:opacity-50',
          fullWidth
            ? 'w-full px-4 py-2.5 text-sm min-h-[44px]'
            : 'px-3 py-1 min-h-[44px] md:min-h-[36px]',
          on
            ? 'border-danger/30 text-danger hover:bg-danger/5'
            : 'border-border text-text-primary hover:bg-bg-secondary',
        )}
      >
        {on ? <UserX className="h-3.5 w-3.5" /> : <Undo2 className="h-3.5 w-3.5" />}
        {isPending ? '…' : on ? 'No-show' : 'Undo no-show'}
      </button>
      {error && <span className={cn('text-[10px] text-danger', fullWidth && 'text-center')}>{error}</span>}
    </span>
  )
}
