import { notFound } from "next/navigation";
import {
  getEventBySlug,
  getEventReviews,
  getEventPhotos,
  getRelatedEvents,
  getUserBookingForEvent,
} from "@/lib/supabase/queries/events";
import { createServerClient } from "@/lib/supabase/server";
import { isPastEvent } from "@/lib/utils/dates";
import { resolveEventImage } from "@/lib/utils/images";
import EventDetailClient from "@/components/events/EventDetailClient";
import type { Metadata } from "next";
import type { ReviewWithAuthor, EventPhoto } from "@/types";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const event = await getEventBySlug(slug);

  if (!event) {
    return {
      title: "Event Not Found | The Social Seen",
    };
  }

  const ogImage = resolveEventImage(event.image_url);

  return {
    title: `${event.title} — The Social Seen`,
    description: event.short_description,
    openGraph: {
      type: "website",
      title: event.title,
      description: event.short_description,
      ...(ogImage
        ? { images: [{ url: ogImage, width: 1200, height: 630, alt: event.title }] }
        : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: event.title,
      description: event.short_description,
      ...(ogImage ? { images: [ogImage] } : {}),
    },
  };
}

export default async function EventDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const event = await getEventBySlug(slug);

  if (!event) {
    notFound();
  }

  const isPast = isPastEvent(event.date_time);

  // Fetch auth state + additional data in parallel (Amendment 3.5)
  const supabase = await createServerClient();
  const [{ data: { user } }, reviews, photos, relatedEvents, userBooking] =
    await Promise.all([
      supabase.auth.getUser(),
      isPast ? getEventReviews(event.id) : Promise.resolve([] as ReviewWithAuthor[]),
      isPast ? getEventPhotos(event.id) : Promise.resolve([] as EventPhoto[]),
      getRelatedEvents(event.category, event.id),
      getUserBookingForEvent(event.id),
    ]);

  // Get user profile info for review form + email verification gate
  let userName: string | null = null
  let userAvatar: string | null = null
  let emailVerified = false
  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name, avatar_url, email_verified')
      .eq('id', user.id)
      .single()
    userName = profile?.full_name ?? (user.user_metadata?.full_name as string) ?? null
    userAvatar = profile?.avatar_url ?? null
    emailVerified = profile?.email_verified ?? false
  }

  const ogImage = resolveEventImage(event.image_url);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Event",
    name: event.title,
    description: event.short_description,
    startDate: event.date_time,
    endDate: event.end_time,
    eventStatus: "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    location: {
      "@type": "Place",
      name: event.venue_name,
      address: {
        "@type": "PostalAddress",
        streetAddress: event.venue_address,
        addressLocality: "London",
        addressCountry: "GB",
      },
    },
    organizer: {
      "@type": "Organization",
      name: "The Social Seen",
      url: "https://thesocialseen.com",
    },
    offers: {
      "@type": "Offer",
      price: event.price,
      priceCurrency: "GBP",
      availability:
        event.capacity === null || (event.spots_left ?? 1) > 0
          ? "https://schema.org/InStock"
          : "https://schema.org/SoldOut",
      url: `https://thesocialseen.com/events/${event.slug}`,
    },
    ...(ogImage ? { image: ogImage } : {}),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <EventDetailClient
        event={event}
        reviews={reviews}
        photos={photos}
        relatedEvents={relatedEvents}
        userBooking={userBooking}
        isLoggedIn={!!user}
        userName={userName}
        userAvatar={userAvatar}
        userId={user?.id ?? null}
        emailVerified={emailVerified}
      />
    </>
  );
}
