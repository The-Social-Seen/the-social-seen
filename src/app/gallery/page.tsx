import { Camera } from 'lucide-react'
import { getAllGalleryPhotos, getGalleryEvents } from '@/lib/supabase/queries/gallery'
import { canonicalUrl } from '@/lib/utils/site'
import GalleryClient from '@/components/gallery/GalleryClient'
import { InstagramFollowSection } from '@/components/landing/InstagramFollowSection'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Gallery — The Social Seen',
  description: 'Moments captured at our events. Every photo tells a story of connection, culture, and unforgettable experiences.',
  alternates: { canonical: canonicalUrl('/gallery') },
}

interface PageProps {
  searchParams: Promise<{ event?: string }>
}

export default async function GalleryPage({ searchParams }: PageProps) {
  const { event: eventSlug } = await searchParams

  const [photos, events] = await Promise.all([
    getAllGalleryPhotos(),
    getGalleryEvents(),
  ])

  return (
    <main className="min-h-screen bg-bg-primary">
      {/* Header — pt-16/pt-20 clears the fixed nav header */}
      <section className="border-b border-blush/40 bg-bg-card pt-16 sm:pt-20">
        <div className="mx-auto max-w-7xl px-6 py-12 md:py-16">
          <div className="mb-3 flex items-center gap-2">
            <Camera className="h-5 w-5 text-gold" />
            <span className="text-sm font-medium uppercase tracking-wider text-gold">
              Gallery
            </span>
          </div>
          <h1 className="mb-4 font-serif text-4xl font-bold tracking-tight text-text-primary md:text-5xl">
            Event Gallery
          </h1>
          <p className="max-w-2xl text-lg leading-relaxed text-text-primary/60">
            Moments captured at our events. Every photo tells a story of connection, culture, and unforgettable experiences.
          </p>
        </div>
      </section>

      <GalleryClient
        photos={photos}
        events={events}
        initialEventSlug={eventSlug}
      />

      <InstagramFollowSection variant="banner" />
    </main>
  )
}
