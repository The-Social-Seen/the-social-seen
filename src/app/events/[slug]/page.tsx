import { notFound } from "next/navigation";
import {
  getEventBySlug,
  getEventReviews,
  getEventPhotos,
  getRelatedEvents,
  getUserBookingForEvent,
} from "@/lib/supabase/queries/events";
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
    title: `${event.title} | The Social Seen`,
    description: event.short_description,
    openGraph: {
      title: event.title,
      description: event.short_description,
      ...(ogImage ? { images: [{ url: ogImage }] } : {}),
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

  // Fetch additional data in parallel (Amendment 3.5)
  const [reviews, photos, relatedEvents, userBooking] = await Promise.all([
    isPast ? getEventReviews(event.id) : Promise.resolve([] as ReviewWithAuthor[]),
    isPast ? getEventPhotos(event.id) : Promise.resolve([] as EventPhoto[]),
    getRelatedEvents(event.category, event.id),
    getUserBookingForEvent(event.id),
  ]);

  return (
    <EventDetailClient
      event={event}
      reviews={reviews}
      photos={photos}
      relatedEvents={relatedEvents}
      userBooking={userBooking}
    />
  );
}
