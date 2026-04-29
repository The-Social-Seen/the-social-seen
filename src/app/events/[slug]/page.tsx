import { notFound } from "next/navigation";
import {
  getEventBySlug,
  getEventReviews,
  // 2026-04-29: getEventPhotos retained in the query module but not
  // imported here while the per-event gallery is hidden. Restore this
  // import + the call site at line ~77 when the upload UI ships — see
  // memory/project_event_gallery_hidden.md.
  // getEventPhotos,
  getRelatedEvents,
  getUserBookingForEvent,
} from "@/lib/supabase/queries/events";
import { createServerClient } from "@/lib/supabase/server";
import { isPastEvent } from "@/lib/utils/dates";
import { resolveEventImage } from "@/lib/utils/images";
import { canonicalUrl } from "@/lib/utils/site";
import EventDetailClient from "@/components/events/EventDetailClient";
import { JsonLd } from "@/components/seo/JsonLd";
import { eventJsonLd } from "@/lib/seo/event";
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
    alternates: {
      canonical: canonicalUrl(`/events/${event.slug}`),
    },
    openGraph: {
      type: "website",
      url: canonicalUrl(`/events/${event.slug}`),
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
      // 2026-04-29: per-event gallery hidden until upload UI ships.
      // The render gate (`hasGallery = photos.length > 0`) inside
      // EventDetailClient does the actual hiding when this is empty.
      // See memory/project_event_gallery_hidden.md for the full plan.
      Promise.resolve([] as EventPhoto[]),
      getRelatedEvents(event.primary_tag.slug, event.id),
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

  // resolveEventImage is still called inside the helper for the
  // JSON-LD `image` field; no need to pre-compute here.

  return (
    <>
      <JsonLd data={eventJsonLd(event)} />
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
