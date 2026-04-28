import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Supabase mock ──────────────────────────────────────────────────────────

const mockGetUser = vi.fn()
const mockFrom = vi.fn()
const mockStorageFrom = vi.fn()
const mockRpc = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(() =>
    Promise.resolve({
      auth: { getUser: mockGetUser },
      from: mockFrom,
      storage: { from: mockStorageFrom },
      rpc: mockRpc,
    }),
  ),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

import {
  updateProfile,
  updateAvatar,
  updateInterests,
  updateMyDemographics,
} from '../actions'

// ── Helpers ────────────────────────────────────────────────────────────────

function mockSupabaseChain(response: { data?: unknown; error?: unknown }) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {}
  const methods = ['select', 'insert', 'update', 'delete', 'eq', 'in', 'not', 'single']
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain)
  }
  chain.then = vi.fn((resolve: (v: unknown) => void) => resolve(response))
  mockFrom.mockReturnValue(chain)
  return chain
}

/**
 * Per-table mock — supports multiple from() calls in the same Server Action
 * dispatching to different chains. updateInterests now does:
 *   from('tags').select('id, slug').eq('is_active', true)
 *     .not('slug', 'like', 'interest-%').in('slug', ...)  → resolves tag rows
 *   from('user_interests').delete().eq(...)                → cleanup
 *   from('user_interests').insert(rows)                    → write new rows
 */
function mockSupabaseTables(
  responses: Record<string, { data?: unknown; error?: unknown }>,
): Record<string, Record<string, ReturnType<typeof vi.fn>>> {
  const chains: Record<string, Record<string, ReturnType<typeof vi.fn>>> = {}
  for (const [table, response] of Object.entries(responses)) {
    const chain: Record<string, ReturnType<typeof vi.fn>> = {}
    const methods = ['select', 'insert', 'update', 'delete', 'eq', 'in', 'not', 'single']
    for (const m of methods) {
      chain[m] = vi.fn().mockReturnValue(chain)
    }
    chain.then = vi.fn((resolve: (v: unknown) => void) => resolve(response))
    chains[table] = chain
  }
  mockFrom.mockImplementation((table: string) => chains[table])
  return chains
}

function authenticateUser(userId = 'user-1') {
  mockGetUser.mockResolvedValue({
    data: { user: { id: userId } },
    error: null,
  })
}

function unauthenticateUser() {
  mockGetUser.mockResolvedValue({
    data: { user: null },
    error: { message: 'Not authenticated' },
  })
}

// ── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
})

// ── updateProfile ────────────────────────────────────────────────────────────

describe('updateProfile', () => {
  it('returns error when full_name is empty', async () => {
    const result = await updateProfile({ full_name: '' })
    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
  })

  it('returns error when user is not authenticated', async () => {
    unauthenticateUser()

    const result = await updateProfile({ full_name: 'Charlotte Moreau' })

    expect(result.success).toBe(false)
    expect(result.error).toContain('Authentication required')
  })

  it('updates profile for authenticated user', async () => {
    authenticateUser()
    const chain = mockSupabaseChain({ data: null, error: null })

    const result = await updateProfile({
      full_name: 'Charlotte Moreau',
      job_title: 'Product Designer',
      company: 'Monzo',
      industry: 'Fintech',
      bio: 'Design enthusiast',
      linkedin_url: '',
    })

    expect(result.success).toBe(true)
    expect(mockFrom).toHaveBeenCalledWith('profiles')
    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        full_name: 'Charlotte Moreau',
        job_title: 'Product Designer',
        company: 'Monzo',
        linkedin_url: null, // empty string converted to null
      }),
    )
    expect(chain.eq).toHaveBeenCalledWith('id', 'user-1')
  })

  it('rejects invalid linkedin_url format', async () => {
    const result = await updateProfile({
      full_name: 'Charlotte Moreau',
      linkedin_url: 'not-a-url',
    })

    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
  })

  it('accepts valid linkedin_url', async () => {
    authenticateUser()
    mockSupabaseChain({ data: null, error: null })

    const result = await updateProfile({
      full_name: 'Charlotte Moreau',
      linkedin_url: 'https://linkedin.com/in/charlotte',
    })

    expect(result.success).toBe(true)
  })

  it('converts empty optional strings to null', async () => {
    authenticateUser()
    const chain = mockSupabaseChain({ data: null, error: null })

    await updateProfile({
      full_name: 'Charlotte',
      job_title: '',
      company: '',
      industry: '',
      bio: '',
      linkedin_url: '',
    })

    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        job_title: null,
        company: null,
        industry: null,
        bio: null,
        linkedin_url: null,
      }),
    )
  })
})

// ── updateAvatar ─────────────────────────────────────────────────────────────

describe('updateAvatar', () => {
  it('rejects when no file is provided', async () => {
    const formData = new FormData()

    const result = await updateAvatar(formData)

    expect(result.success).toBe(false)
    expect(result.error).toContain('No file')
  })

  it('rejects files over 2MB', async () => {
    const bigFile = new File([new ArrayBuffer(3 * 1024 * 1024)], 'big.jpg', {
      type: 'image/jpeg',
    })
    const formData = new FormData()
    formData.append('avatar', bigFile)

    const result = await updateAvatar(formData)

    expect(result.success).toBe(false)
    expect(result.error).toContain('2 MB')
  })

  it('rejects non-image file types', async () => {
    const pdfFile = new File(['fake'], 'doc.pdf', { type: 'application/pdf' })
    const formData = new FormData()
    formData.append('avatar', pdfFile)

    const result = await updateAvatar(formData)

    expect(result.success).toBe(false)
    expect(result.error).toContain('JPG, PNG, and WebP')
  })

  it('rejects when user is not authenticated', async () => {
    unauthenticateUser()

    const validFile = new File(['img'], 'photo.jpg', { type: 'image/jpeg' })
    const formData = new FormData()
    formData.append('avatar', validFile)

    const result = await updateAvatar(formData)

    expect(result.success).toBe(false)
    expect(result.error).toContain('Authentication required')
  })

  it('uploads avatar and updates profile for authenticated user', async () => {
    authenticateUser()

    const mockUpload = vi.fn().mockResolvedValue({ error: null })
    const mockGetPublicUrl = vi.fn().mockReturnValue({
      data: { publicUrl: 'https://storage.example.com/avatars/user-1/avatar.jpg' },
    })
    mockStorageFrom.mockReturnValue({
      upload: mockUpload,
      getPublicUrl: mockGetPublicUrl,
    })

    const chain = mockSupabaseChain({ data: null, error: null })

    const validFile = new File(['img'], 'photo.jpg', { type: 'image/jpeg' })
    const formData = new FormData()
    formData.append('avatar', validFile)

    const result = await updateAvatar(formData)

    expect(result.success).toBe(true)
    expect(mockStorageFrom).toHaveBeenCalledWith('avatars')
    expect(mockUpload).toHaveBeenCalledWith(
      'user-1/avatar.jpg',
      validFile,
      expect.objectContaining({ upsert: true }),
    )
    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        avatar_url: 'https://storage.example.com/avatars/user-1/avatar.jpg',
      }),
    )
  })
})

// ── updateInterests ─────────────────────────────────────────────────────────

describe('updateInterests', () => {
  it('rejects empty interests array', async () => {
    const result = await updateInterests([])

    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
  })

  it('rejects label-shaped input that fails the slug regex', async () => {
    // The schema runs first — a label string with spaces/ampersands
    // never reaches the auth check or the DB lookup. Pinning this
    // catches a regression that loosens the regex.
    const result = await updateInterests(['Wine & Cocktails'])

    expect(result.success).toBe(false)
    expect(result.error).toContain('Invalid interest slug')
    expect(mockGetUser).not.toHaveBeenCalled()
  })

  it('rejects when user is not authenticated', async () => {
    unauthenticateUser()

    const result = await updateInterests(['drinks-bars'])

    expect(result.success).toBe(false)
    expect(result.error).toContain('Authentication required')
  })

  it('deletes existing interests and inserts new ones (resolves tag_id from slug)', async () => {
    authenticateUser()

    // updateInterests now accepts canonical slugs directly from the
    // EditProfileForm chip grid. The action looks up matching tag UUIDs
    // via an active+primary-eligible filter and INSERTs (user_id, tag_id).
    const chains = mockSupabaseTables({
      tags: {
        data: [
          { id: 'tag-uuid-drinks-bars', slug: 'drinks-bars' },
          { id: 'tag-uuid-theatre-comedy', slug: 'theatre-comedy' },
        ],
        error: null,
      },
      user_interests: { data: null, error: null },
    })

    const result = await updateInterests(['drinks-bars', 'theatre-comedy'])

    expect(result.success).toBe(true)
    expect(mockFrom).toHaveBeenCalledWith('tags')
    expect(mockFrom).toHaveBeenCalledWith('user_interests')
    expect(chains.tags.in).toHaveBeenCalledWith(
      'slug',
      expect.arrayContaining(['drinks-bars', 'theatre-comedy']),
    )
    expect(chains.user_interests.delete).toHaveBeenCalled()
    expect(chains.user_interests.insert).toHaveBeenCalledWith([
      {
        user_id: 'user-1',
        tag_id: 'tag-uuid-drinks-bars',
      },
      {
        user_id: 'user-1',
        tag_id: 'tag-uuid-theatre-comedy',
      },
    ])
  })

  it('applies the active+primary-eligible DB filter when looking up tag rows', async () => {
    // The active/non-`interest-%` filter is what makes interest-only or
    // retired slugs unsavable from the profile-edit flow. Pinning the
    // filter shape stops a future contributor from quietly dropping it.
    authenticateUser()

    const chains = mockSupabaseTables({
      tags: {
        data: [{ id: 'tag-uuid-drinks-bars', slug: 'drinks-bars' }],
        error: null,
      },
      user_interests: { data: null, error: null },
    })

    await updateInterests(['drinks-bars'])

    expect(chains.tags.eq).toHaveBeenCalledWith('is_active', true)
    expect(chains.tags.not).toHaveBeenCalledWith('slug', 'like', 'interest-%')
  })

  it('wipes existing user_interests rows on save (intended soft-retire pattern)', async () => {
    // Deliberate behaviour per the soft-retire decision: if a user has
    // legacy interest-* rows in user_interests, saving with the new
    // primary-eligible chip set wipes them. Pinning this guards against
    // a refactor that introduces an "upsert" or "preserve unmapped"
    // path, which would contradict the design.
    authenticateUser()

    const chains = mockSupabaseTables({
      tags: {
        data: [{ id: 'tag-uuid-drinks-bars', slug: 'drinks-bars' }],
        error: null,
      },
      user_interests: { data: null, error: null },
    })

    await updateInterests(['drinks-bars'])

    // Delete must happen first — the action does delete-then-insert so
    // the user's row set always matches their current chip selection.
    expect(chains.user_interests.delete).toHaveBeenCalled()
    expect(chains.user_interests.eq).toHaveBeenCalledWith('user_id', 'user-1')
    expect(chains.user_interests.insert).toHaveBeenCalledWith([
      { user_id: 'user-1', tag_id: 'tag-uuid-drinks-bars' },
    ])
  })

  it('rejects an unknown slug (DB lookup returns short row count)', async () => {
    // Valid slug shape but nonexistent in the canonical taxonomy. DB
    // returns zero rows, length mismatch triggers refusal — and crucially
    // the user's existing rows must NOT be deleted before the failure
    // is detected.
    authenticateUser()

    const chains = mockSupabaseTables({
      tags: { data: [], error: null },
      user_interests: { data: null, error: null },
    })

    const result = await updateInterests(['totally-fake-slug'])

    expect(result.success).toBe(false)
    expect(result.error).toContain('Failed to save interests')
    expect(chains.user_interests.delete).not.toHaveBeenCalled()
    expect(chains.user_interests.insert).not.toHaveBeenCalled()
  })

  it('rejects an interest-only slug (filtered out by NOT LIKE \'interest-%\')', async () => {
    // The NOT LIKE filter makes interest-* rows invisible to this query
    // even though they exist in the DB. The row count comes back short
    // and the action refuses the write — and the user's existing rows
    // are preserved.
    authenticateUser()

    const chains = mockSupabaseTables({
      tags: { data: [], error: null },
      user_interests: { data: null, error: null },
    })

    const result = await updateInterests(['interest-photography'])

    expect(result.success).toBe(false)
    expect(result.error).toContain('Failed to save interests')
    expect(chains.user_interests.delete).not.toHaveBeenCalled()
    expect(chains.user_interests.insert).not.toHaveBeenCalled()
  })
})

// ── updateMyDemographics ────────────────────────────────────────────────────
//
// Wraps the SECURITY DEFINER `set_my_demographics()` RPC. Tests cover
// validation, the RPC payload shape, auth boundary, and error surfacing.
// The RPC itself is exercised by the W4 DB-integration suite once a
// Docker stack is reachable.

describe('updateMyDemographics', () => {
  it('rejects when user is not authenticated', async () => {
    unauthenticateUser()
    const result = await updateMyDemographics({
      gender: 'female',
      age_range: '30-34',
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('Authentication required')
  })

  it('rejects an invalid gender value with a clear error', async () => {
    authenticateUser()
    const result = await updateMyDemographics({
      gender: 'fluid' as unknown as 'female',
      age_range: null,
    })
    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
  })

  it('rejects an invalid age_range value with a clear error', async () => {
    authenticateUser()
    const result = await updateMyDemographics({
      gender: null,
      age_range: '15-17' as unknown as '18-24',
    })
    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
  })

  it('calls set_my_demographics RPC with the validated payload', async () => {
    authenticateUser()
    mockRpc.mockResolvedValue({ data: null, error: null })

    const result = await updateMyDemographics({
      gender: 'non_binary',
      age_range: '35-39',
    })

    expect(result).toEqual({ success: true })
    expect(mockRpc).toHaveBeenCalledTimes(1)
    expect(mockRpc).toHaveBeenCalledWith('set_my_demographics', {
      p_gender: 'non_binary',
      p_age_range: '35-39',
    })
  })

  it('passes nulls through when the user clears one or both fields', async () => {
    authenticateUser()
    mockRpc.mockResolvedValue({ data: null, error: null })

    await updateMyDemographics({ gender: null, age_range: null })

    expect(mockRpc).toHaveBeenCalledWith('set_my_demographics', {
      p_gender: null,
      p_age_range: null,
    })
  })

  it('returns a generic "Failed to save" error when the RPC fails', async () => {
    authenticateUser()
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'permission denied' },
    })

    const result = await updateMyDemographics({
      gender: 'female',
      age_range: '40-44',
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('Failed to save')
  })

  it('does NOT call from() — writes go through the RPC, never raw UPDATE', async () => {
    // Decision 7 — Option A: the `authenticated` GRANT excludes gender +
    // age_range. A regression that switched to `from('profiles').update`
    // would silently fail with `42501`. This test guards against that
    // refactor.
    authenticateUser()
    mockRpc.mockResolvedValue({ data: null, error: null })

    await updateMyDemographics({ gender: 'male', age_range: '25-29' })

    expect(mockFrom).not.toHaveBeenCalled()
  })
})
