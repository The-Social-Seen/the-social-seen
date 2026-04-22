import { Suspense } from 'react'
import type { Metadata } from 'next'
import { JoinForm } from './join-form'
import { canonicalUrl } from '@/lib/utils/site'

export const metadata: Metadata = {
  title: 'Join — The Social Seen',
  description: 'Create your account and join London\'s most exciting social community.',
  alternates: { canonical: canonicalUrl('/join') },
}

export default function JoinPage() {
  return (
    <Suspense>
      <JoinForm />
    </Suspense>
  )
}
