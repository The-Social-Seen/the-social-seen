'use client';

import { useEffect } from 'react';
import Link from 'next/link';

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: ErrorProps) {
  useEffect(() => {
    // Log to error reporting service in production
    if (process.env.NODE_ENV !== 'development') return;
    // eslint-disable-next-line no-console
    console.error('[GlobalError]', error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-bg-primary px-6 text-center">
      {/* Gold accent line */}
      <div className="mb-8 h-1 w-16 rounded-full bg-gold" />

      {/* Logo */}
      <p className="mb-10 font-serif text-xl font-bold text-text-primary">
        The Social Seen
      </p>

      <h1 className="mb-3 font-serif text-3xl font-bold text-text-primary md:text-4xl">
        Something went wrong
      </h1>
      <p className="mb-8 max-w-md font-sans text-sm leading-relaxed text-text-secondary">
        We hit an unexpected snag. Our team has been notified. In the meantime,
        try refreshing the page or head back home.
      </p>

      <div className="flex flex-col gap-3 sm:flex-row">
        <button
          onClick={reset}
          className="rounded-full bg-gold px-8 py-3 font-sans text-sm font-semibold text-white transition-all hover:bg-gold-dark active:scale-95"
        >
          Try Again
        </button>
        <Link
          href="/"
          className="rounded-full border border-border px-8 py-3 font-sans text-sm font-semibold text-text-primary transition-all hover:bg-blush/20"
        >
          Back to Home
        </Link>
      </div>

      {/* Digest for support reference */}
      {error.digest && (
        <p className="mt-10 font-sans text-xs text-text-tertiary">
          Error ref: {error.digest}
        </p>
      )}
    </div>
  );
}
