import { Suspense } from 'react'
import { JoinForm } from './join-form'

export const metadata = {
  title: 'Join — The Social Seen',
  description: 'Create your account and join London\'s most exciting social community.',
}

export default function JoinPage() {
  return (
    <Suspense>
      <JoinForm />
    </Suspense>
  )
}
