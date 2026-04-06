'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { X, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { submitReview } from '@/app/(member)/bookings/actions'
import InteractiveStarRating from '@/components/reviews/InteractiveStarRating'
import ReviewCard from '@/components/reviews/ReviewCard'
import type { ReviewWithAuthor } from '@/types'

// ── Props ────────────────────────────────────────────────────────────────────

interface ReviewFormProps {
  eventId: string
  eventTitle: string
  eventDate: string
  onClose: () => void
  onSuccess?: () => void
  /** Current user info for rendering the success preview */
  userName: string
  userAvatar?: string | null
}

// ── Constants ────────────────────────────────────────────────────────────────

const MAX_CHARS = 500
const WARN_THRESHOLD = 450
const DANGER_THRESHOLD = 490

// ── Component ────────────────────────────────────────────────────────────────

export default function ReviewForm({
  eventId,
  eventTitle,
  eventDate,
  onClose,
  onSuccess,
  userName,
  userAvatar,
}: ReviewFormProps) {
  const [rating, setRating] = useState(0)
  const [reviewText, setReviewText] = useState('')
  const [ratingError, setRatingError] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submittedReview, setSubmittedReview] = useState<ReviewWithAuthor | null>(null)

  const overlayRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  // ── Focus trap + escape key ──────────────────────────────────────────────

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    document.body.style.overflow = 'hidden'

    // Focus the panel on mount
    panelRef.current?.focus()

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = ''
    }
  }, [onClose])

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === overlayRef.current) onClose()
    },
    [onClose],
  )

  const handleRatingChange = useCallback((value: number) => {
    setRating(value)
    setRatingError(false)
    setServerError(null)
  }, [])

  const handleTextChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const text = e.target.value
      if (text.length <= MAX_CHARS) {
        setReviewText(text)
        setServerError(null)
      }
    },
    [],
  )

  const handleSubmit = useCallback(async () => {
    if (rating === 0) {
      setRatingError(true)
      return
    }

    setIsSubmitting(true)
    setServerError(null)

    const result = await submitReview({
      eventId,
      rating,
      reviewText: reviewText.trim() || undefined,
    })

    setIsSubmitting(false)

    if (!result.success) {
      setServerError(result.error ?? 'Something went wrong. Please try again.')
      return
    }

    // Build a preview of the submitted review
    setSubmittedReview({
      id: 'preview',
      user_id: '',
      event_id: eventId,
      rating,
      review_text: reviewText.trim() || null,
      is_visible: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      author: {
        id: '',
        full_name: userName,
        avatar_url: userAvatar ?? null,
      },
    })

    onSuccess?.()
  }, [rating, reviewText, eventId, userName, userAvatar, onSuccess])

  // ── Character counter colour ─────────────────────────────────────────────

  const charCount = reviewText.length
  const counterColour =
    charCount >= DANGER_THRESHOLD
      ? 'text-danger'
      : charCount >= WARN_THRESHOLD
        ? 'text-gold'
        : 'text-text-tertiary'

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 z-50 flex items-end justify-center backdrop-blur-sm bg-charcoal/40 md:items-center"
      aria-modal="true"
      role="dialog"
      aria-label={`Review ${eventTitle}`}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className={cn(
          'relative w-full max-w-lg bg-bg-card',
          'rounded-t-2xl md:rounded-2xl',
          'p-6 shadow-xl',
          'focus-visible:outline-none',
          'max-h-[90vh] overflow-y-auto',
        )}
      >
        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-4 right-4 flex h-11 w-11 items-center justify-center rounded-full text-text-tertiary transition-colors hover:bg-border/50 hover:text-text-primary"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Drag handle (mobile) */}
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-border md:hidden" />

        {submittedReview ? (
          /* ── Success state ─────────────────────────────────────────── */
          <div className="space-y-5">
            <div className="text-center">
              <h2 className="font-serif text-xl font-bold text-text-primary">
                Thank you for your review
              </h2>
              <p className="mt-1 text-sm text-text-tertiary">
                Your feedback helps our community discover great events.
              </p>
            </div>

            <ReviewCard review={submittedReview} />

            <button
              type="button"
              onClick={onClose}
              className="w-full rounded-full border border-border bg-bg-card px-8 py-3 text-sm font-semibold text-text-primary transition-colors hover:bg-bg-secondary"
            >
              Close
            </button>
          </div>
        ) : (
          /* ── Form state ────────────────────────────────────────────── */
          <div className="space-y-5">
            {/* Event context header */}
            <div>
              <h2 className="font-serif text-xl font-bold text-text-primary">
                Leave a Review
              </h2>
              <p className="mt-1 text-sm text-text-tertiary">
                {eventTitle} &middot; {eventDate}
              </p>
            </div>

            {/* Star rating */}
            <div>
              <label className="mb-2 block text-sm font-medium text-text-primary">
                How was your experience?
              </label>
              <InteractiveStarRating
                value={rating}
                onChange={handleRatingChange}
                error={ratingError}
              />
              {ratingError && (
                <p className="mt-1.5 text-xs text-danger" role="alert">
                  Please select a rating
                </p>
              )}
            </div>

            {/* Review text */}
            <div>
              <label
                htmlFor="review-text"
                className="mb-2 block text-sm font-medium text-text-primary"
              >
                What made this event special?{' '}
                <span className="font-normal text-text-tertiary">(optional)</span>
              </label>
              <textarea
                id="review-text"
                value={reviewText}
                onChange={handleTextChange}
                placeholder="What made this event special?"
                rows={4}
                className={cn(
                  'w-full resize-none rounded-xl border border-border bg-bg-card px-4 py-3 text-sm text-text-primary placeholder:text-text-tertiary',
                  'transition-all duration-200',
                  'focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/50',
                )}
              />
              <div className="mt-1 flex justify-end">
                <span className={cn('text-xs tabular-nums', counterColour)}>
                  {charCount}/{MAX_CHARS}
                </span>
              </div>
            </div>

            {/* Server error */}
            {serverError && (
              <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">
                {serverError}
              </p>
            )}

            {/* Submit button */}
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isSubmitting || rating === 0}
              className={cn(
                'w-full rounded-full px-8 py-3 text-sm font-semibold text-white transition-all duration-200',
                rating > 0
                  ? 'bg-gold hover:bg-gold-hover active:scale-[0.98]'
                  : 'cursor-not-allowed bg-gold/40',
                isSubmitting && 'cursor-wait opacity-80',
              )}
            >
              {isSubmitting ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Submitting...
                </span>
              ) : (
                'Submit Review'
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
