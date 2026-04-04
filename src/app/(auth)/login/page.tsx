import { Suspense } from 'react'
import { LoginForm } from './login-form'

export const metadata = {
  title: 'Sign In — The Social Seen',
  description: 'Sign in to access your events and community.',
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}
