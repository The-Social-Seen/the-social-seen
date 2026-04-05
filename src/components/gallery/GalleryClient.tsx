'use client'

import { useState, useMemo, useCallback } from 'react'
import { cn } from '@/lib/utils/cn'
import { motion, AnimatePresence } from 'framer-motion'
import Image from 'next/image'
import Link from 'next/link'
import { Award, Camera } from 'lucide-react'
import { resolveEventImage } from '@/lib/utils/images'
import Lightbox from '@/components/gallery/Lightbox'
import type { GalleryPhotoWithEvent, GalleryEvent } from '@/lib/supabase/queries/gallery'

// ── Props ────────────────────────────────────────────────────────────────────

interface GalleryClientProps {
  photos: GalleryPhotoWithEvent[]
  events: GalleryEvent[]
  /** Pre-selected event slug from URL search params */
  initialEventSlug?: string
}

// ── Component ────────────────────────────────────────────────────────────────

export default function GalleryClient({
  photos,
  events,
  initialEventSlug,
}: GalleryClientProps) {
  const initialFilter = initialEventSlug
    ? events.find((e) => e.slug === initialEventSlug)?.title ?? 'All'
    : 'All'

  const [selectedEvent, setSelectedEvent] = useState(initialFilter)
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)

  const filteredPhotos = useMemo(() => {
    if (selectedEvent === 'All') return photos
    return photos.filter((p) => p.event.title === selectedEvent)
  }, [selectedEvent, photos])

  const featuredPhoto = photos[0] ?? null

  const openLightbox = useCallback((index: number) => {
    setLightboxIndex(index)
  }, [])

  const closeLightbox = useCallback(() => {
    setLightboxIndex(null)
  }, [])

  const goToNext = useCallback(() => {
    setLightboxIndex((prev) =>
      prev !== null ? (prev + 1) % filteredPhotos.length : null,
    )
  }, [filteredPhotos.length])

  const goToPrev = useCallback(() => {
    setLightboxIndex((prev) =>
      prev !== null ? (prev - 1 + filteredPhotos.length) % filteredPhotos.length : null,
    )
  }, [filteredPhotos.length])

  return (
    <>
      {/* Filter Bar */}
      <section className="sticky top-0 z-20 border-b border-blush/40 bg-bg-card/80 backdrop-blur-xl">
        <div className="mx-auto max-w-7xl px-6 py-4">
          <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
            <FilterButton
              label="All"
              active={selectedEvent === 'All'}
              onClick={() => setSelectedEvent('All')}
            />
            {events.map((evt) => (
              <FilterButton
                key={evt.id}
                label={evt.title}
                active={selectedEvent === evt.title}
                onClick={() => setSelectedEvent(evt.title)}
              />
            ))}
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-7xl px-6 py-12">
        {/* Photo of the Month */}
        {selectedEvent === 'All' && featuredPhoto && (
          <FeaturedPhoto photo={featuredPhoto} onOpen={() => openLightbox(0)} />
        )}

        {/* Masonry Grid */}
        <motion.div layout className="columns-2 gap-4 md:columns-3 lg:columns-4">
          <AnimatePresence mode="popLayout">
            {filteredPhotos.map((photo, index) => {
              const url = resolveEventImage(photo.image_url)
              if (!url) return null
              return (
                <motion.div
                  key={photo.id}
                  layout
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ duration: 0.3 }}
                  className="mb-4 break-inside-avoid"
                >
                  <button
                    onClick={() => openLightbox(index)}
                    className="group relative block w-full overflow-hidden rounded-xl"
                  >
                    <Image
                      src={url}
                      alt={photo.caption || 'Event photo'}
                      width={600}
                      height={400 + (index % 3) * 100}
                      className="w-full object-cover transition-transform duration-500 group-hover:scale-105"
                      sizes="(max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw"
                    />
                    <div className="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                      <div className="p-4">
                        {photo.caption && (
                          <p className="text-sm font-medium text-white">{photo.caption}</p>
                        )}
                        <p className="mt-1 text-xs text-white/70">{photo.event.title}</p>
                      </div>
                    </div>
                  </button>
                </motion.div>
              )
            })}
          </AnimatePresence>
        </motion.div>

        {filteredPhotos.length === 0 && (
          <div className="py-20 text-center">
            <Camera className="mx-auto mb-4 h-12 w-12 text-blush" />
            <p className="text-lg text-text-primary/50">No photos found for this event.</p>
          </div>
        )}
      </div>

      {/* Lightbox */}
      <Lightbox
        photos={filteredPhotos}
        currentIndex={lightboxIndex}
        onClose={closeLightbox}
        onNext={goToNext}
        onPrev={goToPrev}
      />
    </>
  )
}

// ── Sub-components ───────────────────────────────────────────────────────────

function FilterButton({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex-shrink-0 rounded-full px-4 py-2 text-sm font-medium transition-all duration-200',
        active
          ? 'bg-charcoal text-white shadow-sm dark:bg-gold dark:text-white'
          : 'bg-bg-primary text-text-primary/70 hover:bg-blush/40 hover:text-text-primary dark:hover:bg-dark-border',
      )}
    >
      {label}
    </button>
  )
}

function FeaturedPhoto({
  photo,
  onOpen,
}: {
  photo: GalleryPhotoWithEvent
  onOpen: () => void
}) {
  const url = resolveEventImage(photo.image_url)
  if (!url) return null

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.1 }}
      className="mb-12"
    >
      <div className="mb-6 flex items-center gap-3">
        <Award className="h-5 w-5 text-gold" />
        <h2 className="text-xl font-bold text-text-primary">Photo of the Month</h2>
      </div>
      <div
        className="group relative cursor-pointer overflow-hidden rounded-2xl"
        onClick={onOpen}
      >
        <div className="relative aspect-[21/9] overflow-hidden">
          <Image
            src={url}
            alt={photo.caption || 'Featured photo'}
            fill
            className="object-cover transition-transform duration-700 group-hover:scale-105"
            sizes="(max-width: 1280px) 100vw, 1280px"
            priority
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
        </div>

        <div className="absolute top-4 left-4">
          <div className="flex items-center gap-2 rounded-full bg-gold px-4 py-2 shadow-lg">
            <Award className="h-4 w-4 text-white" />
            <span className="text-xs font-semibold text-white">Photo of the Month</span>
          </div>
        </div>

        <div className="absolute inset-x-0 bottom-0 p-6">
          <p className="text-lg font-semibold text-white">{photo.caption}</p>
          <Link
            href={`/events/${photo.event.slug}`}
            onClick={(e) => e.stopPropagation()}
            className="mt-1 inline-block text-sm text-white/70 underline underline-offset-4 transition-colors hover:text-white"
          >
            {photo.event.title}
          </Link>
        </div>
      </div>
    </motion.section>
  )
}
