import { Suspense } from 'react'
import { VerifyForm } from './verify-form'

export const metadata = {
  title: 'Verify Email — The Social Seen',
  description:
    'Enter the 6-digit code from your email to finish setting up your account.',
}

export default function VerifyPage() {
  return (
    <Suspense>
      <VerifyForm />
    </Suspense>
  )
}
