import { SkeletonEventGrid } from "@/components/shared/SkeletonCard";

export default function EventsLoading() {
  return (
    <main className="min-h-screen bg-bg-primary">
      {/* Page header skeleton */}
      <section className="border-b border-blush/40 bg-bg-card pt-16 sm:pt-20">
        <div className="mx-auto max-w-7xl px-6 py-16 md:py-20">
          <div className="animate-shimmer mb-4 h-10 w-64 rounded-xl" />
          <div className="animate-shimmer h-5 w-full max-w-lg rounded-lg" />
          <div className="animate-shimmer mt-2 h-5 w-3/4 max-w-md rounded-lg" />
        </div>
      </section>

      {/* Filter bar skeleton */}
      <div className="border-b border-blush/40 bg-bg-card/80">
        <div className="mx-auto max-w-7xl px-6 py-4">
          <div className="flex gap-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="animate-shimmer h-9 w-20 flex-shrink-0 rounded-full" />
            ))}
          </div>
        </div>
      </div>

      {/* Events grid skeleton */}
      <section className="mx-auto max-w-7xl px-6 py-12">
        <SkeletonEventGrid count={6} />
      </section>
    </main>
  );
}
