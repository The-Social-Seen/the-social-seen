'use server'

import { z } from 'zod'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createServerClient } from '@/lib/supabase/server'

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
  // Email marketing consent — must be an explicit boolean (no undefined).
  // Defaults to false at the DB level if somehow missing (GDPR: opt-in only).
  emailConsent: z.boolean(),
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

// ── Server Actions ──────────────────────────────────────────────────────────

export async function signUp(input: {
  fullName: string
  email: string
  password: string
  phoneNumber: string
  emailConsent: boolean
  referralSource?: string
}): Promise<{ success: true } | { error: string }> {
  const parsed = signUpSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message }
  }

  const { fullName, email, password, phoneNumber, emailConsent, referralSource } =
    parsed.data
  const supabase = await createServerClient()

  // phone_number and email_consent are read by the handle_new_user() trigger
  // and inserted into the profile row when Supabase creates the auth user.
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName,
        phone_number: phoneNumber,
        email_consent: emailConsent,
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

  revalidatePath('/', 'layout')
  return { success: true }
}
