'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { Pencil, Users, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { formatDateCard } from '@/lib/utils/dates'
import { formatPrice } from '@/lib/utils/currency'
import { resolveEventImage } from '@/lib/utils/images'
import { categoryLabel } from '@/types'
import { softDeleteEvent } from '@/app/(admin)/admin/actions'
import type { EventWithStats } from '@/types'

interface EventsTableProps {
  events: EventWithStats[]
}

function statusBadge(event: EventWithStats) {
  if (event.is_cancelled) {
    return <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400">Cancelled</span>
  }
  if (new Date(event.date_time) < new Date()) {
    return <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-bg-secondary text-text-tertiary">Past</span>
  }
  if (!event.is_published) {
    return <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-bg-secondary text-text-tertiary">Draft</span>
  }
  return <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400">Published</span>
}

export default function EventsTable({ events }: EventsTableProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleDelete(eventId: string, title: string) {
    if (!confirm(`Are you sure you want to delete "${title}"? This cannot be undone.`)) return
    setDeletingId(eventId)
    startTransition(async () => {
      const result = await softDeleteEvent(eventId)
      if (result.error) {
        alert(result.error)
      }
      setDeletingId(null)
    })
  }

  if (events.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-text-tertiary">No events yet. Create your first event to get started.</p>
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
              <th className="pb-3 font-medium text-text-tertiary">Event</th>
              <th className="pb-3 font-medium text-text-tertiary">Date</th>
              <th className="pb-3 font-medium text-text-tertiary hidden lg:table-cell">Category</th>
              <th className="pb-3 font-medium text-text-tertiary">Price</th>
              <th className="pb-3 font-medium text-text-tertiary hidden lg:table-cell">Booked</th>
              <th className="pb-3 font-medium text-text-tertiary">Status</th>
              <th className="pb-3 font-medium text-text-tertiary text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {events.map((event) => {
              const thumbUrl = resolveEventImage(event.image_url)
              return (
              <tr
                key={event.id}
                className={cn(
                  'hover:bg-bg-secondary/50 transition-colors',
                  deletingId === event.id && isPending && 'opacity-50'
                )}
              >
                <td className="py-3 pr-4">
                  <Link href={`/admin/events/${event.id}`} className="flex items-center gap-3 group">
                    {thumbUrl ? (
                      <div className="relative w-10 h-10 rounded-lg overflow-hidden shrink-0">
                        <Image
                          src={thumbUrl}
                          alt={event.title}
                          fill
                          className="object-cover"
                          sizes="40px"
                        />
                      </div>
                    ) : (
                      <div className="w-10 h-10 rounded-lg bg-bg-secondary shrink-0" />
                    )}
                    <span className="font-medium text-text-primary group-hover:text-gold transition-colors truncate max-w-[200px]">
                      {event.title}
                    </span>
                  </Link>
                </td>
                <td className="py-3 pr-4 text-text-secondary whitespace-nowrap">
                  {formatDateCard(event.date_time)}
                </td>
                <td className="py-3 pr-4 hidden lg:table-cell">
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full border border-gold/20 text-gold">
                    {categoryLabel(event.category)}
                  </span>
                </td>
                <td className="py-3 pr-4 text-text-secondary">
                  {formatPrice(event.price)}
                </td>
                <td className="py-3 pr-4 text-text-secondary hidden lg:table-cell">
                  {event.confirmed_count}/{event.capacity ?? '∞'}
                </td>
                <td className="py-3 pr-4">
                  {statusBadge(event)}
                </td>
                <td className="py-3 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Link
                      href={`/admin/events/${event.id}`}
                      className="p-2 rounded-lg hover:bg-bg-secondary transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                      aria-label={`Edit ${event.title}`}
                    >
                      <Pencil className="w-4 h-4 text-text-tertiary" />
                    </Link>
                    <Link
                      href={`/admin/events/${event.id}/bookings`}
                      className="p-2 rounded-lg hover:bg-bg-secondary transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                      aria-label={`View bookings for ${event.title}`}
                    >
                      <Users className="w-4 h-4 text-text-tertiary" />
                    </Link>
                    <button
                      onClick={() => handleDelete(event.id, event.title)}
                      disabled={isPending && deletingId === event.id}
                      className="p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                      aria-label={`Delete ${event.title}`}
                    >
                      <Trash2 className="w-4 h-4 text-red-500" />
                    </button>
                  </div>
                </td>
              </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile cards (< md) */}
      <ul className="md:hidden space-y-3">
        {events.map((event) => {
          const thumbUrl = resolveEventImage(event.image_url)
          const isDeleting = deletingId === event.id && isPending
          return (
            <li key={event.id}>
              <article
                className={cn(
                  'rounded-lg border border-border bg-bg-card p-4 space-y-3 transition-opacity',
                  isDeleting && 'opacity-50'
                )}
              >
                {/* Title row */}
                <div className="flex items-start justify-between gap-3">
                  <Link
                    href={`/admin/events/${event.id}`}
                    className="flex items-start gap-3 min-w-0 flex-1 group"
                  >
                    {thumbUrl ? (
                      <div className="relative w-12 h-12 rounded-lg overflow-hidden shrink-0">
                        <Image
                          src={thumbUrl}
                          alt={event.title}
                          fill
                          className="object-cover"
                          sizes="48px"
                        />
                      </div>
                    ) : (
                      <div className="w-12 h-12 rounded-lg bg-bg-secondary shrink-0" />
                    )}
                    <span className="font-medium text-text-primary group-hover:text-gold transition-colors line-clamp-2">
                      {event.title}
                    </span>
                  </Link>
                  <div className="shrink-0">{statusBadge(event)}</div>
                </div>

                {/* Body */}
                <dl className="space-y-1.5 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-text-tertiary">Date</dt>
                    <dd className="text-text-secondary text-right">
                      {formatDateCard(event.date_time)}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-text-tertiary">Category</dt>
                    <dd>
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full border border-gold/20 text-gold">
                        {categoryLabel(event.category)}
                      </span>
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-text-tertiary">Price</dt>
                    <dd className="text-text-secondary">{formatPrice(event.price)}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-text-tertiary">Booked</dt>
                    <dd className="text-text-secondary">
                      {event.confirmed_count}/{event.capacity ?? '∞'}
                    </dd>
                  </div>
                </dl>

                {/* Action row */}
                <div className="flex items-center gap-2 border-t border-border pt-3">
                  <Link
                    href={`/admin/events/${event.id}`}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg border border-border hover:bg-bg-secondary transition-colors text-sm font-medium text-text-primary min-h-[44px]"
                    aria-label={`Edit ${event.title}`}
                  >
                    <Pencil className="w-4 h-4" />
                    Edit
                  </Link>
                  <Link
                    href={`/admin/events/${event.id}/bookings`}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg border border-border hover:bg-bg-secondary transition-colors text-sm font-medium text-text-primary min-h-[44px]"
                    aria-label={`View bookings for ${event.title}`}
                  >
                    <Users className="w-4 h-4" />
                    Bookings
                  </Link>
                  <button
                    type="button"
                    onClick={() => handleDelete(event.id, event.title)}
                    disabled={isDeleting}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg border border-red-200 dark:border-red-900/40 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors text-sm font-medium disabled:opacity-50 min-h-[44px]"
                    aria-label={`Delete ${event.title}`}
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete
                  </button>
                </div>
              </article>
            </li>
          )
        })}
      </ul>
    </>
  )
}
