import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Page Not Found — The Social Seen",
  description: "The page you're looking for doesn't exist.",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-bg-primary px-6 text-center">
      <p className="mb-4 font-sans text-sm font-medium uppercase tracking-[0.3em] text-gold">
        404
      </p>
      <h1 className="mb-4 font-serif text-4xl font-bold text-text-primary md:text-5xl">
        Page Not Found
      </h1>
      <p className="mb-10 max-w-sm text-base leading-relaxed text-text-secondary">
        The page you&apos;re looking for doesn&apos;t exist or may have been
        moved.
      </p>
      <div className="flex flex-col items-center gap-3 sm:flex-row">
        <Link
          href="/events"
          className="inline-flex items-center justify-center rounded-full bg-gold px-8 py-3.5 font-sans text-sm font-semibold uppercase tracking-wider text-white transition-all duration-200 hover:bg-gold/90"
        >
          Browse Events
        </Link>
        <Link
          href="/"
          className="inline-flex items-center justify-center rounded-full border border-border px-8 py-3.5 font-sans text-sm font-semibold uppercase tracking-wider text-text-primary transition-all duration-200 hover:border-gold hover:text-gold"
        >
          Go Home
        </Link>
      </div>
    </div>
  );
}
