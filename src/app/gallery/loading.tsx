export default function GalleryLoading() {
  return (
    <main className="min-h-screen bg-bg-primary pt-16 sm:pt-20">
      {/* Page header skeleton */}
      <section className="border-b border-blush/40 bg-bg-card">
        <div className="mx-auto max-w-7xl px-6 py-16 md:py-20">
          <div className="animate-shimmer mb-4 h-10 w-48 rounded-xl" />
          <div className="animate-shimmer h-5 w-96 max-w-full rounded-lg" />
        </div>
      </section>

      {/* Masonry grid skeleton */}
      <section className="mx-auto max-w-7xl px-6 py-12">
        <div className="columns-2 gap-4 md:columns-3 lg:columns-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <div
              key={i}
              className="animate-shimmer mb-4 w-full break-inside-avoid rounded-xl"
              style={{ height: `${180 + (i % 4) * 60}px` }}
            />
          ))}
        </div>
      </section>
    </main>
  );
}
