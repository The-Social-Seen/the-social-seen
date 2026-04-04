'use client'

import { useState, useRef, useTransition } from 'react'
import Image from 'next/image'
import * as Dialog from '@radix-ui/react-dialog'
import { X, Camera, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { resolveAvatarUrl, getInitials } from '@/lib/utils/images'
import { INTEREST_OPTIONS } from '@/lib/constants'
import { updateProfile, updateAvatar, updateInterests } from '@/app/(member)/profile/actions'
import type { Profile } from '@/types'

interface EditProfileFormProps {
  profile: Profile & { interests: string[] }
  open: boolean
  onOpenChange: (open: boolean) => void
}

const LINKEDIN_REGEX = /^https?:\/\/(www\.)?linkedin\.com\/.*$/

export function EditProfileForm({ profile, open, onOpenChange }: EditProfileFormProps) {
  const [fullName, setFullName] = useState(profile.full_name)
  const [jobTitle, setJobTitle] = useState(profile.job_title ?? '')
  const [company, setCompany] = useState(profile.company ?? '')
  const [industry, setIndustry] = useState(profile.industry ?? '')
  const [bio, setBio] = useState(profile.bio ?? '')
  const [linkedinUrl, setLinkedinUrl] = useState(profile.linkedin_url ?? '')
  const [selectedInterests, setSelectedInterests] = useState<string[]>(profile.interests)
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null)
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isPending, startTransition] = useTransition()
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const avatarUrl = avatarPreview ?? resolveAvatarUrl(profile.avatar_url)
  const initials = getInitials(fullName || profile.full_name)

  function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    if (file.size > 2 * 1024 * 1024) {
      setErrors((prev) => ({ ...prev, avatar: 'Image must be under 2 MB' }))
      return
    }

    setErrors((prev) => {
      const next = { ...prev }
      delete next.avatar
      return next
    })
    setAvatarFile(file)
    setAvatarPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return URL.createObjectURL(file)
    })
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && avatarPreview) {
      URL.revokeObjectURL(avatarPreview)
      setAvatarPreview(null)
    }
    onOpenChange(nextOpen)
  }

  function toggleInterest(value: string) {
    setSelectedInterests((prev) =>
      prev.includes(value) ? prev.filter((i) => i !== value) : [...prev, value],
    )
  }

  function validate(): boolean {
    const newErrors: Record<string, string> = {}

    if (!fullName.trim()) {
      newErrors.full_name = 'Name is required'
    }

    if (linkedinUrl && !LINKEDIN_REGEX.test(linkedinUrl)) {
      newErrors.linkedin_url = 'Enter a valid LinkedIn URL'
    }

    if (selectedInterests.length === 0) {
      newErrors.interests = 'Select at least one interest'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validate()) return

    startTransition(async () => {
      // Upload avatar if changed
      if (avatarFile) {
        const formData = new FormData()
        formData.append('avatar', avatarFile)
        const avatarResult = await updateAvatar(formData)
        if (!avatarResult.success) {
          setErrors((prev) => ({ ...prev, avatar: avatarResult.error ?? 'Upload failed' }))
          return
        }
      }

      // Update profile fields
      const profileResult = await updateProfile({
        full_name: fullName.trim(),
        job_title: jobTitle.trim(),
        company: company.trim(),
        industry: industry.trim(),
        bio: bio.trim(),
        linkedin_url: linkedinUrl.trim(),
      })

      if (!profileResult.success) {
        setErrors((prev) => ({ ...prev, form: profileResult.error ?? 'Update failed' }))
        return
      }

      // Update interests
      const interestsResult = await updateInterests(selectedInterests)
      if (!interestsResult.success) {
        setErrors((prev) => ({ ...prev, interests: interestsResult.error ?? 'Update failed' }))
        return
      }

      setSuccessMessage('Profile updated')
      setTimeout(() => {
        setSuccessMessage(null)
        onOpenChange(false)
      }, 1000)
    })
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-charcoal/40 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed inset-x-4 bottom-0 z-50 mx-auto max-h-[90vh] max-w-lg overflow-y-auto rounded-t-2xl bg-white p-6 shadow-xl dark:bg-dark-surface sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl">
          <div className="mb-6 flex items-center justify-between">
            <Dialog.Title className="font-serif text-xl font-bold text-charcoal dark:text-dark-text">
              Edit Profile
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                className="rounded-full p-1.5 text-muted transition-colors hover:bg-cream hover:text-charcoal dark:text-dark-muted dark:hover:bg-dark-border dark:hover:text-dark-text"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </Dialog.Close>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Avatar upload */}
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="group relative h-20 w-20 flex-shrink-0 overflow-hidden rounded-xl border-2 border-gold/20"
              >
                {avatarUrl ? (
                  <Image
                    src={avatarUrl}
                    alt="Avatar"
                    width={80}
                    height={80}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-gold/10">
                    <span className="font-serif text-lg font-bold text-gold">{initials}</span>
                  </div>
                )}
                <div className="absolute inset-0 flex items-center justify-center bg-charcoal/40 opacity-0 transition-opacity group-hover:opacity-100">
                  <Camera className="h-5 w-5 text-white" />
                </div>
              </button>
              <div>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="text-sm font-medium text-gold hover:underline"
                >
                  Upload photo
                </button>
                <p className="mt-0.5 text-xs text-muted dark:text-dark-muted">JPG, PNG, or WebP. Max 2 MB.</p>
                {errors.avatar && <p className="mt-1 text-xs text-danger">{errors.avatar}</p>}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleAvatarChange}
                className="hidden"
              />
            </div>

            {/* Full name */}
            <FieldGroup label="Full name" error={errors.full_name}>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className={cn(fieldClass, errors.full_name && 'border-danger')}
                placeholder="Your full name"
              />
            </FieldGroup>

            {/* Job title + Company row */}
            <div className="grid gap-4 sm:grid-cols-2">
              <FieldGroup label="Job title">
                <input
                  type="text"
                  value={jobTitle}
                  onChange={(e) => setJobTitle(e.target.value)}
                  className={fieldClass}
                  placeholder="e.g. Product Designer"
                />
              </FieldGroup>
              <FieldGroup label="Company">
                <input
                  type="text"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  className={fieldClass}
                  placeholder="e.g. Monzo"
                />
              </FieldGroup>
            </div>

            {/* Industry */}
            <FieldGroup label="Industry">
              <input
                type="text"
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                className={fieldClass}
                placeholder="e.g. Fintech"
              />
            </FieldGroup>

            {/* Bio */}
            <FieldGroup label="Bio">
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                rows={3}
                maxLength={500}
                className={cn(fieldClass, 'resize-none')}
                placeholder="Tell other members a bit about yourself"
              />
              <p className="mt-1 text-right text-xs text-muted dark:text-dark-muted">
                {bio.length}/500
              </p>
            </FieldGroup>

            {/* LinkedIn */}
            <FieldGroup label="LinkedIn URL" error={errors.linkedin_url}>
              <input
                type="url"
                value={linkedinUrl}
                onChange={(e) => setLinkedinUrl(e.target.value)}
                className={cn(fieldClass, errors.linkedin_url && 'border-danger')}
                placeholder="https://linkedin.com/in/yourname"
              />
            </FieldGroup>

            {/* Interests */}
            <div>
              <label className="mb-2 block text-sm font-medium text-charcoal dark:text-dark-text">
                Interests
              </label>
              <div className="flex flex-wrap gap-2">
                {INTEREST_OPTIONS.map((interest) => {
                  const isSelected = selectedInterests.includes(interest.value)
                  return (
                    <button
                      key={interest.value}
                      type="button"
                      onClick={() => toggleInterest(interest.value)}
                      className={cn(
                        'rounded-full border px-3 py-1.5 text-xs font-medium transition-all duration-200',
                        isSelected
                          ? 'border-gold bg-gold text-white'
                          : 'border-gold/20 bg-transparent text-gold hover:border-gold/50 hover:bg-gold/5',
                      )}
                    >
                      {interest.label}
                    </button>
                  )
                })}
              </div>
              {errors.interests && (
                <p className="mt-1.5 text-xs text-danger">{errors.interests}</p>
              )}
            </div>

            {/* Error / Success messages */}
            {errors.form && (
              <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{errors.form}</p>
            )}
            {successMessage && (
              <p className="rounded-lg bg-success/10 px-3 py-2 text-sm text-success">{successMessage}</p>
            )}

            {/* Submit */}
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => handleOpenChange(false)}
                className="flex-1 rounded-full border border-border px-6 py-3 text-sm font-medium text-charcoal transition-colors hover:bg-cream dark:border-dark-border dark:text-dark-text dark:hover:bg-dark-border"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isPending}
                className="flex flex-1 items-center justify-center gap-2 rounded-full bg-gold px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-gold-hover disabled:opacity-50"
              >
                {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {isPending ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

// ── Shared styles ────────────────────────────────────────────────────────────

const fieldClass =
  'w-full rounded-lg border border-border bg-white px-3 py-2.5 text-sm text-charcoal placeholder:text-muted/50 focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/20 dark:border-dark-border dark:bg-dark-surface dark:text-dark-text dark:placeholder:text-dark-muted/50'

function FieldGroup({
  label,
  error,
  children,
}: {
  label: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-charcoal dark:text-dark-text">
        {label}
      </label>
      {children}
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  )
}
