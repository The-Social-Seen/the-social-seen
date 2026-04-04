import { STORAGE_BUCKETS } from '@/lib/constants'

// ── Image URL resolution ──────────────────────────────────────────────────────
// Per ADR-11: image_url fields store either:
//   a) An external absolute URL (e.g. Unsplash seed data)
//   b) A Supabase Storage object path (e.g. "events/abc123.jpg")
//
// This module resolves both forms to a fully-qualified URL for use in <Image>.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''

function storageUrl(bucket: string, path: string): string {
  return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`
}

function isAbsoluteUrl(value: string): boolean {
  return value.startsWith('http://') || value.startsWith('https://')
}

/**
 * Resolve an event image_url to a display-ready URL.
 * - null/undefined → null (caller renders a placeholder)
 * - External URL  → returned as-is
 * - Storage path  → prefixed with the Supabase Storage public URL
 */
export function resolveEventImage(path: string | null | undefined): string | null {
  if (!path) return null
  if (isAbsoluteUrl(path)) return path
  return storageUrl(STORAGE_BUCKETS.eventImages, path)
}

/**
 * Resolve a profile avatar_url.
 * Returns null when no avatar is set — the UI should fall back to initials.
 */
export function resolveAvatarUrl(path: string | null | undefined): string | null {
  if (!path) return null
  if (isAbsoluteUrl(path)) return path
  return storageUrl(STORAGE_BUCKETS.avatars, path)
}

/**
 * Generic resolver for any Supabase Storage bucket.
 * Use resolveEventImage / resolveAvatarUrl for the known buckets.
 */
export function resolveStorageUrl(
  path: string | null | undefined,
  bucket: string
): string | null {
  if (!path) return null
  if (isAbsoluteUrl(path)) return path
  return storageUrl(bucket, path)
}

/**
 * Generate initials from a full name — used as avatar fallback text.
 * "Charlotte Davis" → "CD" | "Priya" → "P"
 */
export function getInitials(fullName: string): string {
  return fullName
    .trim()
    .split(/\s+/)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .slice(0, 2)
    .join('')
}
