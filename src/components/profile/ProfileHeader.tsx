'use client'

import Image from 'next/image'
import { Edit3, Linkedin, ExternalLink, Briefcase, Building2, Calendar } from 'lucide-react'
import { resolveAvatarUrl, getInitials } from '@/lib/utils/images'
import type { Profile } from '@/types'

interface ProfileHeaderProps {
  profile: Profile & { interests: string[] }
  onEditClick: () => void
}

export function ProfileHeader({ profile, onEditClick }: ProfileHeaderProps) {
  const avatarUrl = resolveAvatarUrl(profile.avatar_url)
  const initials = getInitials(profile.full_name)
  const memberSince = new Date(profile.created_at).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
  })

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-bg-card p-6 shadow-sm md:p-8">
      <div className="flex flex-col items-start gap-6 md:flex-row">
        {/* Avatar */}
        <div className="relative flex-shrink-0">
          <div className="h-24 w-24 overflow-hidden rounded-xl border-2 border-gold/20 md:h-32 md:w-32">
            {avatarUrl ? (
              <Image
                src={avatarUrl}
                alt={profile.full_name}
                width={128}
                height={128}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-gold/10">
                <span className="font-serif text-2xl font-bold text-gold md:text-3xl">
                  {initials}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Info */}
        <div className="flex-1">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="font-serif text-2xl font-bold text-text-primary md:text-3xl">
                {profile.full_name}
              </h1>
              {(profile.job_title || profile.company) && (
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-text-tertiary">
                  {profile.job_title && (
                    <span className="flex items-center gap-1.5">
                      <Briefcase className="h-3.5 w-3.5" />
                      {profile.job_title}
                    </span>
                  )}
                  {profile.job_title && profile.company && (
                    <span className="text-border">&bull;</span>
                  )}
                  {profile.company && (
                    <span className="flex items-center gap-1.5">
                      <Building2 className="h-3.5 w-3.5" />
                      {profile.company}
                    </span>
                  )}
                </div>
              )}
            </div>
            <button
              onClick={onEditClick}
              className="inline-flex items-center gap-2 rounded-full border border-border px-5 py-2 text-sm font-medium text-text-tertiary transition-all hover:border-gold hover:text-gold"
            >
              <Edit3 className="h-3.5 w-3.5" />
              Edit Profile
            </button>
          </div>

          {/* Bio */}
          {profile.bio && (
            <p className="mb-4 max-w-xl text-sm leading-relaxed text-text-tertiary">
              {profile.bio}
            </p>
          )}

          {/* Member since + LinkedIn */}
          <div className="mb-4 flex flex-wrap items-center gap-4 text-sm text-text-tertiary">
            <span className="flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" />
              Member since {memberSince}
            </span>
            {profile.linkedin_url && (
              <a
                href={profile.linkedin_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 transition-colors hover:text-gold"
              >
                <Linkedin className="h-3.5 w-3.5" />
                LinkedIn
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>

          {/* Interest tags */}
          {profile.interests.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {profile.interests.map((interest) => (
                <span
                  key={interest}
                  className="rounded-full border border-gold/20 px-3 py-1 text-xs font-medium text-gold"
                >
                  {interest}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
