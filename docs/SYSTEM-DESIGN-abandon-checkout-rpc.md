# SYSTEM DESIGN — `abandon_pending_checkout` RPC

**Status:** proposed (spec only — not implemented)
**Author:** architect
**Resolves:** conflict between the `abandonPendingCheckout` P0 tampering fix
(`src/app/events/[slug]/actions.ts`) and
`supabase/migrations/20260812171530_revoke_bookings_admin_hold_column_write.sql`
**Related docs:** none pre-existing for this function; see the security
comment block above `abandonPendingCheckout` (lines ~586–658) and the header
of `20260812171530_revoke_bookings_admin_hold_column_write.sql` for the two
prior fixes this spec reconciles.

---

## 1. Problem recap

Three fixes deep on one function:

1. **Fix 1** made `abandonPendingCheckout`'s rollback decision (`confirmed` /
   `waitlisted` / `cancelled`) derive from the booking row's own
   `is_admin_hold`, `cancelled_at`, `waitlist_position` columns instead of a
   client-supplied `?from=` URL param (closed a free-ticket exploit).
2. **Fix 1's own gap**: those three columns had no column-level GRANT
   protection, so a member could `PATCH` their own row's `is_admin_hold` via
   the Supabase REST API and reach the same outcome through a different
   door.
3. **Fix 2** (`20260812171530_revoke_bookings_admin_hold_column_write.sql`)
   closes that door: `REVOKE UPDATE (is_admin_hold, admin_hold_expires_at)
   ON public.bookings FROM authenticated, anon;`
4. **The conflict**: `abandonPendingCheckout`'s own UPDATE unconditionally
   names both revoked columns in its SET clause on *every* call (not just
   admin-hold ones), via the user-scoped client. Postgres checks
   column-level UPDATE privilege against every column named in SET
   regardless of whether the value is actually changing. Once Fix 2 lands,
   every abandon call — including ordinary self-service ones — gets a
   permission-denied error. Fix 2 breaks Fix 1.

`abandonPendingCheckout` is also the only booking-state-transition in this
codebase implemented as a plain TS SELECT-then-UPDATE via the user-scoped
client. Every sibling (`book_event`, `book_event_paid`,
`claim_waitlist_spot`, `admin_promote_waitlist_to_hold`,
`admin_hold_confirmed_booking_for_payment`,
`admin_reinstate_cancelled_booking_for_payment`,
`admin_revert_hold_to_waitlist`) is a `SECURITY DEFINER` RPC that does its
own lookup + branch + atomic UPDATE server-side. Bringing
`abandonPendingCheckout` in line with that pattern resolves both the
column-grant conflict (a `SECURITY DEFINER` function executes as its owner,
unaffected by a REVOKE against `authenticated`/`anon`) and the
already-flagged, non-blocking SELECT-then-UPDATE race condition (closed by
wrapping the whole thing in one `FOR UPDATE`-locked transaction).

---

## 2. New RPC: `public.abandon_pending_checkout(p_user_id uuid, p_event_id uuid) RETURNS jsonb`

### 2.1 Branch logic — ported 1:1, no changes

Source: `abandonPendingCheckout`'s security comment,
`src/app/events/[slug]/actions.ts` lines ~616–658, and the live branch at
lines 704–717. All rows considered here already satisfy
`status = 'pending_payment'`.

| `is_admin_hold` | `cancelled_at` | `waitlist_position` | Origin | Rollback |
|---|---|---|---|---|
| `false` | — | `NULL` | fresh 'book' | `cancelled` |
| `false` | — | NOT NULL | self-service 'claim' | `waitlisted` |
| `true` | NOT NULL | — | `admin_reinstate` (Gap C) | `cancelled` (preserve existing `cancelled_at`) |
| `true` | `NULL` | NOT NULL | `admin_hold` (waitlist promo, Gap 0) | `waitlisted` |
| `true` | `NULL` | `NULL` | `admin_remediation` (Gap A) | `confirmed` |

Safe default (unreachable by the RPC's own guard, but preserved as the
`ELSE` for defence in depth exactly as in the TS version): `cancelled`.

### 2.2 Full migration SQL

New file, e.g.
`supabase/migrations/20260812180000_abandon_pending_checkout_rpc.sql`
(timestamp must sort after Fix 2's `20260812171530` — see §7 for why
ordering between the two files doesn't matter functionally but should still
be chronological):

```sql
-- Migration: abandon_pending_checkout_rpc
--
-- Replaces the direct TS SELECT-then-UPDATE in abandonPendingCheckout
-- (src/app/events/[slug]/actions.ts) with a SECURITY DEFINER RPC,
-- bringing this function in line with every other booking-state-
-- transition in this codebase (book_event, book_event_paid,
-- claim_waitlist_spot, admin_promote_waitlist_to_hold,
-- admin_hold_confirmed_booking_for_payment,
-- admin_reinstate_cancelled_booking_for_payment,
-- admin_revert_hold_to_waitlist).
--
-- ── Why this migration exists ───────────────────────────────────────────
-- 1. Race condition (secondary, non-blocking finding from the
--    abandonPendingCheckout code review): the TS implementation did a
--    SELECT then a separate UPDATE via the user-scoped client — two
--    round trips, no row lock between them. `FOR UPDATE` here closes
--    that gap by doing the read, the branch, and the write inside one
--    transaction under a row lock.
-- 2. Blocking conflict with
--    20260812171530_revoke_bookings_admin_hold_column_write.sql: that
--    migration revokes UPDATE on (is_admin_hold, admin_hold_expires_at)
--    from `authenticated`/`anon` to close a direct-PATCH tampering
--    vector. abandonPendingCheckout's own UPDATE unconditionally
--    includes both columns in its SET clause on every call (to clear an
--    admin hold as part of cleanup), so once that REVOKE lands the
--    self-service abandon flow breaks for 100% of callers, not just the
--    admin-hold ones. A SECURITY DEFINER function executes as its owner
--    and is immune to that REVOKE, so moving the whole
--    lookup+branch+write inside one resolves both problems at once.
--
-- ── Branch logic ─────────────────────────────────────────────────────────
-- See docs/SYSTEM-DESIGN-abandon-checkout-rpc.md §2.1 for the full
-- derivation table — ported 1:1 from the pre-existing TS security
-- comment. Nothing about the derivation changes; only WHERE it runs
-- (SQL instead of TS) and WHEN the read + write happen (one locked
-- transaction instead of two round trips).
--
-- ── search_path posture ───────────────────────────────────────────────
-- SET search_path = public — matches book_event / book_event_paid /
-- claim_waitlist_spot / the admin-hold RPC family. The stricter
-- `public, pg_catalog` posture used by reap_stale_pending_bookings is a
-- separate hardening PR; mixing it into this fix would conflate
-- hardening with the bug fix — same reasoning documented in
-- 20260517000002_book_event_paid_with_fee.sql.
--
-- ── Relationship to 20260812171530_revoke_bookings_admin_hold_column_write.sql ──
-- That migration's REVOKE needs NO changes and must ship in the SAME PR
-- / same `supabase db push --include-all --linked` run as this one —
-- see docs/SYSTEM-DESIGN-abandon-checkout-rpc.md §7. Neither migration
-- alone is safe to deploy to prod without the other once the
-- accompanying actions.ts change also lands.
--
-- ── Idempotency ──────────────────────────────────────────────────────────
-- CREATE OR REPLACE FUNCTION — safe to re-run. REVOKE/GRANT are
-- idempotent at the catalog level.
--
-- ── Post-merge ───────────────────────────────────────────────────────────
-- CI applies migrations to local Supabase only. After merge run manually:
--   supabase db push --include-all --linked

CREATE OR REPLACE FUNCTION public.abandon_pending_checkout(
  p_user_id  uuid,
  p_event_id uuid
)
RETURNS jsonb AS $$
DECLARE
  v_booking_id       uuid;
  v_is_admin_hold    boolean;
  v_cancelled_at     timestamptz;
  v_waitlist_pos     integer;
  v_rollback_status  booking_status;
BEGIN
  IF p_user_id != auth.uid() THEN
    RETURN jsonb_build_object('error', 'Unauthorised');
  END IF;

  -- Lock the caller's own pending_payment row for this event (if any).
  -- idx_bookings_active (partial unique on (user_id, event_id) WHERE
  -- status != 'cancelled') guarantees at most one non-cancelled row per
  -- (user_id, event_id), so this can never match more than one row.
  SELECT id, is_admin_hold, cancelled_at, waitlist_position
  INTO   v_booking_id, v_is_admin_hold, v_cancelled_at, v_waitlist_pos
  FROM   public.bookings
  WHERE  user_id  = p_user_id
    AND  event_id = p_event_id
    AND  status   = 'pending_payment'
    AND  deleted_at IS NULL
  FOR UPDATE;

  -- Nothing to do — already resolved (paid via webhook, already
  -- abandoned by a prior call, or never existed). Idempotent no-op,
  -- matches the pre-existing TS behaviour of returning success with no
  -- status.
  IF v_booking_id IS NULL THEN
    RETURN jsonb_build_object('booking_id', NULL, 'status', NULL);
  END IF;

  IF v_is_admin_hold THEN
    IF v_cancelled_at IS NOT NULL THEN
      v_rollback_status := 'cancelled';   -- admin_reinstate (Gap C)
    ELSIF v_waitlist_pos IS NOT NULL THEN
      v_rollback_status := 'waitlisted';  -- admin_hold (waitlist promo)
    ELSE
      v_rollback_status := 'confirmed';   -- admin_remediation (Gap A)
    END IF;
  ELSIF v_waitlist_pos IS NOT NULL THEN
    v_rollback_status := 'waitlisted';    -- self-service claim
  ELSE
    v_rollback_status := 'cancelled';     -- fresh self-service book (safe default)
  END IF;

  -- cancelled_at: set only on the freshly-cancelled branch, and only if
  -- not already set (admin_reinstate rows already carry a historical
  -- cancelled_at that must be preserved, not overwritten with now() —
  -- see admin_release_reinstated_hold_to_cancelled's own convention in
  -- 20260808000003_admin_reinstate_cancelled_booking_rpcs.sql).
  UPDATE public.bookings
  SET    status                = v_rollback_status,
         is_admin_hold         = false,
         admin_hold_expires_at = NULL,
         cancelled_at          = CASE
           WHEN v_rollback_status = 'cancelled' AND cancelled_at IS NULL
             THEN now()
           ELSE cancelled_at
         END
  WHERE  id     = v_booking_id
    AND  status = 'pending_payment';

  RETURN jsonb_build_object(
    'booking_id', v_booking_id,
    'status',     v_rollback_status
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.abandon_pending_checkout(uuid, uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.abandon_pending_checkout(uuid, uuid) TO authenticated;
```

Notes on fidelity to the TS version:

- The final `WHERE id = v_booking_id AND status = 'pending_payment'` guard
  on the UPDATE is now provably redundant (the `FOR UPDATE` lock means no
  other transaction can change `status` between the SELECT and the UPDATE)
  but is kept anyway as cheap, self-documenting defence in depth — same
  spirit as the belt-and-braces `.eq('status', 'pending_payment')` in the
  original TS `.update()` call.
- `p_user_id != auth.uid()` is checked exactly like every sibling RPC
  (`book_event_paid`, `claim_waitlist_spot`, etc.) even though the
  `WHERE user_id = p_user_id` filter in the SELECT is already sufficient on
  its own — this is the established repo convention, not new defence.
- The RPC does **not** accept an `options.from`-equivalent parameter. Per
  the existing TS security comment ("Do NOT reintroduce a shortcut that
  branches on `options.from`"), that hint must never influence the
  authorization/rollback decision — keeping it out of the SQL signature
  entirely makes that structurally impossible, not just documented.

### 2.3 Bonus fix confirmed: race condition closed

Confirmed. The prior TS implementation was `SELECT` (via `createServerClient()`,
no lock) → branch in application code → separate `UPDATE` — two round trips
with a window in between where a concurrent request (e.g. a double-fired
"back" navigation, or the Stripe webhook confirming payment) could change
the row's `status` between the read and the write. The RPC does `SELECT ...
FOR UPDATE` and the branch and the `UPDATE` inside one Postgres function
invocation, which runs as a single transaction — no other transaction can
read a consistent snapshot of the locked row until this one commits or
rolls back. This closes the "residual, believed-safe-but-not-ideal" race
the code-reviewer flagged as a non-blocking secondary concern on the
original P0 fix.

---

## 3. `search_path` posture

`SET search_path = public` — confirmed as the correct choice by direct
precedent. `book_event_paid` / `claim_waitlist_spot`
(`supabase/migrations/20260517000002_book_event_paid_with_fee.sql`, header
comment lines 27–33) explicitly chose to **keep** `search_path = public`
rather than adopt the stricter `public, pg_catalog` posture used by
`reap_stale_bookings`, stating: *"keeping these consistent with the
book_event / book_event_paid / claim_waitlist_spot precedents avoids mixing
hardening with feature work."* The same reasoning applies here —
`abandon_pending_checkout` is a bug fix (resolving the Fix1/Fix2 conflict),
not a hardening PR. A dedicated `SET search_path = public, pg_catalog`
retrofit across `book_event`, `book_event_paid`, `claim_waitlist_spot`, and
the admin-hold RPC family remains tracked separately (see
`project_security_definer_search_path_hardening` in the maintainer's
memory) and should pick up this new function too when it happens, in one
batch, for consistency.

---

## 4. TypeScript contract — what stays vs what moves

`abandonPendingCheckout` becomes a thin wrapper. Everything below the
`export async function abandonPendingCheckout(...)` line changes; the
exported signature, `ActionResult` shape, and every caller
(`BookingCancelledHandler.tsx`) are unchanged.

**Stays in TypeScript:**
- `eventId` presence validation (unchanged, returns `{success:false, error:'Event ID is required'}`).
- `options?.from` parameter — **kept**, but purely as a post-response
  diagnostics comparison (not pre-response branching input). After the RPC
  returns, compare its returned `status` against
  `inferredStatusForFromHint(options.from)` (existing helper, unchanged)
  and `console.warn` on mismatch — same diagnostic behaviour as today,
  just computed against the RPC's real output instead of a TS-derived
  value.
- Auth check via `supabase.auth.getUser()` (unchanged — still required so
  we have `user.id` to pass as `p_user_id`; the RPC's own
  `p_user_id != auth.uid()` check is defence in depth, matching every
  sibling Server Action / RPC pair in this file).
- `revalidatePath('/events')` / `revalidatePath('/bookings')` calls —
  unchanged, unconditional (both branches: booking found and not found).
- Error message mapping: RPC transport error (`rpcError`) → generic
  `'Could not release the booking'` (same copy as today's `fetchError`/
  `error` branches). `result.error` key from the RPC (e.g.
  `'Unauthorised'`) → passed through as `{success:false, error: result.error}`.

**Moves to SQL (deleted from TS):**
- The `SELECT ... eq('status','pending_payment')` row fetch.
- The `is_admin_hold` / `cancelled_at` / `waitlist_position` branch
  (`if/else if/else` block, lines ~704–717).
- The `updatePayload` object construction and the `.update()` call
  (lines ~729–766), including the unconditional `is_admin_hold: false,
  admin_hold_expires_at: null` clear that is the root cause of the Fix 2
  conflict.

**New call shape:**

```
const { data, error } = await supabase.rpc('abandon_pending_checkout', {
  p_user_id: user.id,
  p_event_id: eventId,
})
```

**Response mapping:**
- `error` (transport-level) → `{ success: false, error: 'Could not release the booking' }`, `console.error` logged (same as today).
- `data.error` (RPC business-logic error, e.g. `'Unauthorised'`) → `{ success: false, error: data.error }`.
- `data.status === null` (not-found / idempotent no-op) → `{ success: true }` — **no** `status` key, preserving today's exact shape for this branch (`BookingCancelledHandler` falls through to its default toast copy either way, so this is behaviour-preserving, not just shape-preserving).
- `data.status` is one of `'confirmed' | 'waitlisted' | 'cancelled'` → `{ success: true, status: data.status }`, then run the `options.from` diagnostic comparison described above.

`inferredStatusForFromHint` stays as-is (pure function, no DB access) —
still useful for the diagnostic, just invoked slightly later in the
control flow (after the RPC call resolves rather than after the TS branch
resolves).

---

## 5. GRANT

```sql
REVOKE EXECUTE ON FUNCTION public.abandon_pending_checkout(uuid, uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.abandon_pending_checkout(uuid, uuid) TO authenticated;
```

Mirrors `book_event_paid(uuid, uuid, integer)`'s exact grant pattern
(`20260517000002_book_event_paid_with_fee.sql` lines 175–176) and
`claim_waitlist_spot`'s. No grant to `anon` — abandoning a checkout requires
an authenticated session (the flow only exists after a logged-in user
started a Stripe Checkout).

---

## 6. Does Fix 2's migration need changes?

**No. Confirmed — the REVOKE statement itself is correct and complete
as-is, no SQL edit required.**

Reasoning: Fix 2's REVOKE targets the `authenticated`/`anon` Postgres
roles. Once `abandonPendingCheckout` no longer performs *any* direct
table UPDATE naming `is_admin_hold` / `admin_hold_expires_at` via the
user-scoped client (all such writes move inside
`abandon_pending_checkout`, a `SECURITY DEFINER` function that executes as
its **owner**, not as `authenticated`), the REVOKE has zero effect on the
new RPC's ability to clear those columns — and continues to correctly
block the original tampering vector (a member directly `PATCH`-ing their
own row's `is_admin_hold` via the REST API outside of any booking-flow
interaction). That direct-PATCH vector is independent of whether
`abandonPendingCheckout` is implemented as an RPC or not — it's a separate
write path, and the REVOKE is the only thing that closes it. The RPC and
the REVOKE are complementary, not overlapping: the RPC needs the REVOKE
gone from its *own* write (which SECURITY DEFINER already grants it), and
the platform still needs the REVOKE in place to block the *unrelated*
direct-PATCH path.

One **non-blocking, optional** follow-up: Fix 2's migration header (lines
121–143) contains a "KNOWN OPEN RISK" section describing exactly the
conflict this spec resolves, ending with *"must be resolved ... before
this migration is deployed alongside the current `abandonPendingCheckout`
implementation... routing back to code-reviewer/architect before merge."*
That section will be stale once this RPC ships. Since this migration file
has **not yet been merged to `main`** (per the task framing — it is "just
landed" on this branch, "NOT yet mergeable"), it is not yet subject to the
"never modify an already-applied migration" rule (`social-seen-safety-SKILL.md`),
so whoever implements this (backend-developer) may either (a) append a short
"RESOLVED — see abandon_pending_checkout_rpc.sql / docs/SYSTEM-DESIGN-abandon-checkout-rpc.md"
note to that section, or (b) leave it untouched as an accurate
point-in-time record and let the new migration's header do the
cross-referencing (as drafted in §2.2 above). Either is fine; this is a
documentation-only decision with no functional impact — flagging it so it
isn't silently forgotten, not mandating either option.

---

## 7. Sequencing recommendation

**Ship both migration files in the same PR as the `actions.ts` change,
merge together, and run `supabase db push --include-all --linked` once,
immediately after merge.** Do not merge Fix 2's REVOKE migration to `main`
on its own.

Reasoning:

- **Migration-internal ordering is irrelevant.** The two files touch
  independent catalog objects — a column-level REVOKE on `public.bookings`
  vs. a new `CREATE FUNCTION` + its own `GRANT EXECUTE`. Neither statement
  depends on the other having run first; `supabase db push` applies
  pending migrations in filename (timestamp) order, and either order
  produces the same end state. Keep them as **two separate files** (not
  merged into one) — consistent with this repo's one-concern-per-migration
  convention (e.g. the admin-hold column/RPC/cron split across
  `20260713000001`/`002`/`003` despite being tightly coupled), and because
  rewriting Fix 2's already-well-documented, self-contained header to
  absorb unrelated `CREATE FUNCTION` content would blur its audit trail
  for no benefit.
- **What DOES matter is that neither migration reaches `main` (and
  therefore an eventual `supabase db push --include-all --linked`) without
  the other, and without the matching `actions.ts` change landing in the
  same Vercel deploy.** Three states are possible if these are staggered,
  and two of them are bad:
  - *REVOKE alone in prod, RPC + new `actions.ts` not yet deployed*: every
    call to the currently-deployed `abandonPendingCheckout` gets a
    permission-denied error on its own UPDATE — a self-inflicted outage on
    every "back from Stripe" flow, for both free and paid events, until
    the rest of the fix ships. **This is the exact regression Fix 2's own
    migration header already flags as its blocking open risk.**
  - *RPC + new `actions.ts` in prod, REVOKE not yet applied*: functionally
    works (the RPC's SECURITY DEFINER write is unaffected either way), but
    the original tampering vector (direct `PATCH` of `is_admin_hold`
    outside any booking-flow call) is still open — no regression, but the
    security fix isn't actually complete yet.
  - *Both together*: correct end state, no window where either problem
    exists.
  - Given this repo's manual-`db push` deploy convention (Vercel
    auto-deploys the app on merge to `main`, near-instantly; the DB
    migration push is a separate manual step run *after* merge per the
    maintainer's own process note), landing both migration files in the
    same PR/commit as the `actions.ts` change and running `db push`
    promptly after merge is the only way to avoid the outage scenario.
    There is no safe way to stagger these two migrations across two
    separate `db push` runs.
- Recommended new migration filename:
  `supabase/migrations/20260812180000_abandon_pending_checkout_rpc.sql`
  (chronologically after Fix 2's `20260812171530`, reflecting authorship
  order — not a functional requirement, just good audit-trail hygiene).

---

## 8. Impact summary

| File | Change |
|---|---|
| `supabase/migrations/20260812171530_revoke_bookings_admin_hold_column_write.sql` | No SQL change. Optional doc-only header update (§6). |
| `supabase/migrations/20260812180000_abandon_pending_checkout_rpc.sql` (new) | New `SECURITY DEFINER` RPC per §2.2. |
| `src/app/events/[slug]/actions.ts` | `abandonPendingCheckout` rewritten to call the RPC per §4. `inferredStatusForFromHint` unchanged. All other exports in this file (`createBooking`, `createPaidCheckout`, `claimWaitlistSpot`, `cancelBooking`, `leaveWaitlist`) untouched. |
| `src/components/events/BookingCancelledHandler.tsx` | No change — `ActionResult.status` contract is preserved exactly. |

No RLS policy changes. No new table columns. No changes to `bookings`
CHECK constraints (`chk_bookings_admin_hold_requires_pending_payment` /
`chk_bookings_admin_hold_expiry_requires_flag` are already satisfied by the
RPC's UPDATE — every branch either leaves `status` at a value where
`is_admin_hold = false` trivially satisfies both constraints, exactly as
the current TS UPDATE payload already does).

---

## 9. Risks / open questions for implementation

- **Local testing gap**: like Fix 2, this cannot be verified against a live
  Supabase instance in a sandboxed environment without Docker. Standard
  mitigation applies: implement, run `pnpm tsc --noEmit && pnpm lint &&
  pnpm build`, get a code-reviewer pass, then a human runs `supabase db
  push --include-all --linked` after merge and manually verifies:
  - `SELECT proname FROM pg_proc WHERE proname = 'abandon_pending_checkout';` exists.
  - A real abandon-flow smoke test (start a paid checkout, hit Stripe's
    "back" link, confirm the booking rolls back to `cancelled` and the
    toast copy is correct) against a staging/preview environment if one
    exists, or manually via the Supabase SQL editor calling the RPC as a
    test user.
- **Test coverage**: this function currently has no dedicated test file
  found in this pass (not confirmed exhaustively — worth the tester
  agent checking `src/app/events/[slug]/__tests__/` for existing
  `abandonPendingCheckout` coverage and adding RPC-mock-based tests for
  all five branches in §2.1 plus the not-found/idempotent-no-op case).
- **This spec does not touch** `src/app/(auth)/`, `src/app/(admin)/`,
  `src/components/admin/`, `src/types/index.ts`, or
  `supabase/migrations/20260812000001_*`, per the task's explicit branch
  isolation instruction — none of those were read or referenced in
  producing this spec.
