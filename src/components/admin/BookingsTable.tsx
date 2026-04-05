'use client'

import { useState, useTransition } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { Download } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { exportEventAttendeesCSV } from '@/app/(admin)/admin/actions'
import PromoteButton from './PromoteButton'

interface BookingRow {
  id: string
  status: string
  waitlist_position: number | null
  booked_at: string
  created_at: string
  profile: { id: string; full_name: string; email: string; avatar_url: string | null } | null
}

interface BookingsTableProps {
  bookings: BookingRow[]
  eventId: string
}

const TABS = [
  { key: 'all', label: 'All' },
  { key: 'confirmed', label: 'Confirmed' },
  { key: 'waitlisted', label: 'Waitlisted' },
  { key: 'cancelled', label: 'Cancelled' },
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

export default function BookingsTable({ bookings, eventId }: BookingsTableProps) {
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
      <div className="flex items-center justify-between flex-wrap gap-3">
        {/* Filter tabs */}
        <div className="flex items-center gap-1 bg-bg-secondary rounded-lg p-1">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                'px-3 py-1.5 text-sm font-medium rounded-md transition-colors min-h-[36px]',
                activeTab === tab.key
                  ? 'bg-bg-card text-text-primary shadow-sm'
                  : 'text-text-tertiary hover:text-text-primary'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <button
          onClick={handleExport}
          disabled={isExporting}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-text-secondary hover:text-text-primary transition-colors disabled:opacity-50"
        >
          <Download className="w-4 h-4" />
          {isExporting ? 'Exporting...' : 'Export CSV'}
        </button>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-text-tertiary py-8 text-center">No bookings found</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="pb-3 font-medium text-text-tertiary">Name</th>
                <th className="pb-3 font-medium text-text-tertiary hidden md:table-cell">Email</th>
                <th className="pb-3 font-medium text-text-tertiary">Status</th>
                <th className="pb-3 font-medium text-text-tertiary hidden md:table-cell">Booked</th>
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
                    <td className="py-3 pr-4 text-text-secondary hidden md:table-cell">
                      {profile?.email ?? '—'}
                    </td>
                    <td className="py-3 pr-4">{statusBadge(booking.status)}</td>
                    <td className="py-3 pr-4 text-text-tertiary hidden md:table-cell whitespace-nowrap">
                      {formatDistanceToNow(new Date(booking.created_at), { addSuffix: true })}
                    </td>
                    <td className="py-3 pr-4 text-text-tertiary hidden lg:table-cell">
                      {booking.waitlist_position ?? '—'}
                    </td>
                    <td className="py-3 text-right">
                      {booking.status === 'waitlisted' && (
                        <PromoteButton bookingId={booking.id} />
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
