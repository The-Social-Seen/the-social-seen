"use client";

import Image from "next/image";
import { motion } from "framer-motion";
import { Quote, Star } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { resolveAvatarUrl } from "@/lib/utils/images";
import type { HomepageReview } from "@/lib/supabase/queries/reviews";

interface TestimonialsSectionProps {
  reviews: HomepageReview[];
}

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex gap-1" aria-label={`${rating} out of 5 stars`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className={cn(
            "h-4 w-4",
            i < rating
              ? "fill-gold text-gold"
              : "fill-none text-text-tertiary/40",
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

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function TestimonialsSection({ reviews }: TestimonialsSectionProps) {
  // Empty state — render nothing rather than a stub. Once events have
  // run and members have left reviews, the section appears.
  if (reviews.length === 0) return null;

  return (
    <section className="bg-charcoal px-6 py-24 md:py-32">
      <div className="mx-auto max-w-6xl">
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

        <motion.div
          className="grid gap-8 md:grid-cols-3"
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-50px" }}
        >
          {reviews.map((review) => {
            const avatar = resolveAvatarUrl(review.author.avatar_url);
            return (
            <motion.div
              key={review.id}
              variants={cardVariants}
              className="group relative rounded-2xl bg-white/5 p-8 backdrop-blur-sm transition-colors hover:bg-white/10"
            >
              <Quote className="mb-6 h-8 w-8 text-gold/40" />

              <p className="mb-8 font-sans text-base italic leading-relaxed text-white/80">
                &ldquo;{review.review_text}&rdquo;
              </p>

              <div className="mb-6">
                <StarRating rating={review.rating} />
              </div>

              <div className="flex items-center gap-4">
                <div className="relative h-12 w-12 overflow-hidden rounded-full bg-gold/20">
                  {avatar ? (
                    <Image
                      src={avatar}
                      alt={review.author.full_name}
                      fill
                      className="object-cover"
                      sizes="48px"
                    />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center text-sm font-semibold text-gold">
                      {getInitials(review.author.full_name)}
                    </span>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="truncate font-sans text-sm font-semibold text-white">
                    {review.author.full_name}
                  </p>
                  <p className="truncate font-sans text-xs text-white/50">
                    {review.event.title || "Verified Member"}
                  </p>
                </div>
              </div>
            </motion.div>
            );
          })}
        </motion.div>
      </div>
    </section>
  );
}
