import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { execFileSync } from 'node:child_process'

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
 * `SUPABASE_E2E_SERVICE_ROLE_KEY` / `SUPABASE_E2E_ANON_KEY`. CI sets
 * these explicitly from the live `supabase start` stack (see
 * .github/workflows/ci.yml's "Export live Supabase keys" step). For a
 * local `pnpm e2e` run where they are not set, the two key getters
 * fall back to shelling out to `supabase status -o json` and reading
 * whatever the INSTALLED CLI currently emits — not a hardcoded
 * constant. Supabase has been migrating from legacy anon/service_role
 * JWTs to a new "sb_publishable_" / "sb_secret_" prefixed key format;
 * a hardcoded fallback here previously went stale the moment a
 * developer's local
 * CLI updated past that change, producing the exact "permission
 * denied" failures documented in the 2026-07-13 CI incident (see
 * SYSTEM-DESIGN-admin-waitlist-promotion-payment.md) — CI hit it
 * first only because it always installs `latest`, but any local dev
 * who updated their CLI was equally exposed.
 *
 * **Safety guard:** if the resolved URL points at `*.supabase.co`
 * (hosted), every factory throws. This prevents a misconfigured CI
 * from ever touching real data.
 */

const DEFAULT_LOCAL_URL = 'http://127.0.0.1:54321'

let cachedLocalStatus: { anonKey: string; serviceRoleKey: string } | null = null

/**
 * Lazily shells out to `supabase status -o json` and extracts the
 * anon/service_role keys the INSTALLED CLI currently issues, caching
 * the result for the process lifetime. Only reached when
 * SUPABASE_E2E_ANON_KEY / SUPABASE_E2E_SERVICE_ROLE_KEY are not
 * already set via env — CI always sets them explicitly (see
 * .github/workflows/ci.yml), so this path is local-dev-only.
 *
 * Field-name fallback prefers PUBLISHABLE_KEY/SECRET_KEY over the
 * legacy ANON_KEY/SERVICE_ROLE_KEY names, mirroring the same jq logic
 * in that workflow — and for the same hard-won reason: Supabase has
 * deprecated anon/service_role JWTs in favour of publishable/secret
 * keys, but a CLI in the deprecation window still EMITS the legacy
 * field names in `status -o json` with a value that no longer
 * authenticates as anything. Preferring ANON_KEY first (the original,
 * more obvious-looking order) silently picks the dead credential and
 * fails with an opaque "permission denied" at the Postgres layer
 * instead of here — confirmed directly by a Supabase maintainer
 * (github.com/supabase/cli/issues/4211, sweatybridge): "please use
 * the publishable and secret keys in place of deprecated anon and
 * service role keys. It's a drop in replacement." Falling back to the
 * legacy names only matters for a CLI old enough to predate the new
 * key pair existing at all.
 */
function resolveLocalSupabaseStatus(): { anonKey: string; serviceRoleKey: string } {
  if (cachedLocalStatus) return cachedLocalStatus

  let statusJson: Record<string, unknown>
  try {
    const raw = execFileSync('supabase', ['status', '-o', 'json'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    statusJson = JSON.parse(raw)
  } catch (err) {
    throw new Error(
      'Could not read local Supabase keys: `supabase status -o json` failed. ' +
        'Is the local stack running (`supabase start`)? Or set ' +
        'SUPABASE_E2E_ANON_KEY / SUPABASE_E2E_SERVICE_ROLE_KEY directly. ' +
        `Original error: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  const anonKey = (statusJson.PUBLISHABLE_KEY ?? statusJson.ANON_KEY) as
    | string
    | undefined
  const serviceRoleKey = (statusJson.SECRET_KEY ??
    statusJson.SERVICE_ROLE_KEY) as string | undefined

  if (!anonKey || !serviceRoleKey) {
    throw new Error(
      'Could not extract ANON_KEY/SERVICE_ROLE_KEY (or PUBLISHABLE_KEY/' +
        'SECRET_KEY) from `supabase status -o json`. The CLI output shape ' +
        'may have changed again — inspect it directly and update ' +
        'resolveLocalSupabaseStatus() in e2e/helpers/supabase.ts.',
    )
  }

  cachedLocalStatus = { anonKey, serviceRoleKey }
  return cachedLocalStatus
}

export function getE2EUrl(): string {
  return process.env.SUPABASE_E2E_URL ?? DEFAULT_LOCAL_URL
}

export function getE2EAnonKey(): string {
  return (
    process.env.SUPABASE_E2E_ANON_KEY ?? resolveLocalSupabaseStatus().anonKey
  )
}

export function getE2EServiceRoleKey(): string {
  return (
    process.env.SUPABASE_E2E_SERVICE_ROLE_KEY ??
    resolveLocalSupabaseStatus().serviceRoleKey
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
