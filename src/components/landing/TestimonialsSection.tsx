"use client";

import Image from "next/image";
import { motion } from "framer-motion";
import { Quote, Star } from "lucide-react";
import { pastEvents } from "@/data/events";
import { cn } from "@/lib/utils/cn";
import type { LegacyEventReview as EventReview } from "@/types";

function getTopReviews(): EventReview[] {
  const allReviews = pastEvents
    .filter((e) => e.reviews && e.reviews.length > 0)
    .flatMap((e) => e.reviews!);

  return allReviews.sort((a, b) => b.rating - a.rating).slice(0, 3);
}

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex gap-1">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className={cn(
            "h-4 w-4",
            i < rating
              ? "fill-gold text-gold"
              : "fill-none text-text-tertiary/40"
          )}
        />
      ))}
    </div>
  );
}

const containerVariants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.15,
    },
  },
};

const cardVariants = {
  hidden: { opacity: 0, y: 30 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] as const },
  },
};

export function TestimonialsSection() {
  const topReviews = getTopReviews();

  return (
    <section className="bg-charcoal px-6 py-24 md:py-32">
      <div className="mx-auto max-w-6xl">
        {/* Section header */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.6 }}
          className="mb-16 text-center"
        >
          <p className="mb-4 font-sans text-sm font-medium uppercase tracking-[0.2em] text-gold">
            Testimonials
          </p>
          <h2 className="font-serif text-4xl font-bold text-white md:text-5xl">
            What Our Members Say
          </h2>
        </motion.div>

        {/* Testimonials cards */}
        <motion.div
          className="grid gap-8 md:grid-cols-3"
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-50px" }}
        >
          {topReviews.map((review) => (
            <motion.div
              key={review.id}
              variants={cardVariants}
              className="group relative rounded-2xl bg-white/5 p-8 backdrop-blur-sm transition-colors hover:bg-white/10"
            >
              {/* Quote icon */}
              <Quote className="mb-6 h-8 w-8 text-gold/40" />

              {/* Review text */}
              <p className="mb-8 font-sans text-base italic leading-relaxed text-white/80">
                &ldquo;{review.reviewText}&rdquo;
              </p>

              {/* Rating */}
              <div className="mb-6">
                <StarRating rating={review.rating} />
              </div>

              {/* Author */}
              <div className="flex items-center gap-4">
                <div className="relative h-12 w-12 overflow-hidden rounded-full">
                  <Image
                    src={review.userAvatar}
                    alt={review.userName}
                    fill
                    className="object-cover"
                    sizes="48px"
                  />
                </div>
                <div>
                  <p className="font-sans text-sm font-semibold text-white">
                    {review.userName}
                  </p>
                  <p className="font-sans text-xs text-white/50">
                    Verified Member
                  </p>
                </div>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
