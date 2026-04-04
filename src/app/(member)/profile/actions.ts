'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createServerClient } from '@/lib/supabase/server'

// ── Validation schemas ──────────────────────────────────────────────────────

const profileSchema = z.object({
  full_name: z.string().min(1, 'Name is required').max(100),
  job_title: z.string().max(100).optional().default(''),
  company: z.string().max(100).optional().default(''),
  industry: z.string().max(100).optional().default(''),
  bio: z.string().max(500).optional().default(''),
  linkedin_url: z
    .string()
    .url('Enter a valid URL')
    .optional()
    .or(z.literal('')),
})

const interestsSchema = z.object({
  interests: z.array(z.string().min(1)).min(1, 'Select at least one interest'),
})

const ALLOWED_AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_AVATAR_SIZE = 2 * 1024 * 1024 // 2 MB

// ── Update profile fields ───────────────────────────────────────────────────

export async function updateProfile(
  input: Record<string, unknown>,
): Promise<{ success: boolean; error?: string }> {
  const parsed = profileSchema.safeParse(input)
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message }
  }

  const supabase = await createServerClient()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return { success: false, error: 'Authentication required' }
  }

  const { full_name, job_title, company, industry, bio, linkedin_url } =
    parsed.data

  const { error } = await supabase
    .from('profiles')
    .update({
      full_name,
      job_title: job_title || null,
      company: company || null,
      industry: industry || null,
      bio: bio || null,
      linkedin_url: linkedin_url || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', user.id)

  if (error) {
    console.error('[updateProfile]', error.message)
    return { success: false, error: 'Failed to update profile' }
  }

  revalidatePath('/profile')
  return { success: true }
}

// ── Upload avatar ───────────────────────────────────────────────────────────

export async function updateAvatar(
  formData: FormData,
): Promise<{ success: boolean; error?: string }> {
  const file = formData.get('avatar')
  if (!(file instanceof File) || file.size === 0) {
    return { success: false, error: 'No file provided' }
  }

  if (!ALLOWED_AVATAR_TYPES.includes(file.type)) {
    return { success: false, error: 'Only JPG, PNG, and WebP images are allowed' }
  }

  if (file.size > MAX_AVATAR_SIZE) {
    return { success: false, error: 'Image must be under 2 MB' }
  }

  const supabase = await createServerClient()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return { success: false, error: 'Authentication required' }
  }

  // Upload to avatars bucket — overwrite existing file for this user
  const ext = file.name.split('.').pop() ?? 'jpg'
  const filePath = `${user.id}/avatar.${ext}`

  const { error: uploadError } = await supabase.storage
    .from('avatars')
    .upload(filePath, file, { upsert: true, contentType: file.type })

  if (uploadError) {
    console.error('[updateAvatar:upload]', uploadError.message)
    return { success: false, error: 'Failed to upload image' }
  }

  // Get the public URL
  const {
    data: { publicUrl },
  } = supabase.storage.from('avatars').getPublicUrl(filePath)

  // Update the profile
  const { error: updateError } = await supabase
    .from('profiles')
    .update({
      avatar_url: publicUrl,
      updated_at: new Date().toISOString(),
    })
    .eq('id', user.id)

  if (updateError) {
    console.error('[updateAvatar:profile]', updateError.message)
    return { success: false, error: 'Failed to update profile' }
  }

  revalidatePath('/profile')
  return { success: true }
}

// ── Update interests ────────────────────────────────────────────────────────

export async function updateInterests(
  interests: string[],
): Promise<{ success: boolean; error?: string }> {
  const parsed = interestsSchema.safeParse({ interests })
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message }
  }

  const supabase = await createServerClient()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return { success: false, error: 'Authentication required' }
  }

  // Delete existing interests
  const { error: deleteError } = await supabase
    .from('user_interests')
    .delete()
    .eq('user_id', user.id)

  if (deleteError) {
    console.error('[updateInterests:delete]', deleteError.message)
    return { success: false, error: 'Failed to update interests' }
  }

  // Insert new interests
  const rows = parsed.data.interests.map((interest) => ({
    user_id: user.id,
    interest,
  }))

  const { error: insertError } = await supabase
    .from('user_interests')
    .insert(rows)

  if (insertError) {
    console.error('[updateInterests:insert]', insertError.message)
    return { success: false, error: 'Failed to save interests' }
  }

  revalidatePath('/profile')
  return { success: true }
}
