"use client";

import { Star } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface StarRatingProps {
  rating: number;
  maxStars?: number;
  size?: "sm" | "md" | "lg";
  showNumber?: boolean;
}

const sizeMap = {
  sm: "h-3.5 w-3.5",
  md: "h-5 w-5",
  lg: "h-6 w-6",
};

const textSizeMap = {
  sm: "text-xs",
  md: "text-sm",
  lg: "text-base",
};

export default function StarRating({
  rating,
  maxStars = 5,
  size = "md",
  showNumber = false,
}: StarRatingProps) {
  const stars = [];

  for (let i = 1; i <= maxStars; i++) {
    const filled = rating >= i;
    const halfFilled = !filled && rating >= i - 0.5;

    stars.push(
      <span key={i} className="relative inline-block">
        {/* Empty star (background) */}
        <Star
          className={cn(sizeMap[size], "text-blush")}
          strokeWidth={1.5}
        />
        {/* Filled or half-filled overlay */}
        {(filled || halfFilled) && (
          <span
            className="absolute inset-0 overflow-hidden"
            style={{ width: filled ? "100%" : "50%" }}
          >
            <Star
              className={cn(sizeMap[size], "fill-gold text-gold")}
              strokeWidth={1.5}
            />
          </span>
        )}
      </span>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <div className="flex items-center gap-0.5">{stars}</div>
      {showNumber && (
        <span
          className={cn(
            textSizeMap[size],
            "font-medium tabular-nums text-text-primary/70"
          )}
        >
          {rating.toFixed(1)}
        </span>
      )}
    </div>
  );
}
