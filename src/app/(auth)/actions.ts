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
  referralSource: z.string().optional(),
})

const signInSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
  redirectTo: z.string().optional(),
})

const saveInterestsSchema = z.object({
  interests: z.array(z.string().min(1)).min(1, 'Select at least one interest'),
})

// ── Server Actions ──────────────────────────────────────────────────────────

export async function signUp(input: {
  fullName: string
  email: string
  password: string
  referralSource?: string
}): Promise<{ success: true } | { error: string }> {
  const parsed = signUpSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message }
  }

  const { fullName, email, password, referralSource } = parsed.data
  const supabase = await createServerClient()

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName },
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

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (error) {
    return { error: 'Invalid email or password' }
  }

  revalidatePath('/', 'layout')
  return { success: true, redirectTo: redirectTo || '/events' }
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
