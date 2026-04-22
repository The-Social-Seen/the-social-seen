import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Supabase client factories for the E2E suite.
 *
 * Two clients:
 *   - `getAdminClient()` — service-role, bypasses RLS. Used for seed
 *     + teardown.
 *   - `getUserClient(jwt)` — anon key + user JWT. Used when a test
 *     needs to call an RPC as a specific seeded user (auth.uid()
 *     matters for the booking RPCs).
 *
 * Both clients resolve env from `SUPABASE_E2E_URL` /
 * `SUPABASE_E2E_SERVICE_ROLE_KEY` / `SUPABASE_E2E_ANON_KEY`. These
 * default to the `supabase start` local stack
 * (`http://127.0.0.1:54321` + the well-known local demo keys baked
 * into the CLI).
 *
 * **Safety guard:** if the resolved URL points at `*.supabase.co`
 * (hosted), every factory throws. This prevents a misconfigured CI
 * from ever touching real data.
 */

const DEFAULT_LOCAL_URL = 'http://127.0.0.1:54321'

// Well-known local-dev service role / anon keys. These are shipped
// with the Supabase CLI and are ONLY valid against the local stack
// they spin up — they have no power elsewhere. Including them here
// means `pnpm e2e` works out of the box after `supabase start`.
const DEFAULT_LOCAL_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
const DEFAULT_LOCAL_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'

export function getE2EUrl(): string {
  return process.env.SUPABASE_E2E_URL ?? DEFAULT_LOCAL_URL
}

export function getE2EAnonKey(): string {
  return process.env.SUPABASE_E2E_ANON_KEY ?? DEFAULT_LOCAL_ANON_KEY
}

export function getE2EServiceRoleKey(): string {
  return (
    process.env.SUPABASE_E2E_SERVICE_ROLE_KEY ?? DEFAULT_LOCAL_SERVICE_ROLE_KEY
  )
}

function assertLocalOnly(url: string): void {
  if (/\.supabase\.(co|io)(:|\/|$)/i.test(url)) {
    throw new Error(
      `Refusing to run E2E against a hosted Supabase project (${url}). ` +
        `E2E is destructive — it seeds and deletes rows. Set ` +
        `SUPABASE_E2E_URL to a local stack (http://127.0.0.1:54321) or ` +
        `a disposable staging project dedicated to E2E.`,
    )
  }
}

export function getAdminClient(): SupabaseClient {
  const url = getE2EUrl()
  assertLocalOnly(url)
  return createClient(url, getE2EServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export function getUserClient(accessToken: string): SupabaseClient {
  const url = getE2EUrl()
  assertLocalOnly(url)
  return createClient(url, getE2EAnonKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  })
}
