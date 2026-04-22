import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { UnverifiedBanner } from '@/components/auth/UnverifiedBanner'

/**
 * Member layout — protects all routes under (member)/.
 * Redirects unauthenticated users to /login.
 * Redirects users who haven't completed onboarding to /join?step=2.
 * Renders the unverified-email banner for users who haven't verified yet.
 */
export default async function MemberLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createServerClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    redirect('/login')
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('onboarding_complete, email_verified')
    .eq('id', user.id)
    .single()

  if (!profile?.onboarding_complete) {
    redirect('/join?step=2')
  }

  return (
    <main>
      <UnverifiedBanner verified={profile?.email_verified ?? false} />
      {children}
    </main>
  )
}
