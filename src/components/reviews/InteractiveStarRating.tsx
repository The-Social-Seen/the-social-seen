'use client'

import { Star } from 'lucide-react'
import { cn } from '@/lib/utils/cn'

interface InteractiveStarRatingProps {
  value: number
  onChange: (rating: number) => void
  error?: boolean
}

export default function InteractiveStarRating({
  value,
  onChange,
  error,
}: InteractiveStarRatingProps) {
  return (
    <div
      className="flex items-center gap-1"
      role="radiogroup"
      aria-label="Star rating"
    >
      {[1, 2, 3, 4, 5].map((star) => {
        const filled = value >= star

        return (
          <button
            key={star}
            type="button"
            role="radio"
            aria-checked={value === star}
            aria-label={`${star} star${star > 1 ? 's' : ''}`}
            onClick={() => onChange(star)}
            className={cn(
              'group flex h-11 w-11 items-center justify-center rounded-full transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50',
              error && 'animate-[shake_0.3s_ease-in-out]',
            )}
          >
            <Star
              className={cn(
                'h-7 w-7 transition-all duration-200',
                filled
                  ? 'fill-gold text-gold'
                  : 'text-blush group-hover:fill-gold/30 group-hover:text-gold/60',
              )}
              strokeWidth={1.5}
            />
          </button>
        )
      })}
    </div>
  )
}
