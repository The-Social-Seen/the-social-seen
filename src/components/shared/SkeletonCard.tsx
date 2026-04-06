import { cn } from "@/lib/utils/cn";

interface SkeletonProps {
  className?: string;
}

/** Single block skeleton with brand gold/cream shimmer */
export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      className={cn("animate-shimmer rounded-lg", className)}
      aria-hidden="true"
    />
  );
}

/** Event card skeleton — matches EventCard dimensions */
export function SkeletonCard({ className }: SkeletonProps) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border border-border-light bg-bg-card",
        className
      )}
      aria-hidden="true"
    >
      {/* Image area */}
      <div className="animate-shimmer aspect-[16/10] w-full" />

      {/* Content area */}
      <div className="space-y-3 p-5">
        {/* Date */}
        <div className="animate-shimmer h-3 w-24 rounded-full" />
        {/* Title */}
        <div className="animate-shimmer h-5 w-3/4 rounded-lg" />
        <div className="animate-shimmer h-5 w-1/2 rounded-lg" />
        {/* Venue */}
        <div className="animate-shimmer h-4 w-2/3 rounded-lg" />
        {/* Price row */}
        <div className="flex items-center justify-between border-t border-border-light pt-3">
          <div className="animate-shimmer h-5 w-16 rounded-lg" />
          <div className="animate-shimmer h-4 w-20 rounded-full" />
        </div>
      </div>
    </div>
  );
}

/** Row skeleton for tables and list items */
export function SkeletonRow({ columns = 4, className }: SkeletonProps & { columns?: number }) {
  return (
    <tr className={cn("border-b border-border-light", className)} aria-hidden="true">
      {Array.from({ length: columns }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="animate-shimmer h-4 rounded-lg" style={{ width: `${60 + (i % 3) * 20}%` }} />
        </td>
      ))}
    </tr>
  );
}

/** Grid of event card skeletons */
export function SkeletonEventGrid({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}
