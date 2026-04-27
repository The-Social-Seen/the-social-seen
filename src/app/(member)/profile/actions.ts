'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createServerClient } from '@/lib/supabase/server'
import { interestSlugFor } from '@/lib/constants'

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
  // Phone is collected at sign-up; the profile UI lets the user revise
  // it later. Stored stripped of whitespace; the DB CHECK enforces
  // 10–15 digits with an optional leading +.
  phone_number: z
    .string()
    .max(24)
    .optional()
    .default('')
    .transform((v) => v.replace(/\s+/g, ''))
    .refine(
      (v) => v === '' || /^\+?[0-9]{10,15}$/.test(v),
      'Enter a valid phone number',
    ),
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

  const {
    full_name,
    job_title,
    company,
    industry,
    bio,
    linkedin_url,
    phone_number,
  } = parsed.data

  const { error } = await supabase
    .from('profiles')
    .update({
      full_name,
      job_title: job_title || null,
      company: company || null,
      industry: industry || null,
      bio: bio || null,
      linkedin_url: linkedin_url || null,
      // Empty string clears the field. The column is nullable.
      phone_number: phone_number || null,
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

  // Resolve each interest label (from INTEREST_OPTIONS) to its canonical
  // tag slug. Off-list input here means INTEREST_OPTIONS and the form
  // drifted out of sync — refuse rather than write an unmappable row.
  const slugMap = new Map<string, string>()
  for (const interestLabel of parsed.data.interests) {
    const slug = interestSlugFor(interestLabel)
    if (!slug) {
      console.error('[updateInterests:slug]', `no slug for interest "${interestLabel}"`)
      return { success: false, error: 'Failed to save interests' }
    }
    slugMap.set(interestLabel, slug)
  }

  // Batch lookup: resolve all required tag slugs to UUIDs in a single query.
  // After F2-schema dropped the legacy `interest` text column,
  // user_interests.tag_id is the SOLE carrier of interest semantics.
  const requiredSlugs = Array.from(new Set(slugMap.values()))
  const { data: tagRows, error: tagsError } = await supabase
    .from('tags')
    .select('id, slug')
    .in('slug', requiredSlugs)

  if (tagsError || !tagRows || tagRows.length !== requiredSlugs.length) {
    console.error(
      '[updateInterests:tags]',
      tagsError?.message ?? `expected ${requiredSlugs.length} tag rows, got ${tagRows?.length ?? 0}`,
    )
    return { success: false, error: 'Failed to save interests' }
  }
  const slugToTagId = new Map(tagRows.map((t) => [t.slug, t.id]))

  // Delete existing interests
  const { error: deleteError } = await supabase
    .from('user_interests')
    .delete()
    .eq('user_id', user.id)

  if (deleteError) {
    console.error('[updateInterests:delete]', deleteError.message)
    return { success: false, error: 'Failed to update interests' }
  }

  // Insert new interests as (user_id, tag_id) — F2-schema dropped the
  // legacy `interest` text column.
  const rows = parsed.data.interests.map((interestLabel) => ({
    user_id: user.id,
    tag_id: slugToTagId.get(slugMap.get(interestLabel)!)!,
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

// ── Update demographics (Phase 3 W1: gender + age_range) ────────────────────

const GENDER_VALUES = ['female', 'male', 'non_binary', 'prefer_not_to_say'] as const
const AGE_RANGE_VALUES = [
  '18-24',
  '25-29',
  '30-34',
  '35-39',
  '40-44',
  '45-49',
  '50+',
] as const

const demographicsSchema = z.object({
  // Both fields are optional but, when present, must be valid enum values.
  // Empty string from a form input is normalised to null so the user can
  // clear a previously-set value if they want to.
  gender: z
    .enum(GENDER_VALUES)
    .nullable()
    .optional()
    .or(z.literal('').transform(() => null)),
  age_range: z
    .enum(AGE_RANGE_VALUES)
    .nullable()
    .optional()
    .or(z.literal('').transform(() => null)),
})

export async function updateMyDemographics(input: {
  gender?: string | null
  age_range?: string | null
}): Promise<{ success: boolean; error?: string }> {
  const parsed = demographicsSchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? 'Invalid demographics value',
    }
  }

  const supabase = await createServerClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return { success: false, error: 'Authentication required' }
  }

  // Writes flow through the SECURITY DEFINER `set_my_demographics()` RPC
  // shipped in Migration 1a (20260503000001). The function scopes the
  // UPDATE to `auth.uid()`, so the caller can only modify their own row;
  // the broader `authenticated` GRANT on `profiles` excludes these
  // columns by design (Decision 7 — Option A).
  const { error: rpcError } = await supabase.rpc('set_my_demographics', {
    p_gender: parsed.data.gender ?? null,
    p_age_range: parsed.data.age_range ?? null,
  })

  if (rpcError) {
    console.error('[updateMyDemographics]', rpcError.message)
    return { success: false, error: 'Failed to save demographics' }
  }

  revalidatePath('/profile')
  return { success: true }
}
