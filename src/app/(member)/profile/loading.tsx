import { Skeleton } from "@/components/shared/SkeletonCard";

export default function ProfileLoading() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 md:py-20">
      {/* Avatar + name */}
      <div className="mb-8 flex items-center gap-5">
        <Skeleton className="h-20 w-20 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-6 w-48 rounded-lg" />
          <Skeleton className="h-4 w-36 rounded-lg" />
        </div>
      </div>

      {/* Form sections */}
      <div className="space-y-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-border-light bg-bg-card p-6 space-y-4">
            <Skeleton className="h-5 w-40 rounded-lg" />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Skeleton className="h-11 rounded-xl" />
              <Skeleton className="h-11 rounded-xl" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
