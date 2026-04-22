import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Browser-side Supabase client — singleton.
 *
 * Why singleton: @supabase/ssr's browser client keeps in-memory auth state and
 * fires `onAuthStateChange` events only for the instance that made the auth
 * call. Creating fresh instances from different components means listeners on
 * instance A never hear about sign-ins that happened on instance B, so UI
 * (e.g. the Header avatar) goes stale. One shared instance fixes this.
 *
 * IMPORTANT: `NEXT_PUBLIC_` env vars MUST be accessed as literal strings
 * (e.g. `process.env.NEXT_PUBLIC_SUPABASE_URL`), NOT via dynamic bracket
 * notation (`process.env[name]`). Next.js statically replaces literal
 * references at build time; dynamic access returns `undefined` in the
 * browser bundle.
 */
let client: SupabaseClient | null = null

export function createClient(): SupabaseClient {
  if (client) return client

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. ' +
      'Add them to .env.local (dev) or Vercel Environment Variables (prod).'
    )
  }

  client = createBrowserClient(supabaseUrl, supabaseAnonKey)
  return client
}
