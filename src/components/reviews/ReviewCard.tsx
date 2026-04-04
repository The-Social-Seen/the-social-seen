"use client";

import type { ReviewWithAuthor } from "@/types";
import { formatDateCard } from "@/lib/utils/dates";
import { resolveAvatarUrl, getInitials } from "@/lib/utils/images";
import { Quote } from "lucide-react";
import StarRating from "@/components/reviews/StarRating";
import Image from "next/image";

interface ReviewCardProps {
  review: ReviewWithAuthor;
}

export default function ReviewCard({ review }: ReviewCardProps) {
  const avatarUrl = resolveAvatarUrl(review.author.avatar_url);
  const initials = getInitials(review.author.full_name);

  return (
    <div className="relative rounded-2xl border border-blush/40 bg-bg-card p-6 shadow-sm">
      {/* Quote decoration */}
      <Quote className="absolute top-4 right-4 h-8 w-8 text-gold/15" />

      {/* User info */}
      <div className="mb-4 flex items-center gap-3">
        <div className="relative h-10 w-10 overflow-hidden rounded-full ring-2 ring-blush/50">
          {avatarUrl ? (
            <Image
              src={avatarUrl}
              alt={review.author.full_name}
              fill
              className="object-cover"
              sizes="40px"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gold/10 text-xs font-semibold text-gold">
              {initials}
            </div>
          )}
        </div>
        <div>
          <p className="text-sm font-semibold text-text-primary">
            {review.author.full_name}
          </p>
          <p className="text-xs text-text-primary/50">
            {formatDateCard(review.created_at)}
          </p>
        </div>
      </div>

      {/* Star rating */}
      <div className="mb-3">
        <StarRating rating={review.rating} size="sm" />
      </div>

      {/* Review text */}
      {review.review_text && (
        <p className="text-sm italic leading-relaxed text-text-primary/70">
          &ldquo;{review.review_text}&rdquo;
        </p>
      )}
    </div>
  );
}
