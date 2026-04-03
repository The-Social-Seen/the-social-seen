"use client";

import Image from "next/image";
import Link from "next/link";
import { motion } from "framer-motion";
import { MapPin, Star } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils/cn";
import type { SocialEvent } from "@/types";

interface EventCardProps {
  event: SocialEvent;
  showRating?: boolean;
}

function SpotsIndicator({ spotsLeft }: { spotsLeft: number }) {
  if (spotsLeft === 0) {
    return (
      <span className="inline-flex items-center rounded-full bg-red-500/10 px-3 py-1 font-sans text-xs font-semibold text-red-600 dark:text-red-400">
        Waitlist
      </span>
    );
  }
  if (spotsLeft <= 5) {
    return (
      <span className="inline-flex items-center rounded-full bg-amber-500/10 px-3 py-1 font-sans text-xs font-semibold text-amber-600 dark:text-amber-400">
        {spotsLeft} spots left
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-3 py-1 font-sans text-xs font-semibold text-emerald-600 dark:text-emerald-400">
      {spotsLeft} spots left
    </span>
  );
}

export function EventCard({ event, showRating }: EventCardProps) {
  const eventDate = new Date(event.dateTime);
  const formattedDate = format(eventDate, "EEE, d MMM");

  return (
    <Link href={`/events/${event.slug}`} className="block">
      <motion.article
        whileHover={{ y: -6 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="group h-full overflow-hidden rounded-2xl bg-bg-card border border-border-light shadow-sm transition-shadow duration-300 hover:shadow-xl"
      >
        {/* Image container */}
        <div className="relative aspect-[16/10] overflow-hidden">
          <Image
            src={event.imageUrl}
            alt={event.title}
            fill
            className="object-cover transition-transform duration-500 group-hover:scale-105"
            sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
          />

          {/* Gradient overlay at bottom for readability */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent" />

          {/* Category badge */}
          <div className="absolute left-3 top-3">
            <span className="inline-flex items-center rounded-full bg-white/90 px-3 py-1 font-sans text-xs font-semibold text-charcoal backdrop-blur-sm">
              {event.category}
            </span>
          </div>

          {/* Rating badge (past events) */}
          {event.isPast && event.averageRating && (
            <div className="absolute right-3 top-3">
              <span className="inline-flex items-center gap-1 rounded-full bg-charcoal/80 px-3 py-1 backdrop-blur-sm">
                <Star className="h-3 w-3 fill-gold text-gold" />
                <span className="font-sans text-xs font-semibold text-white">
                  {event.averageRating.toFixed(1)}
                </span>
              </span>
            </div>
          )}

          {/* Sold out overlay */}
          {!event.isPast && event.spotsLeft === 0 && (
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
            {formattedDate}
          </p>

          {/* Title */}
          <h3 className="mb-2 font-serif text-lg font-bold leading-snug text-text-primary transition-colors group-hover:text-gold">
            {event.title}
          </h3>

          {/* Venue */}
          <div className="mb-4 flex items-center gap-1.5 text-text-tertiary">
            <MapPin className="h-3.5 w-3.5 flex-shrink-0" />
            <p className="truncate font-sans text-sm">{event.venueName}</p>
          </div>

          {/* Price + Spots */}
          <div className="flex items-center justify-between border-t border-border-light pt-3">
            <p
              className={cn(
                "font-sans text-base font-bold",
                event.price === 0 ? "text-emerald-600 dark:text-emerald-400" : "text-text-primary"
              )}
            >
              {event.price === 0 ? "Free" : `£${event.price}`}
            </p>

            {!event.isPast && <SpotsIndicator spotsLeft={event.spotsLeft} />}

            {event.isPast && event.averageRating && event.totalReviews && (
              <span className="inline-flex items-center gap-1 text-text-tertiary">
                <Star className="h-3.5 w-3.5 fill-gold text-gold" />
                <span className="font-sans text-sm">
                  {event.averageRating.toFixed(1)} ({event.totalReviews})
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
