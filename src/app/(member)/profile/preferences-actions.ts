'use server'

/**
 * Email-preference management Server Actions.
 *
 * Complement to the public one-click /unsubscribe flow — signed-in
 * users can flip preferences from the profile page without waiting for
 * an email with a token. RLS policies on `notification_preferences`
 * already restrict update to the row owner, so we use the user's
 * authenticated client (not the admin client) — authorisation is
 * enforced at the DB layer.
 */

import { createServerClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { NotificationCategory } from '@/lib/email/unsubscribe-token'

export interface EmailPreferences {
  review_requests: boolean
  profile_nudges: boolean
  admin_announcements: boolean
}

export async function getMyEmailPreferences(): Promise<EmailPreferences | null> {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data, error } = await supabase
    .from('notification_preferences')
    .select('review_requests, profile_nudges, admin_announcements')
    .eq('user_id', user.id)
    .maybeSingle()

  if (error || !data) {
    // Row may not exist yet for very old profiles pre-backfill.
    // Default to all-on to match table defaults and the trigger behaviour.
    return {
      review_requests: true,
      profile_nudges: true,
      admin_announcements: true,
    }
  }
  return data as EmailPreferences
}

export type UpdatePreferenceResult =
  | { success: true }
  | { success: false; error: string }

export async function updateEmailPreference(
  category: NotificationCategory,
  value: boolean,
): Promise<UpdatePreferenceResult> {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Not signed in' }

  // Upsert so the flow still works for profiles that somehow missed the
  // insert trigger (backfills, edge cases). RLS policy on UPDATE
  // enforces auth.uid() = user_id.
  const { error } = await supabase
    .from('notification_preferences')
    .upsert(
      { user_id: user.id, [category]: value },
      { onConflict: 'user_id' },
    )

  if (error) {
    console.error(
      '[preferences] update failed:',
      error.message,
    )
    return { success: false, error: 'Could not save your preference.' }
  }

  revalidatePath('/profile')
  return { success: true }
}
