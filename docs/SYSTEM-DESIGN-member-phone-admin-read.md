# SYSTEM-DESIGN — Admin batch read of member phone numbers

**Status:** Spec for implementation. Architect output only — no application code or
migration is written here. `backend-developer` implements from this; `tester`
asserts the criteria in §9; `ux-designer` owns presentation (this doc owns data only).

**Branch:** `claude/kind-sinoussi-e81d07`

**Scope:** Surface each member's `phone_number` (PII) to ADMINS ONLY across three
list surfaces, plus confirm the member's own-profile read. Anon and non-admin
`authenticated` callers must continue to be unable to read `phone_number`.

**Cross-references (do not duplicate):**
- `supabase/migrations/20260503000002_narrow_phone_number_grant.sql` — the
  `get_my_phone()` + `admin_get_user_phone(uuid)` pattern this design mirrors.
- `supabase/migrations/20260503000001_add_profile_demographics.sql` — sibling
  SECURITY DEFINER pattern (`admin_get_demographics`), the GRANT allow-list, and
  the `search_path = public` convention.
- `docs/member-data-layer-spec.md` — Decision 7 (Option A, per-owner column grants),
  the source of the established pattern.
- `SYSTEM-DESIGN.md` (root) — the canonical platform architecture. This file is an
  addendum scoped to one PII read path; it does not restate platform-wide concerns.

---

## 0. TL;DR — the decision in one paragraph

Most of the security layer already exists from Phase-3 PII hardening. The ONE
missing primitive is a **batch** admin read. We add a single new SECURITY DEFINER
function, `admin_get_user_phones(target_user_ids uuid[])`, that returns a set of
`(user_id uuid, phone_number text)`, mirroring `admin_get_user_phone(uuid)`
one-for-one (in-function admin check via `auth.uid()` + `role='admin'`,
`RAISE EXCEPTION 'forbidden'`, `SET search_path = public`,
`GRANT EXECUTE ... TO authenticated`). The three list Server Actions call it ONCE
each with the page's user-id array, then merge phone into their return shapes in
JS — they NEVER add `phone_number` to a `.select()` (PostgREST would raise 42501,
and the existing guard test would fail by design). No grant is widened; no
service-role is introduced into these actions. The own-profile path (Task 3) is
already done via `get_my_phone()` and is verify-only.

---

## 1. Decision 1 — the batch admin-phone read mechanism

### 1.1 Chosen mechanism: new SECURITY DEFINER set-returning function

**Name:** `public.admin_get_user_phones(target_user_ids uuid[])`
**Returns:** `TABLE (user_id uuid, phone_number text)` — one row per matched
profile.

This is the batch sibling of the existing single-row
`admin_get_user_phone(target_user_id uuid)`. It mirrors that function's shape
one-for-one; the ONLY differences are (a) array parameter, (b) set return,
(c) the body selects `id` alongside `phone_number` so the caller can key the
merge.

### 1.2 Copy-pasteable contract (for `backend-developer`)

```sql
CREATE OR REPLACE FUNCTION public.admin_get_user_phones(target_user_ids uuid[])
RETURNS TABLE (user_id uuid, phone_number text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  SELECT p.id, p.phone_number
  FROM public.profiles p
  WHERE p.id = ANY(target_user_ids)
    AND p.deleted_at IS NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_user_phones(uuid[]) TO authenticated;
```

**Contract notes — every clause is load-bearing:**

| Clause | Requirement | Why |
|---|---|---|
| Name | `admin_get_user_phones` (plural) | Distinguishes from the existing singular `admin_get_user_phone`. Both coexist. |
| Param | `target_user_ids uuid[]` | Named exactly this — mirrors `admin_get_user_phone`'s `target_user_id` (plural). Tester may assert `pg_proc.proargnames`. |
| Return | `TABLE (user_id uuid, phone_number text)` | Set-returning. `user_id` is the merge key; `phone_number` is the payload. Column names qualified with table alias `p.` in the body to avoid ambiguity with the OUT parameter names (same defensive pattern as `get_my_demographics` / `admin_get_demographics`). |
| Language | `plpgsql` | Needed for the `RAISE EXCEPTION` admin gate — identical to `admin_get_user_phone` / `admin_get_demographics`. (`get_my_phone` is `sql` because it has no gate; this fn does, so `plpgsql`.) |
| Security | `SECURITY DEFINER` | Runs as the function owner, bypassing the column-level REVOKE on `phone_number`. The admin check inside the function is the authorisation boundary, not the GRANT. |
| `search_path` | `SET search_path = public` | **Exactly `public`** — matches its three siblings (`get_my_phone`, `admin_get_user_phone`, `admin_get_demographics`). Do NOT use the stricter `public, pg_catalog` here. Sibling consistency wins; the search_path hardening retrofit (per `MEMORY.md` → "SECURITY DEFINER search_path hardening") is a separate future PR that will move all four together. Introducing the stricter form on only this one function fragments the pattern. |
| Admin gate | `IF NOT EXISTS (... auth.uid() AND role='admin') THEN RAISE EXCEPTION 'forbidden'` | Byte-for-byte the same gate and the same `'forbidden'` message string as `admin_get_user_phone` and `admin_get_demographics`. The check uses the caller's `auth.uid()`, so the `target_user_ids` parameter cannot be used to spoof admin-ness. |
| Soft-delete filter | `AND p.deleted_at IS NULL` | **This fn filters soft-deleted rows.** See §1.4 for the rationale and the one consequence the backend must handle. |
| NULL handling | A member with `phone_number IS NULL` still returns a row: `(id, NULL)`. A `target_user_ids` entry with no matching live profile returns NO row. | The caller distinguishes "member has no phone" (row present, value null) from "id absent / soft-deleted" (no row) — both collapse to "no phone to show" downstream, but the distinction is available if ever needed. |
| GRANT | `GRANT EXECUTE ... TO authenticated` | Same as siblings. The `authenticated` role may *invoke* the function; the in-body gate is what restricts the *result* to admins. Non-admin invokers get `forbidden`, never data. |
| Empty input | `target_user_ids = '{}'` (empty array) or `NULL` | `id = ANY('{}')` matches nothing → zero rows, no error. The backend should still short-circuit before calling (see §2.4) to save a round-trip, but the function is safe if called with an empty array. |

### 1.3 Why this beats the alternatives

| Alternative | Verdict | Reason |
|---|---|---|
| **N+1 loop over `admin_get_user_phone(uuid)`** | Rejected | The members list is up to ~1,000 rows. One RPC per row is a round-trip storm against PostgREST — unacceptable latency and connection pressure on Vercel serverless. The task brief explicitly calls this out as the gap. |
| **Widen the `authenticated` GRANT to re-include `phone_number`** | Rejected — violates the security model | Would let EVERY logged-in member read EVERY other member's phone over the REST API. This directly reverses `20260503000002` and the whole Phase-3 PII posture. Non-negotiable: do not do this. |
| **Service-role client (`createAdminClient`) inside these actions** | Rejected | The established pattern (`requireAdmin()` returns the user-scoped client; reads go through SECURITY DEFINER fns) deliberately avoids service-role for these reads. Service-role bypasses ALL RLS, so a bug in the action could leak far more than phone. The SECURITY DEFINER fn is scoped to exactly one column + an admin gate — least privilege. Keeps the blast radius identical to the existing `admin_get_demographics` path. |
| **A SQL view `admin_member_phones`** | Rejected | Views don't carry their own auth gate cleanly here; we'd still need RLS or a SECURITY DEFINER wrapper, and PostgREST exposure of a view re-opens the "what can `authenticated` select" question. The function is the smaller, better-understood surface and matches the three siblings exactly. |
| **Single SECURITY DEFINER fn that returns the WHOLE member list incl. phone** | Rejected | Over-couples. `getAdminMembers` already assembles its payload from the narrowed allow-list select + a booking-stats join. Folding phone into a bespoke mega-RPC duplicates that assembly in SQL and diverges from the demographics pattern. Phone is one orthogonal column; fetch it orthogonally. |

**Net:** one new function, one round-trip per surface, zero grant changes, zero
service-role, pattern-identical to what reviewers already trust.

### 1.4 Soft-delete decision (called out explicitly)

`admin_get_user_phones` **filters `deleted_at IS NULL`** (soft-deleted profiles
return no row). Rationale and consequences per surface:

- **`getAdminMembers`** — already filters `.is('deleted_at', null)` on the profile
  query (actions.ts:1730), so its `profileIds` array contains only live profiles.
  The RPC's filter is therefore redundant-but-consistent here. No behaviour change.
- **`getEventBookings`** — filters `bookings.deleted_at IS NULL` but a booking can
  reference a profile that was later soft-deleted (account deletion sets the
  *profile* `deleted_at` but bookings are retained for the event-history record).
  In that case the RPC returns no row for that user_id → the merge yields `null` →
  UI shows "—". This is the **correct and intended** outcome: a deleted member's
  PII should NOT resurface in an admin attendee list. The backend MUST tolerate
  "booking present, no phone row" (it already must, for null-phone members).
- **`exportEventAttendeesCSV`** — same as bookings: deleted-member rows export an
  empty Mobile cell. Correct.

> **One thing the backend must NOT assume:** that every input id yields a row. Build
> the merge as a `Map<user_id, phone>` populated from the RPC result, then look up
> per consuming row with a `?? null` fallback. Never zip-by-index.

### 1.5 Idempotency / rollback

- `CREATE OR REPLACE FUNCTION` — re-runnable cleanly, like every sibling.
- The `GRANT` is naturally idempotent.
- **No table touch, no column touch, no GRANT change on `profiles`.** Catalog-only.
- **Rollback (one line):**
  `DROP FUNCTION IF EXISTS public.admin_get_user_phones(uuid[]);`
  No data loss — the function reads existing data; dropping it only removes the
  admin batch-read path (the singular `admin_get_user_phone` remains as fallback).

---

## 2. Decision 2 — how each Server Action consumes the function

All three live in `src/app/(admin)/admin/actions.ts` and already go through
`requireAdmin()` (actions.ts:70-84), which returns the **user-scoped** client. That
is correct and unchanged — the RPC carries its own admin gate, so calling it on the
user-scoped client is exactly the pattern `admin_get_demographics` already uses.

### 2.0 Shared merge helper (recommended, optional)

To keep the three call sites consistent and DRY, `backend-developer` may add a
small private helper in `actions.ts` (not exported, no new file):

```
// Pseudocode — backend writes the real impl.
async function fetchPhoneMap(
  supabase,                       // the user-scoped client from requireAdmin()
  userIds: string[]
): Promise<Map<string, string | null>> {
  if (userIds.length === 0) return new Map()
  const unique = [...new Set(userIds)]
  const { data, error } = await supabase.rpc('admin_get_user_phones', {
    target_user_ids: unique,
  })
  if (error) throw new Error(`Failed to fetch member phone numbers: ${error.message}`)
  const map = new Map<string, string | null>()
  for (const row of data ?? []) map.set(row.user_id, row.phone_number ?? null)
  return map
}
```

Notes for the implementer:
- `error.message` is interpolated into the thrown message — matches the repo
  convention from `MEMORY.md` → "Admin Server Action error messages" (PR #101).
- De-dupe the ids before the RPC (a member could appear once per booking in
  `getEventBookings`; same id twice is harmless but wasteful).
- The Supabase JS arg key is the SQL parameter name: `target_user_ids`.

The per-action wiring below assumes this helper exists; if the backend inlines it
instead, the contract (one RPC call, Map-based merge, throw on error) is identical.

### 2.1 `getEventBookings` (actions.ts:1568-1598) — ALL statuses

**Current return:** `Promise<<array of booking rows>>` where each row has the
shape selected at 1578-1584, including
`profile: { id, full_name, email, avatar_url }` (an array-or-object join,
normalised elsewhere with `extractJoin`).

**Change:**
1. After the existing query resolves (do NOT touch the `.select()` string — it does
   not select `phone_number` and must not), collect the user ids from each row's
   joined profile. The booking row exposes `profile.id` (already selected at 1583).
   Because the join can be array-or-object, derive the id via the existing
   `extractField<{ id: string }>(b.profile, 'id')` helper (actions.ts:62-68) or
   `extractJoin`.
2. Call `fetchPhoneMap(supabase, ids)`.
3. Merge: attach `phone_number: phoneMap.get(profileId) ?? null` onto each row's
   `profile` object (or onto the row top-level — backend's choice, but **inside
   `profile` is preferred** so the shape stays "profile carries identity+contact").

**Exact merged shape (preferred — phone nested in profile):**
```
{
  id, status, waitlist_position, price_at_booking, booking_fee_pence,
  stripe_fee_pence, booked_at, created_at, stripe_payment_id,
  stripe_refund_id, refunded_amount_pence, cancelled_at, cancellation_reason,
  profile: { id, full_name, email, avatar_url, phone_number: string | null }
}
```

**Round-trips:** original bookings query (1) + one `admin_get_user_phones` (1) = 2
total, independent of attendee count. No N+1.

**TypeScript:** `getEventBookings` currently returns the inferred PostgREST row type
(no named interface). Two acceptable options — backend picks one, tester asserts
whichever ships:
- **Option A (recommended): introduce a named return type.** Add to
  `src/types/index.ts`:
  ```
  /** One booking row for the admin per-event attendees view.
   *  `profile.phone_number` is admin-only PII merged via
   *  admin_get_user_phones(); null when the member set no phone or the
   *  profile was soft-deleted. */
  export interface AdminEventBooking {
    id: string
    status: BookingStatus
    waitlist_position: number | null
    price_at_booking: number
    booking_fee_pence: number
    stripe_fee_pence: number
    booked_at: string
    created_at: string
    stripe_payment_id: string | null
    stripe_refund_id: string | null
    refunded_amount_pence: number | null
    cancelled_at: string | null
    cancellation_reason: string | null
    profile: Pick<Profile, 'id' | 'full_name' | 'email' | 'avatar_url' | 'phone_number'> | null
  }
  ```
  and type the action `Promise<AdminEventBooking[]>`. (Confirm the nullability of
  `stripe_*` / `cancelled_at` / `cancellation_reason` against the bookings table
  when implementing; the brief did not require auditing those, so they are typed
  permissively above. The load-bearing addition is `phone_number` on the `profile`
  Pick.)
- **Option B (lighter): leave the return inferred** and just add `phone_number` to
  the merged object. The attendees UI then reads `booking.profile?.phone_number`.
  Acceptable but loses the compile-time contract; Option A is preferred for a
  demo-visible PII field.

### 2.2 `exportEventAttendeesCSV` (actions.ts:1667-1701) — confirmed-only, ADD "Mobile" column

**Current:** selects `booked_at` + `profile:{ full_name, email }` for
`status = 'confirmed'`, builds a 3-column CSV.

**Scope decision (per brief):** keep **confirmed-only** (parity with current
behaviour). Do NOT broaden to all statuses in this change.

**Change:**
1. The `.select()` already does NOT include `phone_number` — keep it that way. But
   it must now also select `profile.id` so we can key the phone merge (currently it
   selects only `full_name, email`). Change the join to
   `profile:profiles!bookings_user_id_fkey(id, full_name, email)`. (`id` is on the
   `authenticated` allow-list — safe.)
2. After the query, collect `profile.id` per row, call `fetchPhoneMap`.
3. Add `mobile: phoneMap.get(profileId) ?? null` into each mapped row object
   (alongside `name`, `email`, `booked_at`).
4. **CSV column order and headers — exact spec:**

   | Position | Header text | Source | Sanitised? |
   |---|---|---|---|
   | 1 | `Name` | `profile.full_name` | yes (existing) |
   | 2 | `Email` | `profile.email` | yes (existing) |
   | 3 | `Mobile` | merged phone, or `''` if null | **yes — mandatory, see §3** |
   | 4 | `Booked At` | `booking.booked_at` (raw ISO) | no (existing) |

   - Header row becomes exactly: `Name,Email,Mobile,Booked At`
   - **Mobile is inserted as the THIRD column, before `Booked At`.** Rationale:
     contact details (Name, Email, Mobile) group together; the timestamp stays last,
     as today. This is a deliberate, documented column order so the tester can
     assert the exact header string and the reviewer knows the position is intentional.
5. Row construction mirrors the existing quoted-cell style:
   ```
   `"${sanitizeCsvCell(r.name)}","${sanitizeCsvCell(r.email)}","${sanitizeCsvCell(r.mobile ?? '')}","${r.booked_at}"`
   ```
   NULL phone → `r.mobile ?? ''` → an empty quoted cell `""`. See §4.1.

**Return type:** unchanged — still `Promise<string>` (the CSV body). No `types/index.ts`
change for this action.

**Round-trips:** attendees query (1) + one `admin_get_user_phones` (1) = 2 total.

### 2.3 `getAdminMembers` (actions.ts:1705-1804) — merge phone into `MemberWithStats`

**Current:** selects the explicit `authenticated` allow-list (1721-1729, NO
`phone_number`), joins booking counts, and returns
`MemberWithStats[]` via an `as unknown as MemberWithStats` cast (1790-1795). The
cast exists *because* `MemberWithStats extends Profile` requires `phone_number`
but the narrowed select cannot provide it. **This change retires that cast** by
supplying the real value.

**Change:**
1. Leave the `.select()` string EXACTLY as-is (1721-1729). Adding `phone_number`
   here raises 42501 AND fails the existing guard test at
   `src/app/(admin)/admin/__tests__/actions-get-members.test.ts:228-233` — which is
   working as designed. **Do not touch the select.**
2. After `profiles` resolves and `profileIds` is built (1759), call
   `fetchPhoneMap(supabase, profileIds)`. (Same array already used for the bookings
   count query at 1761-1764 — reuse it.)
3. In the final `.map()` (1781-1796), set
   `phone_number: phoneMap.get(p.id) ?? null` on each returned object, and **remove
   the `as unknown as MemberWithStats` cast** — the object now genuinely satisfies
   `MemberWithStats` (it has every `Profile` field the select provided, plus the
   merged `phone_number`, plus the three stats fields).

   > Caveat for the implementer: the narrowed select also omits `gender`,
   > `age_range`, `stripe_customer_id`, `profile_nudge_email_sent_at` — all `Profile`
   > fields. But the **current `Profile` interface (types/index.ts:44-65) does NOT
   > declare `gender`/`age_range`/`stripe_customer_id`/`profile_nudge_email_sent_at`**
   > — it only declares `phone_number` among the revoked set. So once `phone_number`
   > is supplied, the object satisfies the *current* `Profile` shape and the cast can
   > become a plain `satisfies MemberWithStats` / direct typed return. **If** the
   > `Profile` interface is later extended to include those other revoked columns,
   > the cast (or a narrower row type) returns. Document this in the code comment that
   > replaces the existing 1783-1789 comment.

**Updated comment to replace actions.ts:1783-1789 (guidance, backend writes final text):**
> `phone_number` is NOT in the explicit select above (revoked from the
> `authenticated` GRANT in 20260503000002). It is fetched in one batch via the
> `admin_get_user_phones()` SECURITY DEFINER RPC and merged here, so the returned
> object satisfies `MemberWithStats` without the previous `as unknown` cast.

**TypeScript:** NO change to `MemberWithStats` (types/index.ts:317-321) — it already
extends `Profile`, which already declares `phone_number: string | null`. The field
becomes genuinely populated rather than cast-away. The contract delta is
"`MemberWithStats.phone_number` is now reliably present (admin-only), no longer a
cast-hole."

**Round-trips:** profiles query (1) + booking-counts query (1, existing) + one
`admin_get_user_phones` (1) = 3 total, independent of member count. No N+1.

### 2.4 Common rules for all three call sites

- Exactly ONE `admin_get_user_phones` call per action invocation. Never inside a
  loop or `.map()`.
- De-dupe ids before the RPC.
- Short-circuit on empty id set (return early / skip the RPC) — `fetchPhoneMap`
  already does this.
- On RPC error, THROW with `error.message` interpolated (repo convention). The
  `forbidden` exception cannot fire in practice because `requireAdmin()` already
  gated the caller — but if it ever did (e.g. role revoked mid-request), the throw
  surfaces it rather than silently returning blank phones.
- Ordering stability: the RPC does NOT impose an order (it's a `Map` lookup keyed
  by id), so each action keeps its existing `ORDER BY`
  (`getEventBookings`: `created_at asc`; `exportEventAttendeesCSV`: `booked_at asc`;
  `getAdminMembers`: per the `sort` switch). The phone merge is order-neutral.

---

## 3. Decision 3 — CSV-injection safety (CRITICAL — read this loudly)

**Phone numbers begin with `+` (per the CHECK constraint
`phone_number ~ '^\+?[0-9]{10,15}$'`, migration 20260420000001). `+` is a CSV
formula-injection lead character.** A cell like `+447700900123` opened in
Excel/Sheets/Numbers is interpreted as a formula and can execute or display
`#NAME?`/garbage — and in the worst case is a vector for data exfiltration via
spreadsheet formulas.

**Mandatory:** the Mobile cell MUST pass through `sanitizeCsvCell`
(actions.ts:40-43) exactly like `Name` does. This is non-optional.

**What `sanitizeCsvCell` does (verified, actions.ts:40-43):**
```
function sanitizeCsvCell(value: string): string {
  if (/^[=+\-@\t\r]/.test(value)) return `'${value}`
  return value
}
```
It tests the FIRST character against `[=+\-@\t\r]` (equals, plus, minus, at, tab,
carriage-return) and, if it matches, prefixes a single leading apostrophe `'`.

**Expected rendered output for a phone (for the tester to assert):**
- Input phone value: `+447700900123`
- `sanitizeCsvCell('+447700900123')` → `'+447700900123` (leading apostrophe added,
  because the first char `+` matches the class).
- Wrapped into the CSV cell by the row builder: `"'+447700900123"`.
- A spreadsheet app reads the leading `'` as the "treat-as-text" prefix and renders
  the cell as the literal text `+447700900123`, NOT a formula. The apostrophe is a
  display/format directive and is not shown as data.
- A phone stored WITHOUT the leading `+` (e.g. `447700900123`) starts with a digit,
  does NOT match the class, and passes through unchanged → cell `"447700900123"`.

**Tester assertions (explicit):**
1. For a confirmed attendee whose `phone_number` starts with `+`, the CSV row's
   Mobile cell equals `"'+<digits>"` (apostrophe-guarded). The reviewer should treat
   the apostrophe as intentional, not a bug.
2. For a confirmed attendee with `phone_number = NULL`, the Mobile cell is `""`
   (empty) — see §4.1.
3. The header row is exactly `Name,Email,Mobile,Booked At`.

> Reviewer note: do NOT "clean up" the apostrophe in a later refactor. It is the
> injection guard. Removing it reopens a formula-injection hole on an admin-exported
> file containing member PII.

---

## 4. Decision 4 — edge cases

### 4.1 NULL phone (members who never set one)
- The `phone_number` column is nullable; many members will have NULL.
- RPC returns a row `(id, NULL)` for a live member with no phone.
- **UI (attendees list, members list):** `phone_number` arrives as `null`. Per the
  product/UX convention the ux-designer renders null as an em-dash "—". This doc
  guarantees the DATA is `null` (not `''`, not the string `"null"`); rendering is
  the ux-designer's call.
- **CSV:** null → empty quoted cell `""` (via `r.mobile ?? ''` before
  `sanitizeCsvCell`). `sanitizeCsvCell('')` returns `''` (empty string does not
  match the lead-char class), so the cell is `""`. No phantom apostrophe on empty
  cells.

### 4.2 Soft-deleted profiles
- Covered in §1.4. The RPC filters `deleted_at IS NULL`, so soft-deleted members
  yield NO row → merge → `null` → "—" in UI / empty in CSV. A deleted member's PII
  does not resurface. The backend's Map-with-fallback merge handles the missing row
  transparently.

### 4.3 Ordering stability
- The merge is a keyed `Map` lookup, order-neutral. Each action retains its existing
  `ORDER BY`. Adding phone changes neither the row set nor its order. (§2.4.)

### 4.4 Single DB round-trip per surface (no N+1)
- Each action makes exactly ONE `admin_get_user_phones` call with the full id array.
  Round-trip counts: `getEventBookings` = 2, `exportEventAttendeesCSV` = 2,
  `getAdminMembers` = 3 (it has a pre-existing second query for booking counts).
  All counts are independent of row count. Verified against actions.ts as it stands.

### 4.5 Duplicate ids
- `getEventBookings` can list the same user across multiple bookings (rare, but a
  user could have a cancelled + a confirmed row). De-dupe before the RPC (§2.0).
  Duplicate ids in `id = ANY(array)` are harmless server-side; de-duping is purely
  to keep the array tight.

### 4.6 The `forbidden` exception path
- Cannot fire in normal flow (`requireAdmin()` already verified the caller is an
  admin before the RPC runs). If it ever fires (role changed mid-request, or the fn
  is called from a future non-admin context), the action THROWS — correct fail-closed
  behaviour. No blank-phone fallback that could mask an authz regression.

---

## 5. Decision 5 — Task 3 (own-profile read): VERIFY-ONLY, do NOT redesign

The member's own-profile phone read is **already implemented** and must NOT be
re-architected. Confirmed in the codebase:
- `get_my_phone()` SECURITY DEFINER exists
  (`20260503000002_narrow_phone_number_grant.sql:81-92`).
- Wrapper `getMyPhone(): Promise<string | null>` exists at
  `src/lib/supabase/queries/profile.ts:128-137` and calls
  `supabase.rpc('get_my_phone')`.
- The profile page consumes it at `src/app/(member)/profile/page.tsx:46` and merges
  it back as `profile.phone_number` at line 57 (`profileWithPhone`), so downstream
  components (`ProfileHeader`, `EditProfileForm`) read `profile.phone_number`
  unchanged.
- `ProfileForm` edits `phone_number` via the own-row UPDATE path (column-level
  UPDATE permission was never revoked — only SELECT was).
- `preferences-actions.ts` and `privacy-actions.ts` also compose `get_my_phone()`
  (grep-confirmed at preferences-actions.ts:118, privacy-actions.ts:86).

**What the tester / frontend should CONFIRM (no new code expected):**
1. On the member profile page, a member who has set a phone sees their own phone
   number displayed (value flows `get_my_phone()` → `getMyPhone()` →
   `profileWithPhone.phone_number` → UI). There is an existing test asserting this:
   `src/lib/supabase/__tests__/migration-w1-demographics.test.ts:652` ("renders
   profile.phone_number when populated").
2. A member can edit and save their phone via `ProfileForm` and the value persists
   (own-row UPDATE).
3. A member CANNOT see another member's phone anywhere (no admin surface is exposed
   to non-admins; the new RPC's `forbidden` gate enforces this server-side).

**Architect verdict:** Task 3 requires zero new schema and zero new application
code. It is satisfied by the existing `get_my_phone()` path. Mark it DONE pending
the three confirmations above.

---

## 6. Anon-visibility decision (per CLAUDE.md rule) — NO CHANGE

- `phone_number` was REVOKED from `anon` in `20260420000003` and from
  `authenticated` (column-level) in `20260503000002`. **This change adds NOTHING to
  either grant.**
- The ONLY new exposure is the SECURITY DEFINER function
  `admin_get_user_phones(uuid[])`, which gates on `role='admin'` and exposes phone
  to ADMINS ONLY. Anon and non-admin `authenticated` callers receive `forbidden`,
  never data.
- No new column is added to `public.profiles`, so the CLAUDE.md "new column
  anon-visibility" rule is satisfied vacuously (nothing to decide — there is no new
  column). The migration header should still state, for the record: "Anon and
  authenticated GRANTs on `public.profiles` are UNCHANGED. Phone remains revoked from
  both. Admin batch read is via SECURITY DEFINER only."

---

## 7. Migration plan

- **Single new migration file.** Suggested name (repo convention
  `YYYYMMDDHHMMSS_name.sql`):
  ```
  supabase/migrations/20260602000001_admin_get_user_phones_batch.sql
  ```
  (Pick the next available `YYYYMMDDHHMMSS` ahead of the latest applied migration at
  implementation time; `20260602000001` reflects today's date 2026-06-02. If a
  later-dated migration already exists, bump accordingly — migrations must sort after
  all prior ones.)

- **Migration contents:** the single `CREATE OR REPLACE FUNCTION` + `GRANT EXECUTE`
  from §1.2, plus a header comment block matching the house style (purpose, pattern
  source = "batch sibling of `admin_get_user_phone` in 20260503000002", anon/auth
  GRANT-unchanged statement, soft-delete-filter note, idempotency, one-line rollback).

- **Dependency order:** depends ONLY on `public.profiles.phone_number` (exists since
  20260420000001) and `public.profiles.role`/`deleted_at` (long-standing). No
  ordering constraint beyond "after 20260503000002" — which any later timestamp
  satisfies. No data migration, no backfill.

- **Rollback (one line):**
  `DROP FUNCTION IF EXISTS public.admin_get_user_phones(uuid[]);`

- **Prod apply step (FLAG FOR THE HUMAN — not for the agent to run):** Per
  `MEMORY.md` → "Migrations need manual `supabase db push` to prod", CI applies
  migrations to the LOCAL Supabase only. After this PR merges, a human must run
  `supabase db push --include-all --linked` against prod to apply
  `20260602000001_admin_get_user_phones_batch.sql`. The architect does NOT run this.

---

## 8. Dependency map (what must be built before what)

```
[migration 20260602...admin_get_user_phones_batch.sql]   ← build FIRST
        │  (creates admin_get_user_phones + grant)
        ▼
[actions.ts: fetchPhoneMap helper]                       ← then
        │
        ├──▶ [getEventBookings merge]            (independent)
        ├──▶ [exportEventAttendeesCSV merge]     (independent)
        └──▶ [getAdminMembers merge + drop cast] (independent)
        │
        ▼
[types/index.ts: AdminEventBooking (Option A only)]      ← with getEventBookings
        │
        ▼
[ux-designer: render phone in attendees + members UI]    ← PARALLEL (data null contract is fixed)
[tester: contract tests §9]                              ← after backend
```

- The three merges are mutually independent and can land in one PR or be split.
- The ux-designer can work in parallel because the data contract ("phone is
  `string | null`; null renders as —") is fixed by this spec, regardless of merge
  internals.

---

## 9. Acceptance criteria / risks for tester & reviewer

### 9.1 Tester — assert these
1. **Function exists with exact shape:** `admin_get_user_phones(target_user_ids uuid[])`
   `RETURNS TABLE(user_id uuid, phone_number text)`, `SECURITY DEFINER`,
   `SET search_path = public`, `LANGUAGE plpgsql`, parameter named
   `target_user_ids`, `GRANT EXECUTE ... TO authenticated`. (Mirror the existing
   pg_proc/regex-on-migration test style in
   `src/lib/supabase/__tests__/migration-w1-demographics.test.ts:246-292`; add the
   plural fn to that suite's coverage.)
2. **Admin gate:** the migration body contains the `RAISE EXCEPTION 'forbidden'`
   gate identical to `admin_get_user_phone` (string match `'forbidden'`).
3. **Soft-delete filter present:** body contains `deleted_at IS NULL`.
4. **Guard test still green:** `actions-get-members.test.ts:228-233` (no revoked
   column in the `getAdminMembers` select) MUST still pass — i.e. `phone_number` is
   NOT in the select string. This is the proof the merge goes through the RPC, not
   the select.
5. **`getAdminMembers` merge:** mock `admin_get_user_phones` to return
   `[{user_id, phone_number}]`; assert the returned `MemberWithStats[]` carries the
   merged `phone_number`, and that exactly ONE `rpc('admin_get_user_phones', ...)`
   call is made (not per-row).
6. **`getEventBookings` merge:** assert merged `profile.phone_number` per row; one
   RPC call; null for a user the RPC didn't return.
7. **CSV:** header is exactly `Name,Email,Mobile,Booked At`; a `+`-leading phone
   renders as `"'+<digits>"` (apostrophe-guarded); null phone renders as `""`;
   Mobile is column 3.
8. **Own-profile (Task 3):** verify-only — the existing
   `migration-w1-demographics.test.ts:652` and `getMyPhone` wiring tests
   (516-537) remain green; no new own-profile code expected.

### 9.2 Reviewer — watch for
- **`phone_number` must never enter any `.select()` string** in the three actions.
  If a future diff "helpfully" adds it, the guard test fails — keep it failing.
- **The CSV apostrophe guard is intentional** (§3). Do not strip it.
- **No service-role** (`createAdminClient`) introduced into these three actions.
  They stay on the `requireAdmin()` user-scoped client + the SECURITY DEFINER RPC.
- **`search_path = public`** on the new fn (not `public, pg_catalog`) — sibling
  consistency is deliberate (§1.2).
- **The `as unknown as MemberWithStats` cast is removed** in `getAdminMembers` only
  if `phone_number` is genuinely merged; if the backend keeps the cast for
  belt-and-braces, that is acceptable but the comment must explain why.

### 9.3 Open questions / risks needing a human decision
1. **CSV Mobile column position.** Spec pins it as column 3 (Name, Email, **Mobile**,
   Booked At). If the product owner has an existing downstream CSV consumer that
   parses by fixed column index, inserting a column mid-row could break it. LOW risk
   for a demo, but FLAG: confirm no external tool ingests this CSV by position. If
   uncertain, the safe alternative is to APPEND Mobile as the LAST column
   (`Name,Email,Booked At,Mobile`) — equally valid; the architect chose contact-
   grouping for human readability. **Backend should default to column-3 unless the
   product owner says otherwise.**
2. **`getEventBookings` return-type option.** A (named `AdminEventBooking`) vs B
   (inferred). Recommended A for a PII field. Backend/reviewer to confirm; the
   nullability of the non-phone fields in Option A is a best-guess and should be
   reconciled with the `bookings` table when typing.
3. **Demographics parity (out of scope, noted).** The exact same batch gap exists
   for `gender`/`age_range` if the admin list ever needs them in bulk
   (`admin_get_demographics` is also single-row). NOT in scope here. If the product
   owner later wants demographics in the members list, mirror this spec with an
   `admin_get_demographics_batch(uuid[])`. Flagged so it is a conscious future
   decision, not a surprise.
4. **Throughput at ~1,000 ids.** `id = ANY(uuid[])` with ~1,000 elements is fine for
   Postgres and within PostgREST's RPC body limits. No pagination needed at demo
   scale. If the member base grows past tens of thousands, revisit (paginate the
   members list itself first — that is the real bound, not the phone RPC).
