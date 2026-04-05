'use client'

import { useState, useTransition } from 'react'
import Image from 'next/image'
import { formatDistanceToNow } from 'date-fns'
import { Star, Eye, EyeOff } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { toggleReviewVisibility } from '@/app/(admin)/admin/actions'

interface ReviewRow {
  id: string
  rating: number
  review_text: string | null
  is_visible: boolean
  created_at: string
  author: { id: string; full_name: string; avatar_url: string | null; email: string } | null
  event: { id: string; slug: string; title: string } | null
}

interface ReviewsTableProps {
  reviews: ReviewRow[]
}

const TABS = [
  { key: 'all', label: 'All' },
  { key: 'visible', label: 'Visible' },
  { key: 'hidden', label: 'Hidden' },
] as const

function StarDisplay({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-0.5" aria-label={`${rating} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={cn(
            'w-3.5 h-3.5',
            i <= rating ? 'fill-gold text-gold' : 'text-border'
          )}
        />
      ))}
    </div>
  )
}

function ToggleButton({ reviewId, isVisible }: { reviewId: string; isVisible: boolean }) {
  const [isPending, startTransition] = useTransition()

  function handleToggle() {
    startTransition(async () => {
      const result = await toggleReviewVisibility(reviewId)
      if (result.error) alert(result.error)
    })
  }

  return (
    <button
      onClick={handleToggle}
      disabled={isPending}
      className={cn(
        'inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full transition-colors disabled:opacity-50 min-h-[36px]',
        isVisible
          ? 'bg-bg-secondary text-text-secondary hover:bg-bg-tertiary'
          : 'bg-gold text-white hover:bg-gold-dark'
      )}
    >
      {isVisible ? (
        <>
          <EyeOff className="w-3.5 h-3.5" />
          {isPending ? 'Hiding...' : 'Hide'}
        </>
      ) : (
        <>
          <Eye className="w-3.5 h-3.5" />
          {isPending ? 'Showing...' : 'Show'}
        </>
      )}
    </button>
  )
}

export default function ReviewsTable({ reviews }: ReviewsTableProps) {
  const [activeTab, setActiveTab] = useState<string>('all')
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  const filtered = activeTab === 'all'
    ? reviews
    : reviews.filter((r) => activeTab === 'visible' ? r.is_visible : !r.is_visible)

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Normalise join results
  function getAuthor(r: ReviewRow) {
    return Array.isArray(r.author) ? r.author[0] : r.author
  }
  function getEvent(r: ReviewRow) {
    return Array.isArray(r.event) ? r.event[0] : r.event
  }

  return (
    <div className="space-y-4">
      {/* Filter tabs */}
      <div className="flex items-center gap-1 bg-bg-secondary rounded-lg p-1 w-fit">
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

      {filtered.length === 0 ? (
        <p className="text-sm text-text-tertiary py-8 text-center">No reviews found</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="pb-3 font-medium text-text-tertiary">Reviewer</th>
                <th className="pb-3 font-medium text-text-tertiary hidden md:table-cell">Event</th>
                <th className="pb-3 font-medium text-text-tertiary">Rating</th>
                <th className="pb-3 font-medium text-text-tertiary hidden lg:table-cell">Review</th>
                <th className="pb-3 font-medium text-text-tertiary hidden md:table-cell">Date</th>
                <th className="pb-3 font-medium text-text-tertiary">Visible</th>
                <th className="pb-3 font-medium text-text-tertiary text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((review) => {
                const author = getAuthor(review)
                const event = getEvent(review)
                const isExpanded = expandedIds.has(review.id)
                const text = review.review_text ?? ''
                const truncated = text.length > 100 && !isExpanded
                  ? text.slice(0, 100) + '...'
                  : text

                return (
                  <tr key={review.id} className="hover:bg-bg-secondary/50 transition-colors">
                    <td className="py-3 pr-4">
                      <div className="flex items-center gap-2">
                        <div className="relative w-7 h-7 rounded-full overflow-hidden bg-gold/20 shrink-0">
                          {author?.avatar_url ? (
                            <Image
                              src={author.avatar_url}
                              alt={author.full_name}
                              fill
                              className="object-cover"
                              sizes="28px"
                            />
                          ) : (
                            <span className="flex items-center justify-center w-full h-full text-[10px] font-medium text-gold">
                              {author?.full_name?.charAt(0).toUpperCase() ?? '?'}
                            </span>
                          )}
                        </div>
                        <span className="font-medium text-text-primary truncate max-w-[120px]">
                          {author?.full_name ?? 'Unknown'}
                        </span>
                      </div>
                    </td>
                    <td className="py-3 pr-4 text-text-secondary hidden md:table-cell truncate max-w-[160px]">
                      {event?.title ?? '—'}
                    </td>
                    <td className="py-3 pr-4">
                      <StarDisplay rating={review.rating} />
                    </td>
                    <td className="py-3 pr-4 hidden lg:table-cell max-w-[240px]">
                      {text ? (
                        <button
                          onClick={() => text.length > 100 && toggleExpand(review.id)}
                          className="text-left text-text-secondary text-xs"
                        >
                          {truncated}
                        </button>
                      ) : (
                        <span className="text-text-tertiary text-xs">No text</span>
                      )}
                    </td>
                    <td className="py-3 pr-4 text-text-tertiary hidden md:table-cell whitespace-nowrap">
                      {formatDistanceToNow(new Date(review.created_at), { addSuffix: true })}
                    </td>
                    <td className="py-3 pr-4">
                      {review.is_visible ? (
                        <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                          <span className="w-2 h-2 rounded-full bg-emerald-500" aria-hidden="true" />
                          Yes
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-red-500 dark:text-red-400">
                          <span className="w-2 h-2 rounded-full bg-red-500" aria-hidden="true" />
                          No
                        </span>
                      )}
                    </td>
                    <td className="py-3 text-right">
                      <ToggleButton reviewId={review.id} isVisible={review.is_visible} />
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
