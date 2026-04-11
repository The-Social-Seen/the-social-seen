import { createServerClient as createSSRServerClient, type CookieMethodsServer } from '@supabase/ssr'
import { cookies } from 'next/headers'

function getRequiredEnvVar(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `Missing environment variable: ${name}. Add it to your .env.local file.`
    )
  }
  return value
}

/**
 * Server client for use in Server Components and Server Actions.
 * Reads/writes auth cookies to maintain the user session.
 */
export async function createServerClient() {
  const supabaseUrl = getRequiredEnvVar('NEXT_PUBLIC_SUPABASE_URL')
  const supabaseAnonKey = getRequiredEnvVar('NEXT_PUBLIC_SUPABASE_ANON_KEY')
  const cookieStore = await cookies()

  const cookieMethods: CookieMethodsServer = {
    getAll() {
      return cookieStore.getAll()
    },
    setAll(cookiesToSet) {
      try {
        cookiesToSet.forEach(({ name, value, options }) =>
          cookieStore.set(name, value, { ...options })
        )
      } catch {
        // The `setAll` method is called from a Server Component.
        // Cookies can only be set from Server Actions or Route Handlers.
        // Ignore the error — the middleware handles session refreshes.
      }
    },
  }

  return createSSRServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: cookieMethods,
  })
}
