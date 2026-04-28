import { Suspense } from 'react'
import type { Metadata } from 'next'
import { JoinForm } from './join-form'
import { canonicalUrl } from '@/lib/utils/site'
import { getRegistrationInterestTags } from '@/lib/supabase/queries/tags'

export const metadata: Metadata = {
  title: 'Join — The Social Seen',
  description: 'Create your account and join London\'s most exciting social community.',
  alternates: { canonical: canonicalUrl('/join') },
}

export default async function JoinPage() {
  const interestTags = await getRegistrationInterestTags()
  return (
    <Suspense>
      <JoinForm interestTags={interestTags} />
    </Suspense>
  )
}
