"use client";

import { useState, useRef } from "react";

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
import * as LucideIcons from "lucide-react";
import { formatDateCard, formatDateFull, formatTimeRange, isPastEvent } from "@/lib/utils/dates";
import { formatPrice } from "@/lib/utils/currency";
import { resolveEventImage, resolveAvatarUrl, getInitials } from "@/lib/utils/images";
import BookingModal from "@/components/events/BookingModal";
import StarRating from "@/components/reviews/StarRating";
import ReviewCard from "@/components/reviews/ReviewCard";
import EventCard from "@/components/events/EventCard";
import MobileBookingBar from "@/components/events/MobileBookingBar";
import type {
  EventDetail,
  ReviewWithAuthor,
  EventPhoto,
  EventWithStats,
  Booking,
} from "@/types";

interface EventDetailClientProps {
  event: EventDetail;
  reviews: ReviewWithAuthor[];
  photos: EventPhoto[];
  relatedEvents: EventWithStats[];
  userBooking: Booking | null;
}

const fadeInUp = {
  initial: { opacity: 0, y: 30 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-50px" },
  transition: { duration: 0.5 },
};

function getLucideIcon(name: string | null): React.ComponentType<{ className?: string }> | null {
  if (!name) return null;
  // Convert kebab-case to PascalCase for Lucide icon lookup
  const pascalName = name
    .split("-")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join("");
  const Icon = (LucideIcons as Record<string, unknown>)[pascalName];
  if (typeof Icon === "function") return Icon as React.ComponentType<{ className?: string }>;
  return null;
}

export default function EventDetailClient({
  event,
  reviews,
  photos,
  relatedEvents,
}: EventDetailClientProps) {
  const [bookingOpen, setBookingOpen] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);

  const isPast = isPastEvent(event.date_time);
  const isFree = event.price === 0;
  const isSoldOut = !isPast && event.spots_left !== null && event.spots_left === 0;
  const hasReviews = reviews.length > 0;
  const hasGallery = photos.length > 0;
  const heroImage = resolveEventImage(event.image_url);

  return (
    <>
      <main className="min-h-screen bg-bg-primary">
        {/* Hero Section */}
        <section className="relative h-[50vh] min-h-[400px] overflow-hidden">
          {heroImage ? (
            <Image
              src={heroImage}
              alt={event.title}
              fill
              className="object-cover"
              priority
              sizes="100vw"
            />
          ) : (
            <div className="h-full bg-charcoal" />
          )}
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
                  {isPast && (
                    <span className="rounded-full bg-white/20 px-3 py-1 text-xs font-medium text-white backdrop-blur-sm">
                      Past Event
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
                      {formatDateCard(event.date_time)}
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
                      {formatTimeRange(event.date_time, event.end_time)}
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
                      {event.confirmed_count} people going
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
              {event.inclusions.length > 0 && (
                <motion.div {...fadeInUp} className="mb-10">
                  <h2 className="mb-4 text-2xl font-bold text-text-primary">
                    What&apos;s Included
                  </h2>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {event.inclusions.map((inclusion) => {
                      const IconComponent = getLucideIcon(inclusion.icon);
                      return (
                        <div
                          key={inclusion.id}
                          className="flex items-center gap-3 rounded-xl bg-bg-card p-4 shadow-sm"
                        >
                          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-gold/10">
                            {IconComponent ? (
                              <IconComponent className="h-4 w-4 text-gold" />
                            ) : (
                              <Check className="h-4 w-4 text-gold" />
                            )}
                          </div>
                          <span className="text-sm font-medium text-text-primary">
                            {inclusion.label}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </motion.div>
              )}

              {/* Dress Code */}
              {event.dress_code && (
                <motion.div {...fadeInUp} className="mb-10">
                  <h2 className="mb-4 text-2xl font-bold text-text-primary">
                    Dress Code
                  </h2>
                  <div className="inline-flex items-center gap-2 rounded-xl bg-bg-card px-5 py-3 shadow-sm">
                    <span className="text-sm font-medium text-text-primary">
                      {event.dress_code}
                    </span>
                  </div>
                </motion.div>
              )}

              {/* Host Section */}
              {event.hosts.length > 0 && (
                <motion.div
                  {...fadeInUp}
                  className="mb-10 rounded-2xl border border-blush/40 bg-bg-card p-6"
                >
                  <h2 className="mb-5 text-2xl font-bold text-text-primary">
                    {event.hosts.length === 1 ? "Your Host" : "Your Hosts"}
                  </h2>
                  <div className="space-y-6">
                    {event.hosts.map((host) => {
                      const avatarUrl = resolveAvatarUrl(host.profile.avatar_url);
                      const initials = getInitials(host.profile.full_name);
                      return (
                        <div key={host.id} className="flex items-start gap-4">
                          <div className="relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-full ring-2 ring-gold/30">
                            {avatarUrl ? (
                              <Image
                                src={avatarUrl}
                                alt={host.profile.full_name}
                                fill
                                className="object-cover"
                                sizes="64px"
                              />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center bg-gold/10 text-sm font-semibold text-gold">
                                {initials}
                              </div>
                            )}
                          </div>
                          <div>
                            <h3 className="text-lg font-semibold text-text-primary">
                              {host.profile.full_name}
                            </h3>
                            <p className="mb-2 text-sm font-medium text-gold">
                              {host.role_label}
                            </p>
                            {host.profile.bio && (
                              <p className="text-sm leading-relaxed text-text-primary/60">
                                {host.profile.bio}
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </motion.div>
              )}

              {/* Reviews Section (Past events with reviews) */}
              {hasReviews && (
                <motion.div {...fadeInUp} className="mb-10">
                  <div className="mb-6 flex items-center gap-4">
                    <h2 className="text-2xl font-bold text-text-primary">
                      Reviews
                    </h2>
                    <div className="flex items-center gap-2">
                      <StarRating
                        rating={event.avg_rating}
                        size="md"
                        showNumber
                      />
                      <span className="text-sm text-text-primary/50">
                        ({event.review_count}{" "}
                        {event.review_count === 1 ? "review" : "reviews"})
                      </span>
                    </div>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    {reviews.map((review) => (
                      <ReviewCard key={review.id} review={review} />
                    ))}
                  </div>
                </motion.div>
              )}

              {/* Gallery Section (Past events with photos) */}
              {hasGallery && (
                <motion.div {...fadeInUp} className="mb-10">
                  <h2 className="mb-6 text-2xl font-bold text-text-primary">
                    Event Gallery
                  </h2>
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                    {photos.map((photo) => {
                      const photoUrl = resolveEventImage(photo.image_url);
                      if (!photoUrl) return null;
                      return (
                        <button
                          key={photo.id}
                          onClick={() => setLightboxImage(photoUrl)}
                          className="group relative aspect-square overflow-hidden rounded-xl"
                        >
                          <Image
                            src={photoUrl}
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
                      );
                    })}
                  </div>
                </motion.div>
              )}
            </div>

            {/* Right column (1/3) - Sticky Booking Card */}
            <div className="lg:w-1/3">
              <div className="sticky top-8" ref={sidebarRef}>
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
                        <span className="text-3xl font-bold text-success">
                          Free
                        </span>
                      ) : (
                        <div className="flex items-baseline gap-1">
                          <span className="text-3xl font-bold text-gold">
                            {formatPrice(event.price)}
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
                            {formatDateFull(event.date_time)}
                          </p>
                          <p className="text-sm text-text-primary/50">
                            {formatTimeRange(event.date_time, event.end_time)}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-start gap-3">
                        <MapPin className="mt-0.5 h-4 w-4 flex-shrink-0 text-gold" />
                        <div>
                          <p className="text-sm font-semibold text-text-primary">
                            {event.venue_name}
                          </p>
                          <p className="text-sm text-text-primary/50">
                            {event.venue_address}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Attendees */}
                    <div className="mb-6 flex items-center gap-3 rounded-xl bg-bg-primary p-3">
                      <Users className="h-4 w-4 text-gold" />
                      <span className="text-sm text-text-primary/70">
                        {event.confirmed_count} people going
                      </span>
                    </div>

                    {/* Spots left / Waitlist messaging */}
                    {!isPast && (
                      <div className="mb-6">
                        {event.spots_left !== null && event.spots_left > 0 ? (
                          <div>
                            <div className="mb-2 flex items-center justify-between text-sm">
                              <span className="text-text-primary/60">
                                Spots remaining
                              </span>
                              <span className="font-semibold text-text-primary">
                                {event.spots_left} / {event.capacity}
                              </span>
                            </div>
                            {/* Capacity bar: gold fill, cream track */}
                            <div className="h-2 overflow-hidden rounded-full bg-cream">
                              <div
                                className="h-full rounded-full bg-gold transition-all"
                                style={{
                                  width: `${
                                    event.capacity
                                      ? ((event.capacity - event.spots_left) /
                                          event.capacity) *
                                        100
                                      : 0
                                  }%`,
                                }}
                              />
                            </div>
                            {event.spots_left <= 5 && (
                              <p className="mt-2 text-xs font-medium text-gold">
                                Only {event.spots_left} spots left — book soon!
                              </p>
                            )}
                          </div>
                        ) : event.spots_left === null ? null : (
                          /* Positive waitlist messaging (Amendment 3.3 / RC-05) */
                          <div className="rounded-xl bg-gold/5 border border-gold/20 p-4 text-center">
                            <p className="text-sm font-semibold text-text-primary">
                              This event is fully booked — join the waitlist
                            </p>
                            <p className="mt-1 text-xs text-text-primary/60">
                              Most waitlisted members get a spot — we&apos;ll let you know the moment one opens
                            </p>
                          </div>
                        )}
                      </div>
                    )}

                    {/* CTA Button */}
                    {!isPast && (
                      <>
                        {!isSoldOut ? (
                          <button
                            onClick={() => setBookingOpen(true)}
                            className="w-full rounded-2xl bg-gold py-4 text-sm font-semibold text-white shadow-lg shadow-gold/25 transition-all hover:bg-gold-dark hover:shadow-xl hover:shadow-gold/30 active:scale-[0.98]"
                          >
                            {isFree ? "RSVP Now" : "Book Now"}
                          </button>
                        ) : (
                          /* Waitlist CTA: GOLD button (Amendment 3.3) */
                          <button
                            onClick={() => setBookingOpen(true)}
                            className="w-full rounded-2xl bg-gold py-4 text-sm font-semibold text-white shadow-lg shadow-gold/25 transition-all hover:bg-gold-dark hover:shadow-xl hover:shadow-gold/30 active:scale-[0.98]"
                          >
                            Join Waitlist
                          </button>
                        )}
                      </>
                    )}

                    {/* Past event badge */}
                    {isPast && (
                      <div className="rounded-xl bg-bg-primary p-4 text-center">
                        <p className="text-sm font-medium text-text-primary/50">
                          This event has ended
                        </p>
                        {event.avg_rating > 0 && (
                          <div className="mt-2 flex items-center justify-center gap-2">
                            <StarRating
                              rating={event.avg_rating}
                              size="sm"
                            />
                            <span className="text-sm font-semibold text-text-primary">
                              {event.avg_rating.toFixed(1)}
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
            aria-label="Close lightbox"
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

      {/* Mobile Booking Bar (Amendment 3.2 / CF-03) */}
      <MobileBookingBar
        price={event.price}
        spotsLeft={event.spots_left}
        isFree={isFree}
        isSoldOut={isSoldOut}
        isPast={isPast}
        onBookClick={() => setBookingOpen(true)}
        sidebarRef={sidebarRef}
      />

      {/* Booking Modal — uses legacy SocialEvent type, will be rewritten in Batch 6.
          Cast needed until then; the modal displays mock data anyway. */}
      <BookingModal
        event={event as never}
        isOpen={bookingOpen}
        onClose={() => setBookingOpen(false)}
      />
    </>
  );
}
