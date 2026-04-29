import Link from 'next/link'
import { Camera } from 'lucide-react'
import { canonicalUrl } from '@/lib/utils/site'
import type { Metadata } from 'next'

// 2026-04-29: gallery feature paused. The route is preserved as a soft
// "coming soon" page so existing bookmarks / external links don't 404,
// but no photos are fetched and no nav surfaces promote it. Restore the
// full gallery flow once the admin / member upload UI ships — see
// memory/project_event_gallery_hidden.md for the restoration checklist.

export const metadata: Metadata = {
  title: 'Gallery — The Social Seen',
  description: 'Photos from our events are coming soon.',
  alternates: { canonical: canonicalUrl('/gallery') },
}

export default function GalleryPage() {
  return (
    <main className="min-h-screen bg-bg-primary">
      <section className="flex min-h-screen items-center justify-center px-6 pt-16 sm:pt-20">
        <div className="mx-auto max-w-xl text-center">
          <div className="mb-6 flex justify-center">
            <Camera className="h-10 w-10 text-gold" aria-hidden />
          </div>
          <p className="mb-3 text-sm font-medium uppercase tracking-wider text-gold">
            Gallery
          </p>
          <h1 className="mb-4 font-serif text-4xl font-bold tracking-tight text-text-primary md:text-5xl">
            Coming soon
          </h1>
          <p className="mb-8 text-lg leading-relaxed text-text-primary/60">
            We&apos;re building a way to share photos from the night.
            In the meantime, head to our events page to see what&apos;s coming up.
          </p>
          <Link
            href="/events"
            className="inline-flex items-center rounded-full bg-charcoal px-6 py-3 text-sm font-medium text-white transition hover:bg-charcoal/90"
          >
            See upcoming events
          </Link>
        </div>
      </section>
    </main>
  )
}
