"use client";

import Image from "next/image";
import Link from "next/link";
import { motion } from "framer-motion";
import { MapPin, Star } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { formatDateCard } from "@/lib/utils/dates";
import { formatPrice } from "@/lib/utils/currency";
import { resolveEventImage } from "@/lib/utils/images";
import { isPastEvent } from "@/lib/utils/dates";
import { LOW_SPOTS_THRESHOLD } from "@/lib/constants";
import { categoryLabel } from "@/types";
import type { EventWithStats } from "@/types";

interface EventCardProps {
  event: EventWithStats;
  showRating?: boolean;
}

function SpotsIndicator({ spotsLeft }: { spotsLeft: number | null }) {
  // Unlimited capacity
  if (spotsLeft === null) return null;

  if (spotsLeft === 0) {
    return (
      <span className="inline-flex items-center rounded-full border border-gold/20 bg-gold/10 px-3 py-1 font-sans text-xs font-semibold text-gold">
        Join Waitlist
      </span>
    );
  }

  if (spotsLeft <= LOW_SPOTS_THRESHOLD) {
    return (
      <span className="font-sans text-sm font-semibold text-gold">
        {spotsLeft} spots left
      </span>
    );
  }

  return (
    <span className="font-sans text-sm text-text-tertiary">
      {spotsLeft} spots left
    </span>
  );
}

export function EventCard({ event, showRating }: EventCardProps) {
  const isPast = isPastEvent(event.date_time);
  const imageUrl = resolveEventImage(event.image_url);
  const isSoldOut = !isPast && event.spots_left !== null && event.spots_left === 0;

  return (
    <Link href={`/events/${event.slug}`} className="block">
      <motion.article
        layout
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        whileHover={{ y: -6 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="group h-full overflow-hidden rounded-2xl border border-border-light bg-bg-card shadow-sm transition-shadow duration-300 hover:shadow-xl"
      >
        {/* Image container */}
        <div className="relative aspect-[16/10] overflow-hidden">
          {imageUrl ? (
            <Image
              src={imageUrl}
              alt={event.title}
              fill
              className="object-cover transition-transform duration-500 group-hover:scale-105"
              sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
            />
          ) : (
            <div className="flex h-full items-center justify-center bg-blush/30">
              <span className="text-sm text-text-tertiary">No image</span>
            </div>
          )}

          {/* Gradient overlay at bottom for readability */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent" />

          {/* Category badge */}
          <div className="absolute left-3 top-3">
            <span className="inline-flex items-center rounded-full bg-white/90 px-3 py-1 font-sans text-xs font-semibold text-charcoal backdrop-blur-sm">
              {categoryLabel(event.category)}
            </span>
          </div>

          {/* Rating badge (past events) */}
          {isPast && event.avg_rating > 0 && (
            <div className="absolute right-3 top-3">
              <span className="inline-flex items-center gap-1 rounded-full bg-charcoal/80 px-3 py-1 backdrop-blur-sm">
                <Star className="h-3 w-3 fill-gold text-gold" />
                <span className="font-sans text-xs font-semibold text-white">
                  {event.avg_rating.toFixed(1)}
                </span>
              </span>
            </div>
          )}

          {/* Sold out overlay */}
          {isSoldOut && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-[2px]">
              <span className="rounded-full bg-gold px-4 py-2 font-sans text-sm font-bold uppercase tracking-wider text-white">
                Sold Out
              </span>
            </div>
          )}
        </div>

        {/* Card body */}
        <div className="p-5">
          {/* Date */}
          <p className="mb-1.5 font-sans text-xs font-semibold uppercase tracking-widest text-gold">
            {formatDateCard(event.date_time)}
          </p>

          {/* Title */}
          <h3 className="mb-2 font-serif text-lg font-bold leading-snug text-text-primary transition-colors group-hover:text-gold">
            {event.title}
          </h3>

          {/* Venue */}
          <div className="mb-4 flex items-center gap-1.5 text-text-tertiary">
            <MapPin className="h-3.5 w-3.5 flex-shrink-0" />
            <p className="truncate font-sans text-sm">{event.venue_name}</p>
          </div>

          {/* Price + Spots */}
          <div className="flex items-center justify-between border-t border-border-light pt-3">
            <p
              className={cn(
                "font-sans text-base font-bold",
                event.price === 0
                  ? "text-success"
                  : "text-text-primary"
              )}
            >
              {formatPrice(event.price)}
            </p>

            {!isPast && <SpotsIndicator spotsLeft={event.spots_left} />}

            {showRating && isPast && event.avg_rating > 0 && (
              <span className="inline-flex items-center gap-1 text-text-tertiary">
                <Star className="h-3.5 w-3.5 fill-gold text-gold" />
                <span className="font-sans text-sm">
                  {event.avg_rating.toFixed(1)} ({event.review_count})
                </span>
              </span>
            )}
          </div>
        </div>
      </motion.article>
    </Link>
  );
}

export default EventCard;
