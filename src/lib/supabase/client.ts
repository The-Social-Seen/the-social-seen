import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'

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
 * Browser-side Supabase client — singleton.
 *
 * Why singleton: @supabase/ssr's browser client keeps in-memory auth state and
 * fires `onAuthStateChange` events only for the instance that made the auth
 * call. Creating fresh instances from different components means listeners on
 * instance A never hear about sign-ins that happened on instance B, so UI
 * (e.g. the Header avatar) goes stale. One shared instance fixes this.
 */
let client: SupabaseClient | null = null

export function createClient(): SupabaseClient {
  if (client) return client

  const supabaseUrl = getRequiredEnvVar('NEXT_PUBLIC_SUPABASE_URL')
  const supabaseAnonKey = getRequiredEnvVar('NEXT_PUBLIC_SUPABASE_ANON_KEY')
  client = createBrowserClient(supabaseUrl, supabaseAnonKey)
  return client
}
