/**
 * NEVER import this file in Client Components or any file without 'use server'.
 * This client uses the service_role key which bypasses Row Level Security.
 * It must only be used in server-only contexts (e.g., admin Server Actions, cron jobs).
 */
import 'server-only'
import { createClient } from '@supabase/supabase-js'

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
 * Admin client with service_role access — bypasses RLS.
 * NEVER import this in client components.
 */
export function createAdminClient() {
  const supabaseUrl = getRequiredEnvVar('NEXT_PUBLIC_SUPABASE_URL')
  const serviceRoleKey = getRequiredEnvVar('SUPABASE_SERVICE_ROLE_KEY')

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}
