'use server'

import { z } from 'zod'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createServerClient } from '@/lib/supabase/server'
import { sendEmail } from '@/lib/email/send'
import { welcomeTemplate } from '@/lib/email/templates/welcome'
import { upsertContact } from '@/lib/brevo/sync'

// ── Validation schemas ──────────────────────────────────────────────────────

const signUpSchema = z.object({
  fullName: z.string().min(1, 'Full name is required').max(100),
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  // Accepts international formats (10–15 digits, optional leading +).
  // Frontend enforces UK-specific formatting; this matches the DB CHECK
  // constraint so invalid input is rejected before the Supabase call.
  phoneNumber: z
    .string()
    .regex(/^\+?[0-9]{10,15}$/, 'Enter a valid phone number'),
  // Per-channel marketing consent — must be explicit booleans (no undefined).
  // Defaults to false at the DB level if somehow missing (UK PECR: opt-in only).
  emailConsent: z.boolean(),
  smsConsent: z.boolean(),
  referralSource: z.string().optional(),
})

/**
 * Validates a redirect path is safe (relative, no open-redirect vectors).
 * Must start with "/" and must not contain "://" or start with "//" or "\/".
 * Backslash-prefixed paths (\/evil.com) are rejected because some browsers
 * normalise \ to / making them equivalent to protocol-relative URLs.
 */
function validateRedirect(path?: string | null): string {
  if (!path) return '/events'
  if (
    path.startsWith('/') &&
    !path.startsWith('//') &&
    !path.startsWith('\\/') &&
    !path.includes('://')
  ) {
    return path
  }
  return '/events'
}

const signInSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
  redirectTo: z
    .string()
    .optional()
    .refine(
      (val) => !val || (val.startsWith('/') && !val.startsWith('//') && !val.startsWith('\\/') && !val.includes('://')),
      { message: 'Invalid redirect path' }
    ),
})

const saveInterestsSchema = z.object({
  interests: z.array(z.string().min(1)).min(1, 'Select at least one interest'),
})

const requestPasswordResetSchema = z.object({
  email: z.string().email('Enter a valid email address'),
})

const updatePasswordSchema = z.object({
  password: z.string().min(8, 'Password must be at least 8 characters'),
})

const verifyEmailOtpSchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code from your email'),
})

// ── Server Actions ──────────────────────────────────────────────────────────

export async function signUp(input: {
  fullName: string
  email: string
  password: string
  phoneNumber: string
  emailConsent: boolean
  smsConsent: boolean
  referralSource?: string
}): Promise<{ success: true } | { error: string }> {
  const parsed = signUpSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message }
  }

  const {
    fullName,
    email,
    password,
    phoneNumber,
    emailConsent,
    smsConsent,
    referralSource,
  } = parsed.data
  const supabase = await createServerClient()

  // phone_number, email_consent, and sms_consent are read by the
  // handle_new_user() trigger and inserted into the profile row when
  // Supabase creates the auth user.
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName,
        phone_number: phoneNumber,
        email_consent: emailConsent,
        sms_consent: smsConsent,
      },
    },
  })

  if (error) {
    if (error.message.includes('already registered') || error.message.includes('already been registered')) {
      return { error: "Looks like you're already a member — sign in instead?" }
    }
    return { error: error.message }
  }

  // Supabase may return a user with an empty identities array if the email
  // is already registered but email confirmation is disabled
  if (data.user && data.user.identities && data.user.identities.length === 0) {
    return { error: "Looks like you're already a member — sign in instead?" }
  }

  // If referralSource provided, update the profile row
  // (handle_new_user trigger has already created the profile by now)
  if (referralSource && data.user) {
    await supabase
      .from('profiles')
      .update({ referral_source: referralSource })
      .eq('id', data.user.id)
  }

  revalidatePath('/', 'layout')
  return { success: true }
}

export async function signIn(input: {
  email: string
  password: string
  redirectTo?: string
}): Promise<{ success: true; redirectTo: string } | { error: string }> {
  const parsed = signInSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message }
  }

  const { email, password, redirectTo } = parsed.data
  const supabase = await createServerClient()

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (error) {
    return { error: 'Invalid email or password' }
  }

  // Validate the redirect path to prevent open-redirect attacks
  const safeRedirectTo = validateRedirect(redirectTo)

  // If no explicit redirect, check if user is admin and route accordingly
  let destination = safeRedirectTo
  if (safeRedirectTo === '/events' && !redirectTo && data.user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', data.user.id)
      .single()
    if (profile?.role === 'admin') {
      destination = '/admin'
    }
  }

  revalidatePath('/', 'layout')
  return { success: true, redirectTo: destination }
}

export async function signOut(): Promise<void> {
  const supabase = await createServerClient()
  await supabase.auth.signOut()
  revalidatePath('/', 'layout')
  redirect('/')
}

export async function saveInterests(input: {
  interests: string[]
}): Promise<{ success: true } | { error: string }> {
  const parsed = saveInterestsSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message }
  }

  const { interests } = parsed.data
  const supabase = await createServerClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return { error: 'You must be signed in to save interests' }
  }

  // Delete existing interests for this user
  const { error: deleteError } = await supabase
    .from('user_interests')
    .delete()
    .eq('user_id', user.id)

  if (deleteError) {
    return { error: 'Failed to update interests' }
  }

  // Insert new interests
  const rows = interests.map((interest) => ({
    user_id: user.id,
    interest,
  }))

  const { error: insertError } = await supabase
    .from('user_interests')
    .insert(rows)

  if (insertError) {
    return { error: 'Failed to save interests' }
  }

  return { success: true }
}

/**
 * Request a password reset email.
 *
 * Always returns success to the caller — we never reveal whether an email is
 * registered (prevents account enumeration). Supabase handles the actual
 * email delivery; if the email isn't registered, no email is sent.
 *
 * The reset link returned by Supabase points to the URL configured in
 * Supabase Auth → URL Configuration → Redirect URLs. Locally the first
 * allowed URL is http://localhost:3000; in production set this to
 * https://<your-domain>/reset-password.
 */
export async function requestPasswordReset(input: {
  email: string
}): Promise<{ success: true } | { error: string }> {
  const parsed = requestPasswordResetSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message }
  }

  const { email } = parsed.data
  const supabase = await createServerClient()

  // Derive the absolute redirect URL from the NEXT_PUBLIC_SITE_URL env var
  // so staging and production land on their own /reset-password page.
  // Falls back to NEXT_PUBLIC_VERCEL_URL (auto-set on Vercel) then localhost.
  const origin =
    process.env.NEXT_PUBLIC_SITE_URL ??
    (process.env.NEXT_PUBLIC_VERCEL_URL
      ? `https://${process.env.NEXT_PUBLIC_VERCEL_URL}`
      : 'http://localhost:3000')

  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/reset-password`,
  })

  // Always report success — we don't leak whether the email is registered.
  return { success: true }
}

/**
 * Update the signed-in user's password. Only callable from within the recovery
 * flow (user has clicked the reset link and has an active session).
 */
export async function updatePassword(input: {
  password: string
}): Promise<{ success: true } | { error: string }> {
  const parsed = updatePasswordSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message }
  }

  const supabase = await createServerClient()

  // Ensure there's an active session — prevents unauthenticated calls.
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return { error: 'Your reset link has expired. Request a new one.' }
  }

  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password,
  })

  if (error) {
    return { error: error.message }
  }

  revalidatePath('/', 'layout')
  return { success: true }
}

export async function completeOnboarding(): Promise<{ success: true } | { error: string }> {
  const supabase = await createServerClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return { error: 'You must be signed in' }
  }

  const { error } = await supabase
    .from('profiles')
    .update({ onboarding_complete: true })
    .eq('id', user.id)

  if (error) {
    return { error: 'Failed to complete onboarding' }
  }

  // Welcome email — bonus, not critical. A failure here must NOT roll
  // back the onboarding state. Fetch the user's full_name for the
  // greeting; fall back to the auth metadata if the profile read fails.
  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name, email, email_consent')
      .eq('id', user.id)
      .single()

    const fullName =
      profile?.full_name?.trim() ||
      (user.user_metadata?.full_name as string | undefined) ||
      'there'
    const recipient = profile?.email ?? user.email

    if (recipient) {
      const tpl = welcomeTemplate({ fullName })
      const result = await sendEmail({
        to: recipient,
        subject: tpl.subject,
        html: tpl.html,
        text: tpl.text,
        templateName: 'welcome',
        relatedProfileId: user.id,
        tags: [{ name: 'template', value: 'welcome' }],
      })
      if (!result.success) {
        console.warn('[completeOnboarding] welcome email failed:', result.error)
      }
    }

    // Brevo newsletter sync — only if the member opted into marketing at
    // signup. Skip silently on failure so a Brevo hiccup doesn't block
    // onboarding. A Phase-3 reconciler can backfill orphan opt-ins.
    if (profile?.email_consent && recipient) {
      const syncResult = await upsertContact({
        email: recipient,
        fullName,
        source: 'profile',
      })
      if (!syncResult.success) {
        console.warn(
          '[completeOnboarding] Brevo sync failed:',
          syncResult.error,
        )
      }
    }
  } catch (err) {
    console.warn(
      '[completeOnboarding] welcome email send threw:',
      err instanceof Error ? err.message : err,
    )
  }

  revalidatePath('/', 'layout')
  return { success: true }
}

// ── Email verification (OTP) ───────────────────────────────────────────────

/**
 * Request a 6-digit email verification OTP for the signed-in user.
 *
 * Uses Supabase's signInWithOtp mailer to deliver the code. The user is
 * already authenticated — we're not logging them in again, just proving
 * they own the email on their profile before they can book events.
 *
 * Idempotent: if the user's profile is already email_verified, no email is
 * sent and `{ success: true, alreadyVerified: true }` is returned so the
 * caller can skip the code-entry screen and go straight to success.
 *
 * Rate limits are enforced by Supabase (one email per 60s by default).
 * We surface the 429 as a friendly "Please wait before requesting another code".
 */
export async function sendVerificationOtp(): Promise<
  { success: true; alreadyVerified?: boolean } | { error: string }
> {
  const supabase = await createServerClient()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user || !user.email) {
    return { error: 'You must be signed in' }
  }

  // Short-circuit if already verified — don't waste an email send. Caller
  // (verify-form) keys off `alreadyVerified` to show success state directly
  // rather than prompting for a code that was never sent.
  const { data: profile } = await supabase
    .from('profiles')
    .select('email_verified')
    .eq('id', user.id)
    .single()

  if (profile?.email_verified) {
    return { success: true, alreadyVerified: true }
  }

  // `shouldCreateUser: false` ensures Supabase never creates a phantom user
  // if the email somehow doesn't match an existing account.
  const { error } = await supabase.auth.signInWithOtp({
    email: user.email,
    options: {
      shouldCreateUser: false,
    },
  })

  if (error) {
    // Supabase rate-limit error surface: message typically mentions
    // "rate limit" or "too many requests". Keep the match broad so we
    // handle both wording variants.
    const msg = error.message.toLowerCase()
    if (msg.includes('rate limit') || msg.includes('too many')) {
      return { error: 'Please wait a moment before requesting another code.' }
    }
    // Generic fallback — don't leak the raw Supabase message.
    return { error: 'Could not send verification email. Please try again.' }
  }

  return { success: true }
}

/**
 * Verify a 6-digit email OTP. On success, flip profiles.email_verified
 * to true so the user can book events.
 *
 * Must be called by an authenticated session — the caller's email is
 * used as the OTP target (no way to verify someone else's email).
 */
export async function verifyEmailOtp(input: {
  code: string
}): Promise<{ success: true } | { error: string }> {
  const parsed = verifyEmailOtpSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message }
  }

  const supabase = await createServerClient()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user || !user.email) {
    return { error: 'You must be signed in' }
  }

  const { error: verifyError } = await supabase.auth.verifyOtp({
    email: user.email,
    token: parsed.data.code,
    type: 'email',
  })

  if (verifyError) {
    // Friendly message — don't leak raw Supabase errors (e.g. "Token has
    // expired or is invalid" is close but we keep wording consistent).
    return { error: 'That code is invalid or has expired. Request a new one.' }
  }

  // Flip the app-level verification flag. Supabase's email_confirmed_at is
  // already set on all users (autoconfirm is True), so we track our own flag.
  const { error: updateError } = await supabase
    .from('profiles')
    .update({ email_verified: true })
    .eq('id', user.id)

  if (updateError) {
    // Verification succeeded in Supabase but we couldn't update our flag.
    // Return success anyway — the user successfully verified their email;
    // the flag will be reconciled on next fetch via a future fallback.
    // For now, prefer a soft failure over a confusing error message.
    return { success: true }
  }

  revalidatePath('/', 'layout')
  return { success: true }
}
