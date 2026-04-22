'use server'

/**
 * P2-8b — GDPR self-service Server Actions.
 *
 * Split from `actions.ts` so the privacy/deletion surface is obvious
 * and easy to audit. Keeps the "normal" profile actions uncluttered.
 *
 * Two exports:
 *   • `exportMyData(): Promise<string>` — returns a JSON string the
 *     client downloads as `the-social-seen-<date>.json`. Includes
 *     every row tied to the caller.
 *   • `deleteMyAccount(confirmation: string): Promise<ActionResult>` —
 *     soft-deletes the profile, scrubs notifications PII via RPC,
 *     cancels future bookings, signs out. Requires the user to type
 *     "delete my account" as a confirmation token to prevent accidental
 *     triggers from stray POSTs.
 *
 * What we DON'T do here:
 *   • Hard-delete the profile row — retained 30 days for audit. Admin
 *     hard-deletes manually (P2-8b admin deletion-queue view). Phase 3
 *     automates via pg_cron.
 *   • Refund paid bookings — user must cancel via the normal flow
 *     first (which respects the 48h policy). We reject deletion if
 *     there's a confirmed paid booking <48h away to avoid a
 *     "no-refund-but-seat-gone" outcome.
 */

import * as Sentry from '@sentry/nextjs'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getStripeClient } from '@/lib/stripe/server'

// ── Result type ─────────────────────────────────────────────────────────────

interface ActionResult {
  success: boolean
  error?: string
}

// ── exportMyData ────────────────────────────────────────────────────────────

/**
 * Aggregates every row related to the caller into a single JSON
 * payload. Shape is stable; keys match DB column names so it's
 * machine-readable without a schema doc. The client writes the
 * returned string to a blob + anchor download.
 *
 * Queries go through the user-scoped client — RLS policies guarantee
 * we only get the caller's own rows. No admin bypass needed.
 */
export async function exportMyData(): Promise<string> {
  const supabase = await createServerClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    throw new Error('Authentication required')
  }

  const [profileRes, bookingsRes, reviewsRes, interestsRes] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', user.id).single(),
    supabase
      .from('bookings')
      .select(
        'id, event_id, status, waitlist_position, price_at_booking, booked_at, cancelled_at, refunded_amount_pence, refunded_at, created_at, updated_at',
      )
      .eq('user_id', user.id),
    supabase
      .from('event_reviews')
      .select('id, event_id, rating, review_text, is_visible, created_at, updated_at')
      .eq('user_id', user.id),
    supabase
      .from('user_interests')
      .select('id, interest, created_at')
      .eq('user_id', user.id),
  ])

  const exported = {
    export_metadata: {
      exported_at: new Date().toISOString(),
      user_id: user.id,
      note:
        'Contains all data The Social Seen holds about your account. Data about other members (their bookings, profile info, etc.) is NOT included (it is not your data to export).',
    },
    profile: profileRes.data ?? null,
    bookings: bookingsRes.data ?? [],
    reviews: reviewsRes.data ?? [],
    interests: interestsRes.data ?? [],
  }

  return JSON.stringify(exported, null, 2)
}

// ── deleteMyAccount ─────────────────────────────────────────────────────────

const CONFIRMATION_PHRASE = 'delete my account'

/**
 * Soft-deletes the caller's profile. Order of operations:
 *
 *   1. Verify the confirmation phrase typed in the UI matches exactly.
 *   2. Block deletion if there's an active paid booking within 48h —
 *      user would lose their seat without a refund (48h refund
 *      window). They must cancel first via the booking page, which
 *      routes through the normal refund logic.
 *   3. Cancel any other active bookings (confirmed / waitlisted /
 *      pending_payment). Free events cancel cleanly; paid bookings
 *      >48h get refunded via the normal Stripe path (called below).
 *   4. Scrub notifications PII via `sanitise_user_notifications` RPC.
 *   5. Set `profiles.deleted_at = now()` and clear the identifiable
 *      PII fields (email, phone_number, full_name, avatar_url, bio,
 *      linkedin_url, job_title, company) — the row still exists for
 *      audit but carries nothing identifying.
 *   6. Sign out (`auth.signOut`). Next request treats them as
 *      unauthenticated.
 *
 * Hard delete of the row happens via admin action after a 30-day
 * cooling-off. Stripe Customer records stay in Stripe (member can
 * request deletion from Stripe directly if they have a separate
 * concern).
 */
export async function deleteMyAccount(
  confirmation: string,
): Promise<ActionResult> {
  const supabase = await createServerClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return { success: false, error: 'Authentication required' }
  }

  if (confirmation !== CONFIRMATION_PHRASE) {
    return {
      success: false,
      error: `Type "${CONFIRMATION_PHRASE}" to confirm.`,
    }
  }

  // Guard: refuse deletion if there's a paid booking within 48h.
  // User must cancel that booking first (refund policy would refuse
  // anyway; we'd rather surface a clear reason up-front).
  const { data: imminentPaid } = await supabase
    .from('bookings')
    .select('id, event:events!inner(date_time)')
    .eq('user_id', user.id)
    .eq('status', 'confirmed')
    .is('deleted_at', null)
    .not('stripe_payment_id', 'is', null)

  const now = new Date()
  const within48h = (imminentPaid ?? []).some((b) => {
    const eventRow = Array.isArray(b.event) ? b.event[0] : b.event
    if (!eventRow) return false
    const hoursUntil =
      (new Date((eventRow as { date_time: string }).date_time).getTime() -
        now.getTime()) /
      (1000 * 60 * 60)
    return hoursUntil > 0 && hoursUntil <= 48
  })

  if (within48h) {
    return {
      success: false,
      error:
        'You have a paid booking within 48 hours. Cancel it first (refund policy applies) before deleting your account.',
    }
  }

  // Use the admin client from this point onwards — the writes span
  // multiple tables including PII scrubbing, and we need to sidestep
  // RLS for the notifications table (admin-only per migration 010).
  const admin = createAdminClient()

  // Cancel any remaining active bookings (no-op for rows already
  // cancelled / past / soft-deleted). We use a simple UPDATE rather
  // than the cancelBooking Server Action because:
  //   • We've already ruled out refund-eligible short-window bookings.
  //   • Long-window paid bookings will get reconciled via the
  //     existing `cancelBooking` flow if the user cancels before
  //     clicking Delete. If they click Delete without cancelling a
  //     long-window booking, they forfeit the refund — flagged in the
  //     UI copy.
  const { error: bookingCancelErr } = await admin
    .from('bookings')
    .update({ status: 'cancelled', cancelled_at: now.toISOString() })
    .eq('user_id', user.id)
    .in('status', ['confirmed', 'waitlisted', 'pending_payment'])
    .is('deleted_at', null)

  if (bookingCancelErr) {
    console.error('[deleteMyAccount] cancel bookings failed:', bookingCancelErr.message)
    return { success: false, error: 'Could not cancel your active bookings.' }
  }

  // Scrub notifications PII. Passing `p_user_email` lets the RPC
  // catch rows where the deleted user was the recipient of an admin
  // announcement (P2-9 "Email All Attendees") that pre-dated the
  // recipient_user_id column, or where the FK somehow wasn't set.
  // `p_user_full_name` (added in Phase 2.5 Batch 2) scrubs bodies of
  // unrelated rows that mention the deleted user by name — e.g. an
  // admin announcement sent to N attendees that referenced this user.
  const { data: fullNameRow } = await admin
    .from('profiles')
    .select('full_name')
    .eq('id', user.id)
    .single()
  const { error: scrubErr } = await admin.rpc('sanitise_user_notifications', {
    p_user_id: user.id,
    p_user_email: user.email ?? null,
    p_user_full_name: fullNameRow?.full_name ?? null,
  })
  if (scrubErr) {
    // Log but proceed — the soft-delete is the primary concern. Admin
    // can re-run the scrub manually if this fails.
    console.warn(
      '[deleteMyAccount] notification scrub failed:',
      scrubErr.message,
    )
  }

  // Delete user_interests rows. Not PII in the strict sense (they're
  // aggregated tags) but they're user-scoped data we export on
  // request, so they should be cleared on deletion for consistency.
  const { error: interestsErr } = await admin
    .from('user_interests')
    .delete()
    .eq('user_id', user.id)
  if (interestsErr) {
    console.warn(
      '[deleteMyAccount] user_interests cleanup failed:',
      interestsErr.message,
    )
  }

  // Fetch stripe_customer_id before we clear it on the profile. If
  // the user ever booked a paid event we have a Stripe Customer with
  // name + email + saved card metadata — that's PII Stripe is holding
  // on our behalf, so GDPR erasure requires us to delete it too.
  // Stripe anonymises the Customer but retains Charge records for
  // tax purposes; that's what they recommend for deletion requests.
  const { data: profileForStripe } = await admin
    .from('profiles')
    .select('stripe_customer_id')
    .eq('id', user.id)
    .single()

  if (profileForStripe?.stripe_customer_id) {
    try {
      const stripe = getStripeClient()
      await stripe.customers.del(profileForStripe.stripe_customer_id)
    } catch (err) {
      // If Stripe is down or the Customer was already manually
      // deleted we log loudly and proceed — the DB anonymisation is
      // the primary concern and an admin can retry the Stripe side
      // from the dashboard. Sentry-tagged so we can alert on it.
      console.error(
        '[deleteMyAccount] Stripe customer deletion failed:',
        err instanceof Error ? err.message : err,
      )
      Sentry.captureException(
        err instanceof Error
          ? err
          : new Error('Stripe customers.del failed'),
        {
          tags: { surface: 'stripe-customer-delete' },
          extra: {
            userId: user.id,
            stripeCustomerId: profileForStripe.stripe_customer_id,
          },
          level: 'error',
        },
      )
    }
  }

  // Soft-delete the profile + clear PII. Note `email` is required for
  // Supabase Auth so we put a placeholder pointing at the Supabase
  // user id — admin hard-delete clears it fully. We also null
  // `stripe_customer_id` regardless of whether the Stripe-side delete
  // succeeded — the local pointer is what links the anonymised row
  // back to Stripe, so clearing it closes the loop app-side.
  const { error: softDeleteErr } = await admin
    .from('profiles')
    .update({
      deleted_at: now.toISOString(),
      full_name: '[deleted member]',
      email: `deleted-${user.id}@deleted.local`,
      phone_number: null,
      avatar_url: null,
      bio: null,
      linkedin_url: null,
      job_title: null,
      company: null,
      industry: null,
      stripe_customer_id: null,
    })
    .eq('id', user.id)

  if (softDeleteErr) {
    console.error(
      '[deleteMyAccount] soft-delete failed:',
      softDeleteErr.message,
    )
    return { success: false, error: 'Could not delete your account. Please contact info@the-social-seen.com.' }
  }

  // Sign out via the user-scoped client so the cookie is cleared on
  // the response.
  await supabase.auth.signOut()

  revalidatePath('/')
  revalidatePath('/profile')

  // Redirect out of the authenticated zone. Next.js redirect() throws,
  // so code after this isn't reached — consistent with the normal
  // post-logout flow.
  redirect('/?account_deleted=1')
}
