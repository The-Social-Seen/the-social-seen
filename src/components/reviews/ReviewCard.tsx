"use client";

import { LegacyEventReview as EventReview } from "@/types";
import { format } from "date-fns";
import { Quote } from "lucide-react";
import StarRating from "@/components/reviews/StarRating";
import Image from "next/image";

interface ReviewCardProps {
  review: EventReview;
}

export default function ReviewCard({ review }: ReviewCardProps) {
  return (
    <div className="relative rounded-2xl border border-blush/40 bg-bg-card p-6 shadow-sm">
      {/* Quote decoration */}
      <Quote className="absolute top-4 right-4 h-8 w-8 text-gold/15" />

      {/* User info */}
      <div className="mb-4 flex items-center gap-3">
        <div className="relative h-10 w-10 overflow-hidden rounded-full ring-2 ring-blush/50">
          <Image
            src={review.userAvatar}
            alt={review.userName}
            fill
            className="object-cover"
            sizes="40px"
          />
        </div>
        <div>
          <p className="text-sm font-semibold text-text-primary">
            {review.userName}
          </p>
          <p className="text-xs text-text-primary/50">
            {format(new Date(review.createdAt), "d MMM yyyy")}
          </p>
        </div>
      </div>

      {/* Star rating */}
      <div className="mb-3">
        <StarRating rating={review.rating} size="sm" />
      </div>

      {/* Review text */}
      <p className="text-sm italic leading-relaxed text-text-primary/70">
        &ldquo;{review.reviewText}&rdquo;
      </p>
    </div>
  );
}
