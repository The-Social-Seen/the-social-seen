import { createBrowserClient } from '@supabase/ssr'

function getRequiredEnvVar(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `Missing environment variable: ${name}. Add it to your .env.local file.`
    )
  }
  return value
}

export function createClient() {
  const supabaseUrl = getRequiredEnvVar('NEXT_PUBLIC_SUPABASE_URL')
  const supabaseAnonKey = getRequiredEnvVar('NEXT_PUBLIC_SUPABASE_ANON_KEY')
  return createBrowserClient(supabaseUrl, supabaseAnonKey)
}
