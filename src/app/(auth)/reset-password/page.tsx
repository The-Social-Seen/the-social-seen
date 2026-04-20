import { Suspense } from 'react'
import { ResetPasswordForm } from './reset-password-form'

export const metadata = {
  title: 'Reset Password — The Social Seen',
  description: 'Set a new password for your account.',
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  )
}
