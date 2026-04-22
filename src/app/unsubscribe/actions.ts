'use server'

/**
 * Unsubscribe flow (Phase 2.5 Batch 2).
 *
 * TWO-STEP pattern — GET renders a preview page with a confirmation
 * button; POST actually flips the preference. Email security scanners
 * (Outlook ATP / Safe Links, Proofpoint URL Defense, Mimecast, Gmail
 * image proxies, etc.) routinely prefetch every link in an email to
 * detonate potential phishing. A single-GET pattern would let those
 * scanners silently unsubscribe users without human interaction. The
 * confirmation form requires an explicit human POST, which link
 * scanners don't generate.
 *
 * The token is HMAC-signed + age-gated (see unsubscribe-token.ts) and
 * passed through as a hidden input on the confirmation form — no CSRF
 * concern beyond what the signature already solves.
 *
 * Flow:
 *   1. previewUnsubscribe(token) — token-verify only, no DB writes.
 *      Called from the GET render so we can tell the user what
 *      category they're about to unsubscribe from.
 *   2. confirmUnsubscribe(token) — actually flips the preference.
 *      Called from the POST submit of the confirmation form.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import {
  verifyUnsubscribeToken,
  CATEGORY_LABELS,
  type NotificationCategory,
} from '@/lib/email/unsubscribe-token'

export type UnsubscribePreview =
  | {
      ok: true
      category: NotificationCategory
      categoryLabel: string
    }
  | {
      ok: false
      message: string
    }

export type UnsubscribeResult =
  | {
      success: true
      category: NotificationCategory
      categoryLabel: string
    }
  | {
      success: false
      reason:
        | 'invalid_token'
        | 'user_not_found'
        | 'database_error'
      message: string
    }

// Map each category to the column on notification_preferences.
// Keep this close to the mutation to survive column renames.
const CATEGORY_TO_COLUMN: Record<NotificationCategory, string> = {
  review_requests: 'review_requests',
  profile_nudges: 'profile_nudges',
  admin_announcements: 'admin_announcements',
}

/**
 * Verify the token WITHOUT mutating. Safe to call from a GET render.
 * The page uses this to render the category label in the confirmation
 * prompt before the user clicks.
 */
export async function previewUnsubscribe(
  token: string,
): Promise<UnsubscribePreview> {
  const verified = verifyUnsubscribeToken(token)
  if (!verified.ok) {
    return {
      ok: false,
      message:
        'This unsubscribe link is invalid or has expired. Please use a more recent email, or sign in and update preferences on your profile page.',
    }
  }
  return {
    ok: true,
    category: verified.value.category,
    categoryLabel: CATEGORY_LABELS[verified.value.category],
  }
}

/**
 * Flip the preference. Only called from a POST submit — never from
 * a GET render. Email scanners don't issue POSTs; a human click does.
 */
export async function confirmUnsubscribe(
  token: string,
): Promise<UnsubscribeResult> {
  const verified = verifyUnsubscribeToken(token)
  if (!verified.ok) {
    return {
      success: false,
      reason: 'invalid_token',
      message:
        'This unsubscribe link is invalid or has expired. Please use a more recent email, or sign in and update preferences on your profile page.',
    }
  }

  const { userId, category } = verified.value
  const column = CATEGORY_TO_COLUMN[category]
  const admin = createAdminClient()

  // Confirm the profile still exists (and isn't soft-deleted).
  const { data: profile, error: profileErr } = await admin
    .from('profiles')
    .select('id, deleted_at')
    .eq('id', userId)
    .maybeSingle()

  if (profileErr) {
    console.warn('[unsubscribe] profile lookup failed:', profileErr.message)
    return {
      success: false,
      reason: 'database_error',
      message: 'Something went wrong. Please try again shortly.',
    }
  }

  if (!profile || profile.deleted_at) {
    // The account is gone / in the deletion queue. Treat as success —
    // no further emails will go out anyway, and revealing account state
    // to an unauthenticated caller is a minor info leak.
    return {
      success: true,
      category,
      categoryLabel: CATEGORY_LABELS[category],
    }
  }

  // Upsert — preference row is normally created by trigger on profile
  // insert, but falling through to an upsert keeps the flow resilient
  // if the trigger ever gets disabled or if a backfill misses a row.
  const { error: upsertErr } = await admin
    .from('notification_preferences')
    .upsert(
      {
        user_id: userId,
        [column]: false,
      },
      { onConflict: 'user_id' },
    )

  if (upsertErr) {
    console.error(
      '[unsubscribe] preference update failed:',
      upsertErr.message,
    )
    return {
      success: false,
      reason: 'database_error',
      message: 'Could not save your preference. Please try again shortly.',
    }
  }

  return {
    success: true,
    category,
    categoryLabel: CATEGORY_LABELS[category],
  }
}
