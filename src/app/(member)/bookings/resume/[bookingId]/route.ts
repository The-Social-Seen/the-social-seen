import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { resumePendingBookingCheckout } from '@/lib/bookings/resume-checkout'

/**
 * `GET /bookings/resume/[bookingId]` — the abandoned-checkout reminder
 * email's CTA link (SYSTEM-DESIGN-pending-payment-visibility.md §5.3).
 * One click from the email mints a brand-new Stripe Checkout Session and
 * redirects the member straight to it — see `resumePendingBookingCheckout`
 * (src/lib/bookings/resume-checkout.ts) for the full algorithm; this
 * route is a thin auth + redirect wrapper, same shape as the
 * `resumePendingCheckout` Server Action
 * (src/app/(member)/bookings/actions.ts) that the "Complete Payment"
 * button on /bookings calls — both share this one implementation.
 *
 * Unauthenticated → redirect to `/login?redirect=/bookings/resume/{id}`.
 * The `redirect` query param (NOT `next` — verified against the existing
 * login flow, see src/app/(auth)/login/login-form.tsx +
 * src/lib/utils/redirect.ts's `sanitizeRedirectPath`, and the identical
 * pattern already used by booking-success/page.tsx and
 * cancellation-confirmed/page.tsx) is honoured by the login form and
 * carried through to `/join` too if the member registers instead of
 * signing in.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ bookingId: string }> },
): Promise<Response> {
  const { bookingId } = await params

  const supabase = await createServerClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.redirect(
      new URL(`/login?redirect=${encodeURIComponent(`/bookings/resume/${bookingId}`)}`, _req.url),
    )
  }

  const result = await resumePendingBookingCheckout(supabase, user.id, bookingId)

  if (result.success && result.checkoutUrl) {
    return NextResponse.redirect(result.checkoutUrl)
  }

  return NextResponse.redirect(
    new URL(
      `/bookings?resumeError=${encodeURIComponent(result.error ?? 'Something went wrong. Please try again.')}`,
      _req.url,
    ),
  )
}
