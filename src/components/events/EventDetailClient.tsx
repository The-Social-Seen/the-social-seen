"use client";

import { useState } from "react";
import { SocialEvent } from "@/types";
import { events } from "@/data/events";
import { cn } from "@/lib/utils/cn";
import { format } from "date-fns";
import { motion } from "framer-motion";
import Image from "next/image";
import Link from "next/link";
import {
  MapPin,
  Calendar,
  Clock,
  Users,
  Check,
  ArrowLeft,
  ChevronRight,
} from "lucide-react";
import BookingModal from "@/components/events/BookingModal";
import StarRating from "@/components/reviews/StarRating";
import ReviewCard from "@/components/reviews/ReviewCard";
import EventCard from "@/components/events/EventCard";

interface EventDetailClientProps {
  event: SocialEvent;
}

const fadeInUp = {
  initial: { opacity: 0, y: 30 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-50px" },
  transition: { duration: 0.5 },
};

export default function EventDetailClient({ event }: EventDetailClientProps) {
  const [bookingOpen, setBookingOpen] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);

  const isFree = event.price === 0;
  const isSoldOut = event.spotsLeft === 0 && !event.isPast;
  const hasReviews = event.isPast && event.reviews && event.reviews.length > 0;
  const hasGallery =
    event.isPast && event.galleryImages && event.galleryImages.length > 0;

  // Related events from same category, excluding current
  const relatedEvents = events
    .filter((e) => e.category === event.category && e.id !== event.id)
    .slice(0, 3);

  return (
    <>
      <main className="min-h-screen bg-bg-primary">
        {/* Hero Section */}
        <section className="relative h-[50vh] min-h-[400px] overflow-hidden">
          <Image
            src={event.imageUrl}
            alt={event.title}
            fill
            className="object-cover"
            priority
            sizes="100vw"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-black/10" />

          {/* Back button */}
          <div className="absolute top-6 left-6 z-10">
            <Link
              href="/events"
              className="flex items-center gap-2 rounded-full bg-white/15 px-4 py-2 text-sm font-medium text-white backdrop-blur-md transition-all hover:bg-white/25"
            >
              <ArrowLeft className="h-4 w-4" />
              All Events
            </Link>
          </div>

          {/* Hero content */}
          <div className="absolute inset-x-0 bottom-0 z-10">
            <div className="mx-auto max-w-7xl px-6 pb-10">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.1 }}
              >
                <div className="mb-3 flex flex-wrap items-center gap-3">
                  <span className="rounded-full bg-white/20 px-3 py-1 text-xs font-medium text-white backdrop-blur-sm">
                    {event.category}
                  </span>
                  {event.isPast && (
                    <span className="rounded-full bg-white/20 px-3 py-1 text-xs font-medium text-white backdrop-blur-sm">
                      Past Event
                    </span>
                  )}
                  {isSoldOut && (
                    <span className="rounded-full bg-red-500/80 px-3 py-1 text-xs font-semibold text-white">
                      Sold Out
                    </span>
                  )}
                </div>
                <h1 className="max-w-3xl text-3xl font-bold text-white md:text-5xl md:leading-tight">
                  {event.title}
                </h1>
              </motion.div>
            </div>
          </div>
        </section>

        {/* Two-column layout */}
        <section className="mx-auto max-w-7xl px-6 py-12">
          <div className="flex flex-col gap-10 lg:flex-row">
            {/* Left column (2/3) */}
            <div className="lg:w-2/3">
              {/* Quick info bar */}
              <motion.div
                {...fadeInUp}
                className="mb-10 flex flex-wrap gap-6 rounded-2xl border border-blush/40 bg-bg-card p-5"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gold/10">
                    <Calendar className="h-5 w-5 text-gold" />
                  </div>
                  <div>
                    <p className="text-xs text-text-primary/50">Date</p>
                    <p className="text-sm font-semibold text-text-primary">
                      {format(new Date(event.dateTime), "EEE d MMM yyyy")}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gold/10">
                    <Clock className="h-5 w-5 text-gold" />
                  </div>
                  <div>
                    <p className="text-xs text-text-primary/50">Time</p>
                    <p className="text-sm font-semibold text-text-primary">
                      {format(new Date(event.dateTime), "h:mm a")} &ndash;{" "}
                      {format(new Date(event.endTime), "h:mm a")}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gold/10">
                    <Users className="h-5 w-5 text-gold" />
                  </div>
                  <div>
                    <p className="text-xs text-text-primary/50">Attendees</p>
                    <p className="text-sm font-semibold text-text-primary">
                      {event.attendeeCount} people going
                    </p>
                  </div>
                </div>
              </motion.div>

              {/* Description */}
              <motion.div {...fadeInUp} className="mb-10">
                <h2 className="mb-4 text-2xl font-bold text-text-primary">
                  About This Event
                </h2>
                <p className="text-base leading-relaxed text-text-primary/70">
                  {event.description}
                </p>
              </motion.div>

              {/* What's Included */}
              {event.whatsIncluded && event.whatsIncluded.length > 0 && (
                <motion.div {...fadeInUp} className="mb-10">
                  <h2 className="mb-4 text-2xl font-bold text-text-primary">
                    What&apos;s Included
                  </h2>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {event.whatsIncluded.map((item, idx) => (
                      <div
                        key={idx}
                        className="flex items-center gap-3 rounded-xl bg-bg-card p-4 shadow-sm"
                      >
                        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-emerald-100">
                          <Check className="h-4 w-4 text-emerald-600" />
                        </div>
                        <span className="text-sm font-medium text-text-primary">
                          {item}
                        </span>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}

              {/* Dress Code */}
              {event.dressCode && (
                <motion.div {...fadeInUp} className="mb-10">
                  <h2 className="mb-4 text-2xl font-bold text-text-primary">
                    Dress Code
                  </h2>
                  <div className="inline-flex items-center gap-2 rounded-xl bg-bg-card px-5 py-3 shadow-sm">
                    <span className="text-sm font-medium text-text-primary">
                      {event.dressCode}
                    </span>
                  </div>
                </motion.div>
              )}

              {/* Host Section */}
              <motion.div
                {...fadeInUp}
                className="mb-10 rounded-2xl border border-blush/40 bg-bg-card p-6"
              >
                <h2 className="mb-5 text-2xl font-bold text-text-primary">
                  Your Host
                </h2>
                <div className="flex items-start gap-4">
                  <div className="relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-full ring-2 ring-gold/30">
                    <Image
                      src={event.hostAvatar}
                      alt={event.hostName}
                      fill
                      className="object-cover"
                      sizes="64px"
                    />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-text-primary">
                      {event.hostName}
                    </h3>
                    <p className="mb-2 text-sm font-medium text-gold">
                      {event.hostRole}
                    </p>
                    <p className="text-sm leading-relaxed text-text-primary/60">
                      {event.hostBio}
                    </p>
                  </div>
                </div>
              </motion.div>

              {/* Reviews Section (Past events only) */}
              {hasReviews && (
                <motion.div {...fadeInUp} className="mb-10">
                  <div className="mb-6 flex items-center gap-4">
                    <h2 className="text-2xl font-bold text-text-primary">
                      Reviews
                    </h2>
                    <div className="flex items-center gap-2">
                      <StarRating
                        rating={event.averageRating!}
                        size="md"
                        showNumber
                      />
                      <span className="text-sm text-text-primary/50">
                        ({event.totalReviews}{" "}
                        {event.totalReviews === 1 ? "review" : "reviews"})
                      </span>
                    </div>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    {event.reviews!.map((review) => (
                      <ReviewCard key={review.id} review={review} />
                    ))}
                  </div>
                </motion.div>
              )}

              {/* Gallery Section (Past events only) */}
              {hasGallery && (
                <motion.div {...fadeInUp} className="mb-10">
                  <h2 className="mb-6 text-2xl font-bold text-text-primary">
                    Event Gallery
                  </h2>
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                    {event.galleryImages!.map((photo) => (
                      <button
                        key={photo.id}
                        onClick={() => setLightboxImage(photo.imageUrl)}
                        className="group relative aspect-square overflow-hidden rounded-xl"
                      >
                        <Image
                          src={photo.imageUrl}
                          alt={photo.caption || "Event photo"}
                          fill
                          className="object-cover transition-transform duration-300 group-hover:scale-105"
                          sizes="(max-width: 768px) 50vw, 33vw"
                        />
                        <div className="absolute inset-0 bg-black/0 transition-all group-hover:bg-black/30" />
                        {photo.caption && (
                          <div className="absolute inset-x-0 bottom-0 translate-y-full p-3 transition-transform group-hover:translate-y-0">
                            <p className="text-xs font-medium text-white">
                              {photo.caption}
                            </p>
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </motion.div>
              )}
            </div>

            {/* Right column (1/3) - Sticky Booking Card */}
            <div className="lg:w-1/3">
              <div className="sticky top-8">
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: 0.2 }}
                  className="overflow-hidden rounded-2xl border border-blush/40 bg-bg-card shadow-lg shadow-charcoal/5"
                >
                  <div className="p-6">
                    {/* Price */}
                    <div className="mb-6">
                      {isFree ? (
                        <span className="text-3xl font-bold text-emerald-600">
                          Free
                        </span>
                      ) : (
                        <div className="flex items-baseline gap-1">
                          <span className="text-3xl font-bold text-gold">
                            {"\u00A3"}{event.price}
                          </span>
                          <span className="text-sm text-text-primary/50">
                            per person
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Date & Time */}
                    <div className="mb-4 space-y-3">
                      <div className="flex items-start gap-3">
                        <Calendar className="mt-0.5 h-4 w-4 flex-shrink-0 text-gold" />
                        <div>
                          <p className="text-sm font-semibold text-text-primary">
                            {format(
                              new Date(event.dateTime),
                              "EEEE d MMMM yyyy"
                            )}
                          </p>
                          <p className="text-sm text-text-primary/50">
                            {format(new Date(event.dateTime), "h:mm a")}{" "}
                            &ndash;{" "}
                            {format(new Date(event.endTime), "h:mm a")}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-start gap-3">
                        <MapPin className="mt-0.5 h-4 w-4 flex-shrink-0 text-gold" />
                        <div>
                          <p className="text-sm font-semibold text-text-primary">
                            {event.venueName}
                          </p>
                          <p className="text-sm text-text-primary/50">
                            {event.venueAddress}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Attendees */}
                    <div className="mb-6 flex items-center gap-3 rounded-xl bg-bg-primary p-3">
                      <Users className="h-4 w-4 text-gold" />
                      <span className="text-sm text-text-primary/70">
                        {event.attendeeCount} people going
                      </span>
                    </div>

                    {/* Spots left */}
                    {!event.isPast && (
                      <div className="mb-6">
                        {event.spotsLeft > 0 ? (
                          <div>
                            <div className="mb-2 flex items-center justify-between text-sm">
                              <span className="text-text-primary/60">
                                Spots remaining
                              </span>
                              <span className="font-semibold text-text-primary">
                                {event.spotsLeft} / {event.capacity}
                              </span>
                            </div>
                            <div className="h-2 overflow-hidden rounded-full bg-blush/30">
                              <div
                                className={cn(
                                  "h-full rounded-full transition-all",
                                  event.spotsLeft <= 5
                                    ? "bg-amber-500"
                                    : "bg-gold"
                                )}
                                style={{
                                  width: `${
                                    ((event.capacity - event.spotsLeft) /
                                      event.capacity) *
                                    100
                                  }%`,
                                }}
                              />
                            </div>
                            {event.spotsLeft <= 5 && (
                              <p className="mt-2 text-xs font-medium text-amber-600">
                                Only {event.spotsLeft} spots left — book soon!
                              </p>
                            )}
                          </div>
                        ) : (
                          <div className="rounded-xl bg-red-50 p-3 text-center">
                            <p className="text-sm font-semibold text-red-600">
                              This event is sold out
                            </p>
                          </div>
                        )}
                      </div>
                    )}

                    {/* CTA Button */}
                    {!event.isPast && (
                      <>
                        {event.spotsLeft > 0 ? (
                          <button
                            onClick={() => setBookingOpen(true)}
                            className="w-full rounded-2xl bg-gold py-4 text-sm font-semibold text-white shadow-lg shadow-gold/25 transition-all hover:bg-gold-dark hover:shadow-xl hover:shadow-gold/30 active:scale-[0.98]"
                          >
                            {isFree ? "RSVP Now" : "Book Now"}
                          </button>
                        ) : (
                          <div>
                            <button
                              onClick={() => setBookingOpen(true)}
                              className="w-full rounded-2xl border-2 border-charcoal bg-charcoal py-4 text-sm font-semibold text-white transition-all hover:bg-charcoal/90 active:scale-[0.98]"
                            >
                              Join Waitlist
                            </button>
                            <p className="mt-2 text-center text-xs text-text-primary/50">
                              You&apos;ll be notified when a spot opens up
                            </p>
                          </div>
                        )}
                      </>
                    )}

                    {/* Past event badge */}
                    {event.isPast && (
                      <div className="rounded-xl bg-bg-primary p-4 text-center">
                        <p className="text-sm font-medium text-text-primary/50">
                          This event has ended
                        </p>
                        {event.averageRating && (
                          <div className="mt-2 flex items-center justify-center gap-2">
                            <StarRating
                              rating={event.averageRating}
                              size="sm"
                            />
                            <span className="text-sm font-semibold text-text-primary">
                              {event.averageRating.toFixed(1)}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </motion.div>
              </div>
            </div>
          </div>
        </section>

        {/* Related Events */}
        {relatedEvents.length > 0 && (
          <section className="border-t border-blush/40 bg-bg-card">
            <div className="mx-auto max-w-7xl px-6 py-16">
              <motion.div {...fadeInUp}>
                <div className="mb-8 flex items-center justify-between">
                  <h2 className="text-2xl font-bold text-text-primary">
                    More {event.category} Events
                  </h2>
                  <Link
                    href="/events"
                    className="flex items-center gap-1 text-sm font-medium text-gold transition-colors hover:text-gold-dark"
                  >
                    View all
                    <ChevronRight className="h-4 w-4" />
                  </Link>
                </div>
                <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
                  {relatedEvents.map((relatedEvent) => (
                    <EventCard key={relatedEvent.id} event={relatedEvent} />
                  ))}
                </div>
              </motion.div>
            </div>
          </section>
        )}
      </main>

      {/* Gallery Lightbox */}
      {lightboxImage && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 backdrop-blur-sm"
          onClick={() => setLightboxImage(null)}
        >
          <button
            onClick={() => setLightboxImage(null)}
            className="absolute top-6 right-6 z-10 rounded-full bg-white/10 p-3 text-white transition-colors hover:bg-white/20"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
          <div className="relative max-h-[85vh] max-w-5xl">
            <Image
              src={lightboxImage}
              alt="Event gallery photo"
              width={1200}
              height={800}
              className="max-h-[85vh] rounded-lg object-contain"
            />
          </div>
        </motion.div>
      )}

      {/* Booking Modal */}
      <BookingModal
        event={event}
        isOpen={bookingOpen}
        onClose={() => setBookingOpen(false)}
      />
    </>
  );
}
