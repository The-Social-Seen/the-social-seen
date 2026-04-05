import { createServerClient } from '@/lib/supabase/server'
import type { EventPhoto } from '@/types'

// ── Gallery photo with event context ─────────────────────────────────────────

export interface GalleryPhotoWithEvent extends EventPhoto {
  event: { title: string; slug: string }
}

// ── All gallery photos ───────────────────────────────────────────────────────

/**
 * Fetch all photos across events, with the parent event's title and slug.
 * Ordered by created_at DESC (newest first).
 * Only includes photos from published, non-cancelled, non-deleted events.
 */
export async function getAllGalleryPhotos(): Promise<GalleryPhotoWithEvent[]> {
  const supabase = await createServerClient()

  const { data, error } = await supabase
    .from('event_photos')
    .select(`
      id, event_id, image_url, caption, sort_order, created_at,
      event:events!inner(title, slug)
    `)
    .eq('event.is_published', true)
    .eq('event.is_cancelled', false)
    .is('event.deleted_at', null)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[getAllGalleryPhotos]', error.message)
    return []
  }

  return (data ?? []).map((row) => ({
    ...row,
    event: Array.isArray(row.event) ? row.event[0] : row.event,
  })) as GalleryPhotoWithEvent[]
}

// ── Events that have photos (for filter bar) ─────────────────────────────────

export interface GalleryEvent {
  id: string
  title: string
  slug: string
}

/**
 * Fetch distinct events that have at least one photo.
 * Used for the gallery filter bar.
 */
export async function getGalleryEvents(): Promise<GalleryEvent[]> {
  const supabase = await createServerClient()

  // Query events that have photos via inner join
  const { data, error } = await supabase
    .from('events')
    .select(`
      id, title, slug,
      event_photos!inner(id)
    `)
    .eq('is_published', true)
    .eq('is_cancelled', false)
    .is('deleted_at', null)
    .order('date_time', { ascending: false })

  if (error) {
    console.error('[getGalleryEvents]', error.message)
    return []
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    slug: row.slug,
  }))
}
