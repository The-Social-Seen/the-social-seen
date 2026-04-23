import type { SupabaseClient } from '@supabase/supabase-js'
import { getE2EAnonKey, getE2EUrl } from './supabase'

/**
 * Test fixture factories. Every created row is tagged with a common
 * `e2e-<runId>-` prefix on `email` / `slug` so the teardown helper
 * can sweep them without touching any hand-entered dev data.
 *
 * Run-id is stable per Node process — tests running in the same
 * Playwright session share it so teardown finds every row created
 * during the session.
 */

export const E2E_RUN_ID = `e2e-${Date.now().toString(36)}-${Math.random()
  .toString(36)
  .slice(2, 7)}`

export const E2E_EMAIL_PREFIX = `${E2E_RUN_ID}+`
export const E2E_SLUG_PREFIX = `${E2E_RUN_ID}-`

export type UserStatus = 'active' | 'suspended' | 'banned'

export interface TestUser {
  id: string
  email: string
  /**
   * Password used at admin.createUser time. Returned so UI E2E specs
   * can drive the actual /login form for the seeded user instead of
   * hand-injecting cookies.
   */
  password: string
  accessToken: string
}

export interface CreateUserOpts {
  status?: UserStatus
  emailVerified?: boolean
  tag?: string
}

/**
 * Seed a user with specific (status, emailVerified) combo.
 *
 * Uses Supabase admin createUser to bypass normal signup flow (no
 * email send, no rate limit). Then signs in with the anon key to
 * mint a fresh access token suitable for RPC calls.
 *
 * @returns { id, email, accessToken } ready to hand to getUserClient().
 */
export async function createTestUser(
  admin: SupabaseClient,
  opts: CreateUserOpts = {},
): Promise<TestUser> {
  const {
    status = 'active',
    emailVerified = true,
    tag = 'user',
  } = opts
  const suffix = Math.random().toString(36).slice(2, 8)
  const email = `${E2E_EMAIL_PREFIX}${tag}-${suffix}@test.local`
  const password = `E2EPass!${suffix}`

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // bypass email-confirm flow at Supabase Auth level
  })
  if (createErr || !created.user) {
    throw new Error(`createTestUser: admin.createUser failed: ${createErr?.message}`)
  }

  // A trigger creates the profile row on auth.users insert; update the
  // state fields to match the scenario.
  const { error: updateErr } = await admin
    .from('profiles')
    .update({
      email_verified: emailVerified,
      status,
      full_name: `E2E ${tag}`,
    })
    .eq('id', created.user.id)
  if (updateErr) {
    throw new Error(`createTestUser: profile update failed: ${updateErr.message}`)
  }

  // Mint an access token. Use the anon-key password sign-in endpoint so
  // the JWT carries the user's claims (auth.uid() on server will match).
  const signInRes = await fetch(`${getE2EUrl()}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: getE2EAnonKey(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  })
  if (!signInRes.ok) {
    throw new Error(
      `createTestUser: sign-in failed (${signInRes.status}): ${await signInRes.text()}`,
    )
  }
  const signInBody = (await signInRes.json()) as { access_token: string }

  return {
    id: created.user.id,
    email,
    password,
    accessToken: signInBody.access_token,
  }
}

export interface CreateEventOpts {
  capacity?: number | null
  price?: number // pence; 0 = free
  isCancelled?: boolean
  isPublished?: boolean
  softDeleted?: boolean
  daysFromNow?: number
  tag?: string
}

export interface TestEvent {
  id: string
  slug: string
  title: string
}

/**
 * Seed an event for a scenario. Defaults to a free, published,
 * uncancelled event with capacity=5 starting 30 days out.
 */
export async function createTestEvent(
  admin: SupabaseClient,
  opts: CreateEventOpts = {},
): Promise<TestEvent> {
  const {
    capacity = 5,
    price = 0,
    isCancelled = false,
    isPublished = true,
    softDeleted = false,
    daysFromNow = 30,
    tag = 'event',
  } = opts
  const suffix = Math.random().toString(36).slice(2, 8)
  const slug = `${E2E_SLUG_PREFIX}${tag}-${suffix}`
  const title = `E2E ${tag} ${suffix}`
  const dateTime = new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000).toISOString()
  // events.end_time is NOT NULL with a CHECK (end_time > date_time).
  // Default to 3h after start — arbitrary but valid for every scenario.
  const endTime = new Date(
    Date.now() + daysFromNow * 24 * 60 * 60 * 1000 + 3 * 60 * 60 * 1000,
  ).toISOString()

  const { data, error } = await admin
    .from('events')
    .insert({
      slug,
      title,
      description: 'Seeded by the E2E suite.',
      short_description: 'E2E seed',
      date_time: dateTime,
      end_time: endTime,
      venue_name: 'E2E Venue',
      venue_address: '1 Test Road, London',
      venue_revealed: true,
      category: 'drinks',
      price,
      capacity,
      image_url: null,
      is_published: isPublished,
      is_cancelled: isCancelled,
      deleted_at: softDeleted ? new Date().toISOString() : null,
    })
    .select('id, slug, title')
    .single()

  if (error || !data) {
    throw new Error(`createTestEvent: insert failed: ${error?.message}`)
  }
  return data as TestEvent
}

/**
 * Convenience: fill an event with confirmed attendees up to its
 * capacity so the next booking attempt hits the waitlist path.
 */
export async function fillEventToCapacity(
  admin: SupabaseClient,
  event: TestEvent,
  capacity: number,
  tag: string = 'filler',
): Promise<TestUser[]> {
  const fillers: TestUser[] = []
  for (let i = 0; i < capacity; i++) {
    const filler = await createTestUser(admin, { tag: `${tag}-${i}` })
    fillers.push(filler)
    const { error } = await admin.from('bookings').insert({
      user_id: filler.id,
      event_id: event.id,
      status: 'confirmed',
      price_at_booking: 0,
    })
    if (error) {
      throw new Error(`fillEventToCapacity: booking insert failed: ${error.message}`)
    }
  }
  return fillers
}

/**
 * Purge every row this run created. Called in the global teardown.
 * Swallows errors (best-effort cleanup).
 */
export async function purgeRun(admin: SupabaseClient): Promise<void> {
  // Find auth users with our email prefix so we can delete them through
  // auth.admin (which cascades to public.profiles via the FK trigger).
  // We paginate defensively in case a run created many users.
  let page = 1
  const perPage = 200
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage })
    if (error || !data) break
    const matches = data.users.filter((u) => u.email?.startsWith(E2E_EMAIL_PREFIX))
    for (const u of matches) {
      await admin.auth.admin.deleteUser(u.id, true).catch(() => undefined)
    }
    if (data.users.length < perPage) break
    page += 1
    if (page > 50) break // defensive cap
  }

  // Events: prefix match on slug.
  await admin
    .from('events')
    .delete()
    .like('slug', `${E2E_SLUG_PREFIX}%`)
    .then(() => undefined, () => undefined)
}
