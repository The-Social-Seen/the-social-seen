"use client";

import { useState, useMemo, useCallback } from "react";
import { allGalleryPhotos, pastEvents } from "@/data/events";
import { cn } from "@/lib/utils/cn";
import { motion, AnimatePresence } from "framer-motion";
import Image from "next/image";
import Link from "next/link";
import { X, ChevronLeft, ChevronRight, Award, Camera } from "lucide-react";

export default function GalleryPage() {
  const [selectedEvent, setSelectedEvent] = useState<string>("All");
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const eventFilters = useMemo(() => {
    return [
      "All",
      ...pastEvents.map((e) => e.title),
    ];
  }, []);

  const filteredPhotos = useMemo(() => {
    if (selectedEvent === "All") return allGalleryPhotos;
    return allGalleryPhotos.filter(
      (photo) => photo.eventTitle === selectedEvent
    );
  }, [selectedEvent]);

  const featuredPhoto = allGalleryPhotos[0];

  const openLightbox = useCallback((index: number) => {
    setLightboxIndex(index);
  }, []);

  const closeLightbox = useCallback(() => {
    setLightboxIndex(null);
  }, []);

  const goToNext = useCallback(() => {
    if (lightboxIndex === null) return;
    setLightboxIndex((prev) =>
      prev !== null ? (prev + 1) % filteredPhotos.length : null
    );
  }, [lightboxIndex, filteredPhotos.length]);

  const goToPrev = useCallback(() => {
    if (lightboxIndex === null) return;
    setLightboxIndex((prev) =>
      prev !== null
        ? (prev - 1 + filteredPhotos.length) % filteredPhotos.length
        : null
    );
  }, [lightboxIndex, filteredPhotos.length]);

  // Keyboard navigation for lightbox
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowRight") goToNext();
      if (e.key === "ArrowLeft") goToPrev();
      if (e.key === "Escape") closeLightbox();
    },
    [goToNext, goToPrev, closeLightbox]
  );

  return (
    <main className="min-h-screen bg-bg-primary">
      {/* Header */}
      <section className="border-b border-blush/40 bg-bg-card">
        <div className="mx-auto max-w-7xl px-6 py-16 md:py-20">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <div className="mb-3 flex items-center gap-2">
              <Camera className="h-5 w-5 text-gold" />
              <span className="text-sm font-medium uppercase tracking-wider text-gold">
                Gallery
              </span>
            </div>
            <h1 className="mb-4 text-4xl font-bold tracking-tight text-text-primary md:text-5xl">
              Event Gallery
            </h1>
            <p className="max-w-2xl text-lg leading-relaxed text-text-primary/60">
              Moments captured at our events. Every photo tells a story of
              connection, culture, and unforgettable experiences.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Filter Bar */}
      <section className="sticky top-0 z-20 border-b border-blush/40 bg-bg-card/80 backdrop-blur-xl">
        <div className="mx-auto max-w-7xl px-6 py-4">
          <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
            {eventFilters.map((filter) => (
              <button
                key={filter}
                onClick={() => setSelectedEvent(filter)}
                className={cn(
                  "flex-shrink-0 rounded-full px-4 py-2 text-sm font-medium transition-all duration-200",
                  selectedEvent === filter
                    ? "bg-charcoal text-white shadow-sm"
                    : "bg-bg-primary text-text-primary/70 hover:bg-blush/40 hover:text-text-primary"
                )}
              >
                {filter}
              </button>
            ))}
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-7xl px-6 py-12">
        {/* Photo of the Month */}
        {selectedEvent === "All" && featuredPhoto && (
          <motion.section
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="mb-12"
          >
            <div className="mb-6 flex items-center gap-3">
              <Award className="h-5 w-5 text-gold" />
              <h2 className="text-xl font-bold text-text-primary">
                Photo of the Month
              </h2>
            </div>
            <div
              className="group relative cursor-pointer overflow-hidden rounded-2xl"
              onClick={() => openLightbox(0)}
            >
              <div className="relative aspect-[21/9] overflow-hidden">
                <Image
                  src={featuredPhoto.imageUrl}
                  alt={featuredPhoto.caption || "Featured photo"}
                  fill
                  className="object-cover transition-transform duration-700 group-hover:scale-105"
                  sizes="(max-width: 1280px) 100vw, 1280px"
                  priority
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
              </div>

              {/* Gold badge */}
              <div className="absolute top-4 left-4">
                <div className="flex items-center gap-2 rounded-full bg-gold px-4 py-2 shadow-lg">
                  <Award className="h-4 w-4 text-white" />
                  <span className="text-xs font-semibold text-white">
                    Photo of the Month
                  </span>
                </div>
              </div>

              {/* Caption overlay */}
              <div className="absolute inset-x-0 bottom-0 p-6">
                <p className="text-lg font-semibold text-white">
                  {featuredPhoto.caption}
                </p>
                <Link
                  href={`/events/${featuredPhoto.eventSlug}`}
                  onClick={(e) => e.stopPropagation()}
                  className="mt-1 inline-block text-sm text-white/70 underline underline-offset-4 transition-colors hover:text-white"
                >
                  {featuredPhoto.eventTitle}
                </Link>
              </div>
            </div>
          </motion.section>
        )}

        {/* Masonry Grid */}
        <motion.div
          layout
          className="columns-2 gap-4 md:columns-3 lg:columns-4"
        >
          <AnimatePresence mode="popLayout">
            {filteredPhotos.map((photo, index) => (
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
                    src={photo.imageUrl}
                    alt={photo.caption || "Event photo"}
                    width={600}
                    height={400 + (index % 3) * 100}
                    className="w-full object-cover transition-transform duration-500 group-hover:scale-105"
                    sizes="(max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw"
                  />
                  {/* Hover overlay */}
                  <div className="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                    <div className="p-4">
                      {photo.caption && (
                        <p className="text-sm font-medium text-white">
                          {photo.caption}
                        </p>
                      )}
                      <p className="mt-1 text-xs text-white/70">
                        {photo.eventTitle}
                      </p>
                    </div>
                  </div>
                </button>
              </motion.div>
            ))}
          </AnimatePresence>
        </motion.div>

        {filteredPhotos.length === 0 && (
          <div className="py-20 text-center">
            <Camera className="mx-auto mb-4 h-12 w-12 text-blush" />
            <p className="text-lg text-text-primary/50">
              No photos found for this event.
            </p>
          </div>
        )}
      </div>

      {/* Lightbox */}
      <AnimatePresence>
        {lightboxIndex !== null && filteredPhotos[lightboxIndex] && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 backdrop-blur-sm"
            onClick={closeLightbox}
            onKeyDown={handleKeyDown}
            tabIndex={0}
            role="dialog"
            aria-label="Photo lightbox"
          >
            {/* Close button */}
            <button
              onClick={closeLightbox}
              className="absolute top-6 right-6 z-10 rounded-full bg-white/10 p-3 text-white transition-colors hover:bg-white/20"
            >
              <X className="h-5 w-5" />
            </button>

            {/* Previous button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                goToPrev();
              }}
              className="absolute left-4 z-10 rounded-full bg-white/10 p-3 text-white transition-colors hover:bg-white/20 md:left-8"
            >
              <ChevronLeft className="h-6 w-6" />
            </button>

            {/* Image */}
            <motion.div
              key={lightboxIndex}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              className="relative max-h-[85vh] max-w-5xl px-16"
              onClick={(e) => e.stopPropagation()}
            >
              <Image
                src={filteredPhotos[lightboxIndex].imageUrl}
                alt={
                  filteredPhotos[lightboxIndex].caption || "Event gallery photo"
                }
                width={1200}
                height={800}
                className="max-h-[85vh] rounded-lg object-contain"
              />
              {/* Caption */}
              <div className="absolute inset-x-16 bottom-0 translate-y-full pt-4 text-center">
                {filteredPhotos[lightboxIndex].caption && (
                  <p className="text-sm font-medium text-white">
                    {filteredPhotos[lightboxIndex].caption}
                  </p>
                )}
                <Link
                  href={`/events/${filteredPhotos[lightboxIndex].eventSlug}`}
                  className="mt-1 inline-block text-xs text-white/50 underline underline-offset-4 transition-colors hover:text-white/70"
                >
                  {filteredPhotos[lightboxIndex].eventTitle}
                </Link>
                <p className="mt-2 text-xs text-white/30">
                  {lightboxIndex + 1} / {filteredPhotos.length}
                </p>
              </div>
            </motion.div>

            {/* Next button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                goToNext();
              }}
              className="absolute right-4 z-10 rounded-full bg-white/10 p-3 text-white transition-colors hover:bg-white/20 md:right-8"
            >
              <ChevronRight className="h-6 w-6" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}
