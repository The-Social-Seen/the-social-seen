import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Supabase mock ──────────────────────────────────────────────────────────

const mockGetUser = vi.fn()
const mockFrom = vi.fn()
const mockStorageFrom = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(() =>
    Promise.resolve({
      auth: { getUser: mockGetUser },
      from: mockFrom,
      storage: { from: mockStorageFrom },
    }),
  ),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

import { updateProfile, updateAvatar, updateInterests } from '../actions'

// ── Helpers ────────────────────────────────────────────────────────────────

function mockSupabaseChain(response: { data?: unknown; error?: unknown }) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {}
  const methods = ['select', 'insert', 'update', 'delete', 'eq', 'single']
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain)
  }
  chain.then = vi.fn((resolve: (v: unknown) => void) => resolve(response))
  mockFrom.mockReturnValue(chain)
  return chain
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

  it('rejects when user is not authenticated', async () => {
    unauthenticateUser()

    const result = await updateInterests(['Wine & Cocktails'])

    expect(result.success).toBe(false)
    expect(result.error).toContain('Authentication required')
  })

  it('deletes existing interests and inserts new ones', async () => {
    authenticateUser()
    const chain = mockSupabaseChain({ data: null, error: null })

    const result = await updateInterests(['Wine & Cocktails', 'Technology'])

    expect(result.success).toBe(true)
    // Should call from('user_interests') for delete, then again for insert
    expect(mockFrom).toHaveBeenCalledWith('user_interests')
    expect(chain.delete).toHaveBeenCalled()
    expect(chain.insert).toHaveBeenCalledWith([
      { user_id: 'user-1', interest: 'Wine & Cocktails' },
      { user_id: 'user-1', interest: 'Technology' },
    ])
  })
})
