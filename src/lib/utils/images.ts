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
 * Hosts allowed through `next/image`. Must stay in sync with
 * `next.config.ts` `images.remotePatterns`. If a seeded or admin-entered
 * `image_url` points to a host not on this list, `next/image` would throw
 * a runtime error — the `<GlobalError>` boundary would then replace the
 * whole page. The resolve helpers below return `null` for disallowed
 * hosts so the UI falls back to the placeholder instead.
 *
 * Entries are either a literal hostname or a `*.suffix` wildcard.
 *
 * Reason this lives here and not imported from `next.config.ts`: the Next
 * config is not easily consumable at runtime (it's transformed by the
 * Next build), and this file runs on both server and client.
 */
const ALLOWED_IMAGE_HOSTS: ReadonlyArray<string> = [
  'images.unsplash.com',
  '*.supabase.co',
]

export function isAllowedImageHost(url: string): boolean {
  try {
    const parsed = new URL(url)
    // next/image remotePatterns defaults to https-only. Any http:// URL
    // would pass this hostname check but be rejected by next/image at
    // render time — a different failure mode than this module addresses
    // but still broken. Reject at the allowlist layer so callers fall
    // through to the placeholder consistently.
    if (parsed.protocol !== 'https:') return false
    const { hostname } = parsed
    return ALLOWED_IMAGE_HOSTS.some((pattern) => {
      if (pattern.startsWith('*.')) {
        // "*.supabase.co" matches "foo.supabase.co" but NOT "supabase.co"
        // itself (consistent with next/image wildcard semantics).
        const suffix = pattern.slice(1) // ".supabase.co"
        return hostname.endsWith(suffix) && hostname.length > suffix.length
      }
      return hostname === pattern
    })
  } catch {
    // Malformed URL — treat as not allowed so the caller falls back.
    return false
  }
}

/**
 * Resolve an event image_url to a display-ready URL.
 * - null/undefined → null (caller renders a placeholder)
 * - External URL on an allowed host → returned as-is
 * - External URL on a disallowed host → null (prevents next/image crash)
 * - Storage path → prefixed with the Supabase Storage public URL
 */
export function resolveEventImage(path: string | null | undefined): string | null {
  if (!path) return null
  if (isAbsoluteUrl(path)) {
    return isAllowedImageHost(path) ? path : null
  }
  return storageUrl(STORAGE_BUCKETS.eventImages, path)
}

/**
 * Resolve a profile avatar_url.
 * Returns null when no avatar is set — the UI should fall back to initials.
 * Same disallowed-host fallback as resolveEventImage.
 */
export function resolveAvatarUrl(path: string | null | undefined): string | null {
  if (!path) return null
  if (isAbsoluteUrl(path)) {
    return isAllowedImageHost(path) ? path : null
  }
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
  if (isAbsoluteUrl(path)) {
    return isAllowedImageHost(path) ? path : null
  }
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
