/**
 * Event-sharing helpers. Centralises the share URL building and the
 * native-share / clipboard fallback that multiple components need.
 *
 * Client-side only — these helpers touch `window`, `navigator`, and
 * `document`. Call from inside event handlers or `useEffect`.
 */

/**
 * Absolute URL for a public event, suitable for pasting into WhatsApp,
 * email, or any chat client. Uses `window.location.origin` so dev/preview
 * deploys produce working links for their own domain.
 */
export function buildEventShareUrl(slug: string): string {
  if (typeof window === 'undefined') {
    // Server-side fallback — callers should avoid this path, but we
    // return something parseable rather than throwing.
    return `/events/${slug}`
  }
  return `${window.location.origin}/events/${slug}`
}

/**
 * WhatsApp deep link that pre-fills a compose window with the event
 * title and URL. `wa.me` works cross-platform (opens the WhatsApp app on
 * mobile, WhatsApp Web on desktop with a fallback to the install page).
 */
export function buildWhatsappShareUrl(title: string, shareUrl: string): string {
  const message = `Join me at ${title}: ${shareUrl}`
  return `https://wa.me/?text=${encodeURIComponent(message)}`
}

export type ShareOutcome = 'shared' | 'copied' | 'cancelled' | 'unsupported'

/**
 * Attempt native Web Share, fall back to clipboard copy. Returns which
 * path succeeded so the caller can surface the right toast ("Shared!" vs
 * "Link copied"). Never throws — a denied permission or a user cancel
 * is reported via the return value, not an exception.
 */
export async function nativeShareOrCopy(args: {
  title: string
  text?: string
  url: string
}): Promise<ShareOutcome> {
  if (typeof navigator === 'undefined') return 'unsupported'

  // Feature-detect. Some browsers expose `share` only in secure contexts
  // — failures are handled by the try/catch below.
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({
        title: args.title,
        text: args.text,
        url: args.url,
      })
      return 'shared'
    } catch (err) {
      // AbortError is fired when the user dismisses the share sheet.
      if (err instanceof DOMException && err.name === 'AbortError') {
        return 'cancelled'
      }
      // Fall through to clipboard fallback for any other error
      // (e.g. NotAllowedError on non-secure contexts).
    }
  }

  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(args.url)
      return 'copied'
    } catch {
      return 'unsupported'
    }
  }

  return 'unsupported'
}
