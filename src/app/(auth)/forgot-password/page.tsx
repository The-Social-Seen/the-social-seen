import { Suspense } from 'react'
import { ForgotPasswordForm } from './forgot-password-form'

export const metadata = {
  title: 'Forgot Password — The Social Seen',
  description: 'Reset your password to regain access to your account.',
}

export default function ForgotPasswordPage() {
  return (
    <Suspense>
      <ForgotPasswordForm />
    </Suspense>
  )
}
