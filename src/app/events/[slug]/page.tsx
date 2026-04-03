import { events } from "@/data/events";
import { notFound } from "next/navigation";
import EventDetailClient from "@/components/events/EventDetailClient";
import type { Metadata } from "next";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  return events.map((event) => ({
    slug: event.slug,
  }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const event = events.find((e) => e.slug === slug);

  if (!event) {
    return {
      title: "Event Not Found | The Social Seen",
    };
  }

  return {
    title: `${event.title} | The Social Seen`,
    description: event.shortDescription,
    openGraph: {
      title: event.title,
      description: event.shortDescription,
      images: [{ url: event.imageUrl }],
    },
  };
}

export default async function EventDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const event = events.find((e) => e.slug === slug);

  if (!event) {
    notFound();
  }

  return <EventDetailClient event={event} />;
}
