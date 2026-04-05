'use client'

import { useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Image from 'next/image'
import Link from 'next/link'
import { X, ChevronLeft, ChevronRight } from 'lucide-react'
import { resolveEventImage } from '@/lib/utils/images'
import type { GalleryPhotoWithEvent } from '@/lib/supabase/queries/gallery'

// ── Props ────────────────────────────────────────────────────────────────────

interface LightboxProps {
  photos: GalleryPhotoWithEvent[]
  currentIndex: number | null
  onClose: () => void
  onNext: () => void
  onPrev: () => void
}

// ── Swipe threshold (px) ─────────────────────────────────────────────────────

const SWIPE_THRESHOLD = 50

// ── Component ────────────────────────────────────────────────────────────────

export default function Lightbox({
  photos,
  currentIndex,
  onClose,
  onNext,
  onPrev,
}: LightboxProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const touchStartX = useRef<number | null>(null)

  // Keyboard navigation (Amendment 7.3)
  useEffect(() => {
    if (currentIndex === null) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') onNext()
      else if (e.key === 'ArrowLeft') onPrev()
      else if (e.key === 'Escape') onClose()
    }

    document.addEventListener('keydown', handleKeyDown)
    document.body.style.overflow = 'hidden'
    dialogRef.current?.focus()

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = ''
    }
  }, [currentIndex, onNext, onPrev, onClose])

  // Mobile swipe handlers (Amendment 7.3)
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX
  }, [])

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (touchStartX.current === null) return
      const deltaX = e.changedTouches[0].clientX - touchStartX.current
      touchStartX.current = null

      if (Math.abs(deltaX) < SWIPE_THRESHOLD) return
      if (deltaX < 0) onNext()
      else onPrev()
    },
    [onNext, onPrev],
  )

  if (currentIndex === null || !photos[currentIndex]) return null

  const photo = photos[currentIndex]
  const imageUrl = resolveEventImage(photo.image_url)

  return (
    <AnimatePresence>
      <motion.div
        ref={dialogRef}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 backdrop-blur-sm"
        onClick={onClose}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        tabIndex={0}
        role="dialog"
        aria-label="Photo lightbox"
      >
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute top-6 right-6 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
          aria-label="Close lightbox"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Prev */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            onPrev()
          }}
          className="absolute left-4 z-10 hidden rounded-full bg-white/10 p-3 text-white transition-colors hover:bg-white/20 md:left-8 md:flex"
          aria-label="Previous photo"
        >
          <ChevronLeft className="h-6 w-6" />
        </button>

        {/* Image */}
        <motion.div
          key={currentIndex}
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.2 }}
          className="relative max-h-[85vh] max-w-5xl px-4 md:px-16"
          onClick={(e) => e.stopPropagation()}
        >
          {imageUrl && (
            <Image
              src={imageUrl}
              alt={photo.caption || 'Event gallery photo'}
              width={1200}
              height={800}
              className="max-h-[85vh] rounded-lg object-contain"
            />
          )}
          {/* Caption */}
          <div className="absolute inset-x-4 bottom-0 translate-y-full pt-4 text-center md:inset-x-16">
            {photo.caption && (
              <p className="text-sm font-medium text-white">{photo.caption}</p>
            )}
            <Link
              href={`/events/${photo.event.slug}`}
              className="mt-1 inline-block text-xs text-white/50 underline underline-offset-4 transition-colors hover:text-white/70"
            >
              {photo.event.title}
            </Link>
            <p className="mt-2 text-xs text-white/30">
              {currentIndex + 1} / {photos.length}
            </p>
          </div>
        </motion.div>

        {/* Next */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            onNext()
          }}
          className="absolute right-4 z-10 hidden rounded-full bg-white/10 p-3 text-white transition-colors hover:bg-white/20 md:right-8 md:flex"
          aria-label="Next photo"
        >
          <ChevronRight className="h-6 w-6" />
        </button>
      </motion.div>
    </AnimatePresence>
  )
}
