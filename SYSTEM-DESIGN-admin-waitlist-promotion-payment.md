# SYSTEM-DESIGN — Admin waitlist promotion must collect payment (paid events)

> Produced by: Architect agent (side-spec)
> Date: 2026-07-13
> Status: Spec — hand to backend-developer for implementation
> Scope: Fix `promoteFromWaitlist` so promoting a waitlisted booking on a **paid** event holds the seat as `pending_payment` and collects a real Stripe payment, instead of confirming a seat with zero price-awareness. Covers the urgent Amy Sangam / Yasemin Salp case (today) and the systemic "4h hold + auto-revert" mechanism (going forward).

This is a focused side-spec. It does not replace `SYSTEM-DESIGN.md`. A one-line cross-reference is added there (see bottom of this doc).

---

## 0. TL;DR

| Item | Detail |
|---|---|
| Root cause (already known) | `promoteFromWaitlist` (`src/app/(admin)/admin/actions.ts:1664-1729`) sets `status='confirmed'` directly — no Stripe, no price-awareness. |
| **Correction to the brief's premise** | **The "urgent slice needs zero migration" framing in Q6 is not quite safe as stated — see §1. A small, additive migration (one boolean column + a one-line predicate change to the existing reaper) is unavoidable even for today's Amy/Yasemin fix, or the existing 35-minute reaper will auto-cancel their holds regardless of intent. Full reasoning below; the migration is tiny (~2 minutes to write) so this doesn't meaningfully slow the urgent slice down.** |
| New columns | `bookings.is_admin_hold boolean NOT NULL DEFAULT false`, `bookings.admin_hold_expires_at timestamptz NULL` |
| New RPC | `public.admin_promote_waitlist_to_hold(p_booking_id, p_booking_fee_pence, p_hold_expires_at)` — admin-gated analogue of `claim_waitlist_spot`, transitions `waitlisted → pending_payment` |
| New cron function | `public.revert_expired_admin_holds()` — reverts `pending_payment → waitlisted` when `admin_hold_expires_at < now()`, pg_cron every 15 min |
| Existing reaper change | `reap_stale_pending_bookings()` gets one added predicate: `AND is_admin_hold = false` |
| New TS helper | `createAdminBookingHold()` in `src/lib/bookings/admin-hold.ts` — the reusable "create a payment-link hold" mechanism, used for BOTH Amy/Yasemin today and every future promotion |
| New email | `waitlistPromotionTemplate()` in `src/lib/email/templates/waitlist-promotion.ts` (new file, not the dead `pending_payment` branch of `booking-confirmation.ts`) |
| Naming note | Deliberately avoided the word "promotion" in column/RPC/cron names — this codebase already uses "promotion" for **Stripe discount codes** (`allow_promotion_codes`). Used "admin_hold" instead to prevent grep-ambiguity. Kept "promotion" in the Server Action name (`promoteFromWaitlist`, pre-existing) and the email (user-facing English is fine there). |
| RLS changes | **None required.** The new RPC is `SECURITY DEFINER` with its own in-body admin-role check, exactly like `claim_waitlist_spot`/`book_event_paid`. All other touched call sites already operate under existing, sufficient RLS (own-row for `abandonPendingCheckout`, service-role for the webhook and `cancelEventAndRefundBookings`). |
| Migrations | 3 files, `20260713000001` → `20260713000003` (see §2, §3, §6) |

---

## 1. Correcting the sequencing premise (read this first)

The brief asks for a slice that unblocks Amy/Yasemin today "without needing the new migration/cron at all (since they get no auto-revert)." I can't deliver that literally — here's why, and what I'm recommending instead.

**The existing reaper doesn't know the difference.** `reap_stale_pending_bookings()` (migration `20260515095343`) cancels *any* row matching `status='pending_payment' AND stripe_payment_id IS NULL AND created_at < now() - interval '35 minutes'`. The moment `promoteFromWaitlist` flips Amy's or Yasemin's booking to `pending_payment` to create a Checkout Session for them (required — see the brief's own webhook-guard fact), that row matches this predicate exactly like a normal abandoned checkout. There is currently no column anywhere that would let the reaper skip it. **Without a schema change, both of their holds get silently cancelled 35 minutes after promotion — a worse outcome than today's bug**, because now they'd be kicked off the waitlist entirely, the day before the event, with no automated safety net and no admin notification (the reaper doesn't email anyone).

I considered three ways to avoid touching schema at all and rejected all three:
- **Pause the `reap-stale-pending-bookings` pg_cron job for a few hours.** Rejected — this is a platform-wide blast radius (~1,000 members, other paid events may have genuinely-abandoned checkouts in flight during that window that should be reaped) to solve a two-row problem.
- **Hardcode Amy's and Yasemin's booking IDs into the reaper's WHERE clause.** Rejected — this is *still* a migration (the project rule requires all schema/function changes go through `supabase/migrations/`), it's uglier than the real fix, and it's thrown-away code the moment they pay.
- **Give them a Stripe Payment Link created by hand in the Stripe Dashboard instead of a Checkout Session.** Rejected — a Dashboard-created Payment Link doesn't carry `metadata.booking_id`, so it can't reconcile through the existing webhook (`handleCheckoutCompleted` keys off that metadata). This reintroduces exactly the "money taken, app never learns" failure mode the brief is trying to avoid, for no benefit.

**What I'm recommending instead:** one migration, small and purely additive (default `false`/`NULL` for every existing row, zero behavioural change to anything not touched by this feature), ships as part of the "urgent" work. It's genuinely tiny — a boolean column, a nullable timestamp column, two named CHECK constraints, and a one-line `AND is_admin_hold = false` added to the reaper via `CREATE OR REPLACE FUNCTION`. See §8 for the exact urgent-vs-systemic split; the *cron* (the heavier systemic piece) is still fully deferred until "right behind."

---

## 2. Schema — `bookings.is_admin_hold` / `bookings.admin_hold_expires_at`

### 2.1 Why two columns, not one

I initially considered a single nullable `admin_hold_expires_at timestamptz` column, using `NULL` for "not a hold" and a Postgres `'infinity'` sentinel for "hold with no auto-revert" (Amy/Yasemin). I rejected this:

- **JS/TS footgun.** PostgREST serialises `timestamptz 'infinity'` as the literal string `"infinity"`. `new Date("infinity")` in JavaScript is `Invalid Date`. Any admin UI code that reads this column and does `new Date(row.admin_hold_expires_at)` would silently break for exactly the no-deadline rows — the ones this feature most needs to display correctly ("no deadline — awaiting manual follow-up").
- **A single column can't distinguish "never was a hold" from "was a hold, deadline intentionally absent" from the OLD reaper's point of view without relying on that same sentinel**, which reintroduces the footgun above the moment anyone needs to query or display it.

Two columns, independently meaningful:

| Column | Type | Default | Meaning |
|---|---|---|---|
| `is_admin_hold` | `boolean` | `NOT NULL DEFAULT false` | This row is *currently* a `pending_payment` hold created by an admin promotion (not a normal self-service checkout). This is what the OLD reaper excludes on. Actively **cleared back to `false`** every time the row leaves this state (paid, reverted, or cancelled) — see §5 for every site that must do this. |
| `admin_hold_expires_at` | `timestamptz` | `NULL` | The auto-revert deadline. `NULL` = no automated revert (Amy/Yasemin today; also any future promotion where the event is too close for a 4h window to make sense — see §4.3). A concrete future timestamp = the NEW cron reverts this row to `waitlisted` once passed. |

### 2.2 CHECK constraints

```sql
-- A deadline only makes sense on a row that's flagged as a hold.
ALTER TABLE public.bookings
  ADD CONSTRAINT chk_bookings_admin_hold_expiry_requires_flag
  CHECK (is_admin_hold = true OR admin_hold_expires_at IS NULL);

-- A hold flag only makes sense while the row is actually pending_payment.
-- This is the load-bearing one: it forces every UPDATE that moves a hold
-- row's status away from pending_payment (paid, reverted, cancelled) to
-- also clear is_admin_hold in the SAME statement, or the write fails
-- loudly (23514) instead of leaving stale state that would silently
-- corrupt the OLD reaper's exclusion or a future re-claim cycle. See §5
-- for the full enumerated list of sites this affects — I'm trading "5
-- call sites to update" for "impossible to leave this state stale
-- without a loud failure," which given this project's history of
-- multi-week silent failures (17-day reaper outage, RLS drift) is the
-- right trade.
ALTER TABLE public.bookings
  ADD CONSTRAINT chk_bookings_admin_hold_requires_pending_payment
  CHECK (is_admin_hold = false OR status = 'pending_payment');
```

### 2.3 Why the flag can't be reused across a row's lifecycle without active clearing (worked example)

This is the trap that justifies the CHECK in 2.2 and the enumeration in §5 — worth spelling out once:

1. Waitlist: A(pos 1), B(pos 2), C(pos 3).
2. Admin promotes A → `pending_payment`, `is_admin_hold=true`. **`waitlist_position` is deliberately left untouched** (still `1` — see §4.4). B, C untouched (`2`, `3`).
3. B leaves the waitlist entirely (cancels). The existing `recompute_waitlist_positions()` runs, reassigning positions among *currently-`waitlisted`* rows only — that's just C now, who becomes position `1`.
4. A's hold expires unpaid. The revert-cron sets A back to `waitlisted` with its frozen `waitlist_position=1` (never re-derived) — but C *also* now holds position `1`. **Duplicate positions**, unless the revert also calls `recompute_waitlist_positions()` afterward (it does — see §6.3).
5. Separately: if `is_admin_hold` were *not* actively cleared back to `false` on every exit, and this same booking row later cycled through a completely normal, unrelated `claim_waitlist_spot` self-service claim (different event churn, weeks later), the OLD reaper's new `AND is_admin_hold = false` predicate would wrongly exempt a perfectly ordinary abandoned checkout from ever being reaped.

Both failure modes are closed by (a) the CHECK forcing every exit transition to clear the flag, and (b) the revert-cron recomputing positions. Neither is closed by the flag alone.

### 2.4 Migration file — `supabase/migrations/20260713000001_add_bookings_admin_hold_columns.sql`

```sql
-- Migration: add_bookings_admin_hold_columns
--
-- Adds the two columns that let an admin-created "pay to hold your
-- promoted waitlist spot" pending_payment row be distinguished from a
-- normal self-service checkout. Needed by:
--   (a) reap_stale_pending_bookings() — must SKIP these rows (they get a
--       much longer, admin-communicated payment window than the
--       standard 35-minute abandoned-checkout timeout).
--   (b) the new admin_promote_waitlist_to_hold() RPC (20260713000002)
--       and revert_expired_admin_holds() cron (20260713000003).
--
-- See SYSTEM-DESIGN-admin-waitlist-promotion-payment.md §2 for full
-- rationale, including why this is two columns (not one column with an
-- 'infinity' sentinel — see §2.1) and why the second CHECK constraint
-- is deliberately strict (§2.3).
--
-- ── Anon-visibility ──────────────────────────────────────────────────────
-- N/A — bookings has no anon SELECT policy at all (RLS restricts SELECT
-- to row owner + admin). Both columns inherit the table-wide posture.
--
-- ── Idempotency ──────────────────────────────────────────────────────────
-- ADD COLUMN IF NOT EXISTS + named CHECKs guarded with the standard
-- DO $$ ... EXCEPTION WHEN duplicate_object pattern (matches
-- 20260517000001).
--
-- ── Safety / blast radius ──────────────────────────────────────────────────
-- Purely additive. `is_admin_hold` defaults false and `admin_hold_expires_at`
-- defaults NULL for every existing row — zero behavioural change until the
-- new RPC (20260713000002) starts setting them. No table rewrite risk at
-- demo scale; CHECK validation is a single sequential scan of a small table.
--
-- ── Post-merge ────────────────────────────────────────────────────────────
-- CI applies migrations to local Supabase only. After merge run manually:
--   supabase db push --include-all --linked
-- Verify: SELECT column_name FROM information_schema.columns
--         WHERE table_name = 'bookings' AND column_name LIKE 'admin_hold%' OR column_name = 'is_admin_hold';

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS is_admin_hold boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS admin_hold_expires_at timestamptz;

COMMENT ON COLUMN public.bookings.is_admin_hold IS
  'True while this row is a pending_payment seat hold created by an admin waitlist promotion (promoteFromWaitlist / admin_promote_waitlist_to_hold), as opposed to a normal self-service checkout. MUST be cleared back to false in the same statement that moves status away from pending_payment (paid via webhook, reverted via revert_expired_admin_holds, or cancelled) — enforced by chk_bookings_admin_hold_requires_pending_payment. Named to avoid collision with this codebase''s unrelated "Stripe promotion code" concept (allow_promotion_codes).';

COMMENT ON COLUMN public.bookings.admin_hold_expires_at IS
  'Auto-revert deadline for an admin-created hold. NULL = no automated revert (human-managed — either because the admin explicitly chose that, or because the event is too close for a 4h window to make sense; see computeHoldExpiresAt in src/lib/bookings/admin-hold.ts). Non-NULL = revert_expired_admin_holds() reverts this booking to waitlisted once passed. Always NULL when is_admin_hold = false.';

DO $$ BEGIN
  ALTER TABLE public.bookings
    ADD CONSTRAINT chk_bookings_admin_hold_expiry_requires_flag
    CHECK (is_admin_hold = true OR admin_hold_expires_at IS NULL);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.bookings
    ADD CONSTRAINT chk_bookings_admin_hold_requires_pending_payment
    CHECK (is_admin_hold = false OR status = 'pending_payment');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── No new indexes ─────────────────────────────────────────────────────────
-- Demo scale (mirrors the reaper's own migration, which added none either).
-- If this table ever grows large, a partial index
-- `WHERE is_admin_hold = true` would be cheap (the predicate matches a
-- tiny fraction of rows) — noted for future, not required now.
```

### 2.5 TypeScript type implication (minor, additive)

`AdminEventBooking` (`src/types/index.ts:336-354`) should gain `is_admin_hold: boolean` and `admin_hold_expires_at: string | null` alongside its existing `status`/`waitlist_position`/etc. fields, per ADR-08's "types mirror DB schema" rule, so the admin bookings list (`getEventBookings` in `admin/actions.ts`) can surface "held, awaiting payment, due by X" distinctly from a normal `pending_payment` row. This is a pure type/data addition — designing the actual admin UI treatment of it is `frontend-developer`/`ux-designer` scope, not specified here.

---

## 3. The reusable "create a payment-link hold" mechanism

### 3.1 SQL: `admin_promote_waitlist_to_hold`

This is the admin-gated analogue of `claim_waitlist_spot` — same shape (lock booking, lock event, validate, capacity-check, transition), different authorization model (admin-role check via `auth.uid()`, not an owner check) and different destination columns (`is_admin_hold` / `admin_hold_expires_at` instead of nothing).

It intentionally does **not** branch on free-vs-paid internally — the calling Server Action (`promoteFromWaitlist`) decides that *before* calling anything (see §4), exactly so the free path stays byte-for-byte untouched. This function defensively rejects free events anyway (mirrors `book_event_paid`'s own "use book_event for free events" guard), the same paranoid-but-cheap style already used throughout this RPC family.

```sql
CREATE OR REPLACE FUNCTION public.admin_promote_waitlist_to_hold(
  p_booking_id        uuid,
  p_booking_fee_pence integer,
  p_hold_expires_at   timestamptz   -- NULL = no auto-revert
)
RETURNS jsonb AS $$
DECLARE
  v_is_admin        boolean;
  v_event_id        uuid;
  v_user_id         uuid;
  v_current_status  booking_status;
  v_capacity        integer;
  v_price           integer;
  v_event_date      timestamptz;
  v_is_cancelled    boolean;
  v_seat_count      integer;
BEGIN
  -- Admin gate — mirrors the RLS admin-check pattern (profiles.role =
  -- 'admin'), NOT an owner check (p_user_id != auth.uid()) like the
  -- member-facing RPCs, because the caller here is an admin acting on
  -- behalf of the booking's owner. Matches admin_get_user_phones'
  -- in-body gate style (20260602000001).
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RETURN jsonb_build_object('error', 'Admin access required');
  END IF;

  IF p_booking_fee_pence < 0 THEN
    RETURN jsonb_build_object('error', 'Invalid booking fee');
  END IF;

  -- Lock the booking row — serialises a double-click on "Promote".
  SELECT event_id, user_id, status
  INTO   v_event_id, v_user_id, v_current_status
  FROM   public.bookings
  WHERE  id = p_booking_id
    AND  deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Booking not found');
  END IF;

  IF v_current_status != 'waitlisted' THEN
    RETURN jsonb_build_object(
      'error',
      CASE
        WHEN v_current_status IN ('confirmed', 'pending_payment') THEN 'This member already has a spot for this event'
        WHEN v_current_status = 'cancelled' THEN 'This booking was cancelled'
        ELSE 'Booking is not waitlisted'
      END
    );
  END IF;

  -- Lock the event row — same rationale as claim_waitlist_spot: serialise
  -- concurrent promotions/claims against the same event's capacity.
  SELECT capacity, price, date_time, is_cancelled
  INTO   v_capacity, v_price, v_event_date, v_is_cancelled
  FROM   public.events
  WHERE  id = v_event_id AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Event not found');
  END IF;

  IF v_is_cancelled THEN
    RETURN jsonb_build_object('error', 'Event is cancelled');
  END IF;

  IF v_event_date < now() THEN
    RETURN jsonb_build_object('error', 'Event has already passed');
  END IF;

  -- Sanity: this RPC is only for paid events. The Server Action must
  -- branch to a direct confirm for free events without ever calling
  -- this — same invariant book_event_paid enforces for its own callers.
  IF v_price = 0 THEN
    RETURN jsonb_build_object('error', 'Free events should be confirmed directly, not held');
  END IF;

  -- Capacity check — seats are taken by confirmed OR pending_payment.
  -- This is the fix for the bug: the OLD promoteFromWaitlist counted
  -- 'confirmed' only. Moving the check inside this locked RPC fixes the
  -- wrong predicate AND closes the TOCTOU race the old TS-side
  -- check-then-update had (two admins promoting for the same last paid
  -- spot simultaneously).
  IF v_capacity IS NOT NULL THEN
    SELECT COUNT(*)
    INTO   v_seat_count
    FROM   public.bookings
    WHERE  event_id = v_event_id
      AND  status   IN ('confirmed', 'pending_payment')
      AND  deleted_at IS NULL;

    IF v_seat_count >= v_capacity THEN
      RETURN jsonb_build_object('error', 'Event is at full capacity — cannot promote');
    END IF;
  END IF;

  -- Transition. waitlist_position is deliberately left untouched — if
  -- this hold later fails (Stripe error) or expires unpaid, the position
  -- is already sitting on the row ready to be restored with no
  -- re-derivation needed. Mirrors claim_waitlist_spot's rationale
  -- exactly (20260517000002 header comment).
  UPDATE public.bookings
  SET    status                 = 'pending_payment',
         booking_fee_pence      = p_booking_fee_pence,
         is_admin_hold          = true,
         admin_hold_expires_at  = p_hold_expires_at
  WHERE  id     = p_booking_id
    AND  status = 'waitlisted';

  RETURN jsonb_build_object(
    'booking_id', p_booking_id,
    'user_id',    v_user_id,
    'status',     'pending_payment'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public, pg_catalog;

REVOKE EXECUTE ON FUNCTION public.admin_promote_waitlist_to_hold(uuid, integer, timestamptz) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_promote_waitlist_to_hold(uuid, integer, timestamptz) TO authenticated;
```

**`search_path` posture:** uses the stricter `SET search_path = public, pg_catalog` per the task brief's explicit instruction (matches the reaper precedent, `20260515095343`). Note this deliberately diverges from `admin_get_user_phones`'s bare `public` — that migration explicitly chose sibling-consistency with the *other* PII-read helpers over hardening; this function has no such sibling family pulling it the other way, so it follows the newer, stricter precedent as instructed. Not a retrofit of anything existing.

**Error-shape convention:** returns `jsonb_build_object('error', ...)`, not `RAISE EXCEPTION`. This function's true sibling family is the booking-state-transition RPCs (`book_event`, `book_event_paid`, `claim_waitlist_spot`), which all use this shape and are called from Server Actions that already know how to unwrap `result.error` — not the PII-read helpers (`admin_get_user_phones` etc.), which raise exceptions because they're called differently. Family-consistency, not accident.

**Why the RPC must be called via the user-scoped client, not `service_role`:** `auth.uid()` is only populated when the call carries the caller's own JWT. If `createAdminBookingHold` (§3.2) called this RPC via `createAdminClient()` (service_role), `auth.uid()` would be `NULL` inside the function, the admin-role check would fail, and every promotion would error with "Admin access required" despite the caller genuinely being an admin. This RPC call **must** use the `requireAdmin()`-obtained user-scoped client. This is the same client-selection discipline already established for admin PII reads (see project memory: `requireAdmin` = user-scoped, not service_role) — I'm extending it, not inventing a new rule.

### 3.2 TS: `createAdminBookingHold`

New file: `src/lib/bookings/admin-hold.ts` (server-only, `import 'server-only'`).

```ts
export async function createAdminBookingHold(
  supabaseUserScoped: SupabaseClient,   // from requireAdmin() — carries the admin's JWT, needed for the RPC's auth.uid() check
  bookingId: string,
  options: { holdExpiresAt: Date | null },
): Promise<{
  success: boolean
  error?: string
  status?: 'pending_payment'
  checkoutUrl?: string
  holdExpiresAt?: string | null   // ISO, echoed back for the caller's toast/email copy
}>
```

Two Supabase clients are needed, mirroring the split already established by `ensureStripeCustomer`'s own docstring (profiles UPDATE RLS is own-row-only, no admin override — see CLAUDE.md's RLS table):

- `supabaseUserScoped` (passed in) — used **only** for the `admin_promote_waitlist_to_hold` RPC call (needs `auth.uid()` context, §3.1).
- `createAdminClient()` (instantiated internally) — used for everything else: reading booking/event/profile details, `ensureStripeCustomer`, `createBookingCheckoutSession`'s session-id persistence, the Stripe-failure rollback, and the data needed to send the email. This matches `cancelEventAndRefundBookings`'s own stated rationale for using the service-role client: "we're mutating rows that belong to many users."

Algorithm:

1. Fetch the booking (`event_id`, `user_id`) via the admin client.
2. Fetch the event (`price`, `slug`, `title`, `date_time`, `venue_name`, `venue_address`, `venue_revealed`) via the admin client. If `price === 0`, return an error defensively (should be unreachable — the caller branches before ever calling this; see §4).
3. `bookingFeePence = calculateBookingFeePence(event.price)` — reuses the existing single-source-of-truth helper, unchanged.
4. Call `admin_promote_waitlist_to_hold` via `supabaseUserScoped`, passing `bookingId`, `bookingFeePence`, and `options.holdExpiresAt?.toISOString() ?? null`.
5. On RPC error → return `{ success: false, error }`.
6. Fetch the profile (`full_name`, `email`) via the admin client.
7. `ensureStripeCustomer(admin, { userId, email, fullName })` — unchanged, reused as-is.
8. `createBookingCheckoutSession({ ...booking/event fields, stripeCustomerId, expiresInSeconds })` — see §3.3 for how `expiresInSeconds` is derived. `successUrl`/`cancelUrl` follow the existing pattern (`${origin}/events/${slug}/booking-success?session_id=...` / `${origin}/events/${slug}?cancelled=1&from=admin_hold` — the new `from=admin_hold` value is required, see §5.2).
9. On success: persist `stripe_checkout_session_id` on the booking row (admin client, non-critical — log-and-continue on failure, matching the existing pattern in `createPaidCheckout`/`claimWaitlistSpot`). Send the email (§7). Return `{ success: true, status: 'pending_payment', checkoutUrl, holdExpiresAt: options.holdExpiresAt?.toISOString() ?? null }`.
10. On Stripe failure (customer creation or Checkout Session creation throws): **roll back to `waitlisted`, and — unlike the existing `claimWaitlistSpot` rollback — explicitly clear `is_admin_hold` and `admin_hold_expires_at` in the same UPDATE.** This is the one place where copying the existing rollback pattern verbatim would be wrong: `claimWaitlistSpot`'s catch block only has `status` to worry about; this one also carries the two new columns, and forgetting them here reproduces the exact staleness trap in §2.3, on the very first error path anyone hits. `.eq('status', 'pending_payment')` optimistic guard, matching the existing style. Log + Sentry (`surface: 'createAdminBookingHold'`), matching the existing `Sentry.captureException` pattern in `createPaidCheckout`/`claimWaitlistSpot`.

### 3.3 Stripe Checkout Session expiry — the hidden blocker

**This is a required change the brief didn't flag, and it would silently break the entire feature if missed.** `createBookingCheckoutSession()` (`src/lib/stripe/checkout.ts:151-226`) hardcodes:

```ts
expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
```

There is no parameter to override this. If reused as-is, Amy's and Yasemin's payment link — and every future 4-hour hold — would go dead in **30 minutes**, regardless of any DB-side deadline decision. Given the entire point of the Amy/Yasemin case is "no rush, a human is managing this, event is tomorrow," a 30-minute Stripe-side cutoff defeats it outright.

**Required change:** add an optional `expiresInSeconds?: number` to `CheckoutSessionInput`, defaulting to the current `30 * 60` when omitted — so the two existing call sites (`createPaidCheckout`, `claimWaitlistSpot`) are completely unaffected. `createAdminBookingHold` is the only caller that passes an explicit value.

**Formula** (module-scoped constants in `src/lib/bookings/admin-hold.ts`, same style as `booking-fee.ts`'s `STRIPE_PERCENT`/`STRIPE_FLAT_PENCE`):

```
STRIPE_EXPIRY_SAFETY_MARGIN_MS = 5 * 60 * 1000   // 5 minutes
MIN_STRIPE_EXPIRY_SECONDS      = 30 * 60          // Stripe's own floor
MAX_STRIPE_EXPIRY_SECONDS      = 24 * 60 * 60     // Stripe's own ceiling

computeStripeExpirySeconds(holdExpiresAt):
  if holdExpiresAt is null:
    return MAX_STRIPE_EXPIRY_SECONDS              // Amy/Yasemin: Stripe's most generous option
  raw = floor((holdExpiresAt - STRIPE_EXPIRY_SAFETY_MARGIN_MS - now()) / 1000)
  return clamp(raw, MIN_STRIPE_EXPIRY_SECONDS, MAX_STRIPE_EXPIRY_SECONDS)
```

**Why the 5-minute margin matters (this is the answer to "how does the stale-link race get closed" — see §6.4 for the rest of that answer):** setting Stripe's own `expires_at` to *before* our DB deadline, not equal to it, guarantees Stripe stops accepting payment on that link strictly before our revert-cron ever considers reverting the row. Without this margin, a payment completing in the few-second gap between "our deadline passes" and "the cron tick actually runs" would hit the exact failure mode the brief flags: the webhook's `.eq('status', 'pending_payment')` guard would find the row already `waitlisted` and silently no-op — Stripe would have taken the money, the app would never know.

---

## 4. `promoteFromWaitlist` changes

### 4.1 Branch on price (free path unchanged)

```
promoteFromWaitlist(bookingId):
  1. requireAdmin() → { supabase, userId }        // unchanged entry gate
  2. Fetch booking (id, event_id, user_id, status) — must be waitlisted   // unchanged
  3. Fetch event — EXTEND the existing select from
     'id, slug, capacity' to 'id, slug, capacity, price'   // one field added
  4. IF event.price === 0 (free):
       — everything below is EXACTLY today's existing code, unchanged —
       capacity check, UPDATE status=confirmed + waitlist_position=null,
       recompute_waitlist_positions, fetch profile name, revalidate,
       return { success, promotedName }
     ELSE (paid):
       holdExpiresAt = computeHoldExpiresAt(event.date_time)   // §4.3
       result = await createAdminBookingHold(supabase, bookingId, { holdExpiresAt })
       if !result.success → return { error: result.error }
       revalidatePath('/admin/events'); revalidatePath(`/events/${event.slug}`); revalidatePath('/bookings')
       return { success: true, promotedName, status: 'pending_payment', holdExpiresAt: result.holdExpiresAt }
```

### 4.2 Capacity-check fix on the free branch — a call, not a silent decision

The brief flags the capacity-check bug generically; the fix naturally lands *inside* the new RPC for the paid branch (§3.1). For the **free** branch specifically: a free event can never have a `pending_payment` row against it (`book_event()` never creates one; `book_event_paid`/`claim_waitlist_spot` both reject free events explicitly), so `confirmed` and `confirmed + pending_payment` counts are always identical there today. Widening the free branch's predicate to match is a no-op *now*, but is one shared, correct capacity-check expression instead of two subtly-different ones, and defends against a hypothetical future bug that creates a stray `pending_payment` row against a free event. I recommend making this change; if you'd rather keep the free branch's SQL byte-for-byte identical to today (stricter reading of "unchanged"), that's a reasonable alternative — flagging as a low-stakes call either way, not asserting one silently.

### 4.3 The deadline formula generalises Amy/Yasemin into a permanent rule

Rather than special-casing "these two get `null`, everyone else gets 4 hours," the systemic logic should be:

```
FOUR_HOURS_MS = 4 * 60 * 60 * 1000

computeHoldExpiresAt(eventDateTime):
  if (eventDateTime - now()) > FOUR_HOURS_MS + STRIPE_EXPIRY_SAFETY_MARGIN_MS:
    return new Date(now() + FOUR_HOURS_MS)
  return null   // event too close for an automated deadline to make sense — human decides
```

Amy's and Yasemin's event ("~tomorrow") naturally falls into the `null` branch under this *same* formula — there's no special-casing required once the systemic slice ships; the urgent slice just short-circuits to `null` directly (see §8) because the formula's inputs (the cron, effectively) don't exist yet. This also means a future admin promoting someone for an event happening in, say, 90 minutes automatically gets the same "no automated revert, a human should decide" treatment, without needing to remember to check.

### 4.4 `waitlist_position` preservation

Handled entirely inside `admin_promote_waitlist_to_hold` (§3.1) — the UPDATE never touches `waitlist_position`, mirroring `claim_waitlist_spot`'s rationale exactly (position is never nulled, so nothing needs re-deriving if the hold fails or expires). The Stripe-failure rollback (§3.2 step 10) and the revert-cron (§6) both also leave it untouched for the same reason.

---

## 5. Required fixes at existing UPDATE sites (the hidden blast radius)

The CHECK constraint in §2.2 (`is_admin_hold = false OR status = 'pending_payment'`) means **every existing code path that can move a `pending_payment` booking to a different status must also clear `is_admin_hold` and `admin_hold_expires_at` in the same statement**, or that write starts failing with a 23514 constraint violation the moment it ever touches a hold row. I traced every such site in the current codebase. Two are launch-blocking for the urgent slice (without them, Amy/Yasemin literally cannot be confirmed or safely abandoned); two are systemic-slice-only.

| # | Site | File | Required for | Fix |
|---|---|---|---|---|
| 1 | Stripe webhook, `handleCheckoutCompleted` | `src/app/api/stripe/webhook/route.ts` (~line 171, `updatePayload`) | **Urgent — payment confirmation itself is broken without this** | Add `is_admin_hold: false, admin_hold_expires_at: null` to the existing `updatePayload` object, unconditionally. Harmless no-op for every non-hold booking (already `false`/`null`). |
| 2 | `abandonPendingCheckout` (Stripe "← Back" redirect) | `src/app/events/[slug]/actions.ts:585-627` | **Urgent — Amy/Yasemin might click back on Stripe while logged in** | Extend `options?.from` union from `'book' \| 'claim'` to `'book' \| 'claim' \| 'admin_hold'`; treat `'admin_hold'` the same as `'claim'` in the `rollbackStatus` ternary (→ `waitlisted`, not `cancelled` — losing their waitlist position because Stripe hiccupped would be wrong). Add `is_admin_hold: false, admin_hold_expires_at: null` to the `.update()` call, unconditionally. `createAdminBookingHold` must construct its `cancel_url` with `&from=admin_hold`. |
| 3 | `revert_expired_admin_holds()` (new cron) | new migration, §6 | Systemic — doesn't exist yet in the urgent slice | Built correctly from scratch (clears both columns as part of the same UPDATE that sets `status='waitlisted'`). |
| 4 | `cancelEventAndRefundBookings`, pending_payment branch | `src/app/(admin)/admin/actions.ts:1309-1338` | Not launch-blocking, but recommended in the same pass — see below | Add `is_admin_hold: false, admin_hold_expires_at: null` to the existing `.update()` payload. |

**On #4:** this only matters if an admin whole-event-cancels an event that currently has an outstanding hold. For Amy/Yasemin specifically that would mean cancelling the France vs Spain screening in the next ~24h while their holds are outstanding — possible but not the primary risk today. I recommend including this fix in the same PR as #1/#2 anyway (it's a 2-line addition and you'll already be in this exact mental model), but it does not block sending Amy/Yasemin their payment links.

**Site I checked and believe does *not* need changes:** `cancelBooking` (member self-cancel, `src/app/events/[slug]/actions.ts:678+`). Its docstring and refund logic are written entirely in terms of cancelling a `confirmed` paid booking; by the time any hold-originated row reaches `confirmed`, fix #1 has already cleared `is_admin_hold`. I did not read its full guard clause byte-for-byte to *prove* it never touches a `pending_payment` row — worth a quick confirming look from whoever implements this, but I don't believe it's in scope.

---

## 6. The revert-to-waitlist cron

### 6.1 Function

```sql
CREATE OR REPLACE FUNCTION public.revert_expired_admin_holds()
RETURNS integer AS $$
DECLARE
  v_reverted  integer;
  v_event_ids uuid[];
  v_event_id  uuid;
BEGIN
  -- Single atomic UPDATE — same race-safety reasoning as
  -- reap_stale_pending_bookings (Postgres's UPDATE already row-locks the
  -- matched rows; no separate SELECT-then-UPDATE window). If the webhook
  -- is concurrently confirming the same row, one of the two transactions
  -- simply waits for the other to commit, then re-evaluates its WHERE
  -- clause — whichever transaction "wins" leaves the row in a
  -- self-consistent state either way.
  WITH reverted AS (
    UPDATE public.bookings
       SET status                = 'waitlisted',
           is_admin_hold         = false,
           admin_hold_expires_at = NULL
     WHERE status                = 'pending_payment'
       AND is_admin_hold         = true
       AND admin_hold_expires_at IS NOT NULL
       AND admin_hold_expires_at < now()
       AND stripe_payment_id     IS NULL
       AND deleted_at            IS NULL
    RETURNING id, event_id
  )
  SELECT count(*), array_agg(DISTINCT event_id)
  INTO   v_reverted, v_event_ids
  FROM   reverted;

  -- Recompute waitlist numbering once per DISTINCT affected event (not
  -- per row) — see SYSTEM-DESIGN-admin-waitlist-promotion-payment.md §2.3
  -- for why this is required (a reverted row's frozen waitlist_position
  -- can now collide with positions reassigned while it was held).
  IF v_event_ids IS NOT NULL THEN
    FOREACH v_event_id IN ARRAY v_event_ids LOOP
      PERFORM public.recompute_waitlist_positions(v_event_id);
    END LOOP;
  END IF;

  RETURN COALESCE(v_reverted, 0);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public, pg_catalog;

REVOKE EXECUTE ON FUNCTION public.revert_expired_admin_holds() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.revert_expired_admin_holds() TO service_role;
```

`recompute_waitlist_positions` is `GRANT`ed to `authenticated` only (not `service_role`), but that grant governs external PostgREST/RPC invocation, not a direct in-body `PERFORM` call from another `SECURITY DEFINER` function owned by the same role — this mirrors how `admin_promote_waitlist_to_hold` itself will call it too if needed, and needs no additional grant.

### 6.2 Schedule

```sql
DO $$
BEGIN
  PERFORM cron.unschedule('revert-expired-admin-holds');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'revert-expired-admin-holds',
  '*/15 * * * *',
  $$ SELECT public.revert_expired_admin_holds(); $$
);
```

Same 15-minute cadence as `reap-stale-pending-bookings` — consistent operational mental model, same worst-case latency character (up to ~15 min after the stated deadline before a revert actually lands, which is fine given the Stripe-side cutoff already closed 5 minutes earlier — §3.3, §6.4).

### 6.3 Answering "should it call `recompute_waitlist_positions` after?" — yes, and here's why this differs from the existing rollback

Yes (built into §6.1). Justification, since the brief explicitly asked me to decide rather than assume: the *existing* Stripe-failure rollback in `claimWaitlistSpot`'s catch block (and the mirrored one in `createAdminBookingHold`, §3.2 step 10) also does **not** call `recompute_waitlist_positions` — but that rollback fires synchronously, milliseconds after a failed Stripe API call, within the same Server Action invocation. There is essentially zero time window for other waitlist churn to have happened in between, so skipping the recompute there is safe in practice even though not airtight in theory.

The revert-cron's window is **4 hours**, not milliseconds — dramatically more time for other waitlisted members to cancel and trigger a `recompute_waitlist_positions()` call that the held row was excluded from (worked example in §2.3). That difference in time-window is why the two rollback paths should behave differently despite superficially doing "the same thing" (pending_payment → waitlisted).

### 6.4 Answering "should it expire the outstanding Stripe Checkout Session?" — no explicit call; closed by construction instead

No. The revert function is pure SQL/plpgsql — like `reap_stale_pending_bookings`, it makes no HTTP calls and has no `pg_net` dependency. This is a deliberate continuation of that function's own stated design principle ("this job is pure SQL and makes no HTTP calls"), and consistent with this project's history: every scheduled job that has needed an HTTP call out (the daily-notifications Edge Function path, `pg_net` + vault secrets) has been comparatively fragile and directly implicated in past incidents, per project memory. Reaching out to Stripe from the cron would reintroduce exactly that fragility for a problem that doesn't need it.

Instead, the race is closed **by construction** at hold-creation time (§3.3): Stripe's own `expires_at` is set 5 minutes *before* the DB-side `admin_hold_expires_at`. By the time the cron ever considers reverting a row (at or after the DB deadline, polled every 15 minutes), Stripe has already been refusing payment on that Checkout Session for at least 5 minutes. A stale link literally cannot still be paid after revert, without the revert function ever needing to know Stripe exists.

**Residual risk, named explicitly:** if the cron itself stops running for an extended period (the exact failure class the reaper's own migration was written to eliminate for *its* job), a hold could sit well past its deadline with a Stripe link that's already dead — annoying (member is in limbo) but not dangerous (no money/reconciliation risk, since Stripe already refused payment). This is a strictly smaller failure mode than the pre-existing accepted risk noted in `cancelEventAndRefundBookings`'s own comments (waitlisted/pending_payment rows during a whole-event cancellation "flagged as a follow-up" for the same class of edge case). I'm not proposing new monitoring for this beyond what already exists (`cron.job_run_details`) — flagging it as accepted, not solving it here.

### 6.5 Migration file — `supabase/migrations/20260713000002_admin_promote_waitlist_to_hold_rpc.sql`

Contains: the full `admin_promote_waitlist_to_hold` function (§3.1) **and** a `CREATE OR REPLACE` of `reap_stale_pending_bookings()` adding one line to its `WHERE` clause:

```sql
-- Only change vs 20260515095343: adds `AND is_admin_hold = false`.
-- Every existing row has is_admin_hold=false by column default, so this
-- is a pure no-op for every booking not touched by this feature —
-- satisfies "the existing reaper's behavior for regular bookings must
-- not change." CREATE OR REPLACE preserves the function's existing
-- REVOKE/GRANT state, but both are restated below anyway for the same
-- defensive-idempotency reason the original migration did.
CREATE OR REPLACE FUNCTION public.reap_stale_pending_bookings()
RETURNS integer AS $$
DECLARE
  v_reaped integer;
BEGIN
  WITH reaped AS (
    UPDATE public.bookings
       SET status       = 'cancelled',
           cancelled_at = now()
     WHERE status              = 'pending_payment'
       AND stripe_payment_id   IS NULL
       AND deleted_at          IS NULL
       AND is_admin_hold       = false
       AND created_at          < now() - interval '35 minutes'
    RETURNING id
  )
  SELECT count(*) INTO v_reaped FROM reaped;

  RETURN v_reaped;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public, pg_catalog;

REVOKE EXECUTE ON FUNCTION public.reap_stale_pending_bookings() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.reap_stale_pending_bookings() TO service_role;
```

**Rollback for this migration:** `DROP FUNCTION IF EXISTS public.admin_promote_waitlist_to_hold(uuid, integer, timestamptz);` then re-apply `20260515095343`'s original `reap_stale_pending_bookings()` body (without the added predicate) via a follow-up migration if a full revert is ever needed. Not destructive either direction — no data loss, only future behaviour changes.

### 6.6 Migration file — `supabase/migrations/20260713000003_revert_expired_admin_holds_pgcron_schedule.sql`

Contains: §6.1 + §6.2 verbatim, plus an apply-time `RAISE NOTICE` block mirroring `20260515095343`'s own (job name, cadence, and the exact `cron.job` verification query), per this project's established deploy-checklist habit (project memory: a manual probe returning 200 does not prove the schedule is firing — verify an actual scheduled tick lands in `cron.job_run_details`).

---

## 7. Email

**New file, not the dead `pending_payment` branch of `booking-confirmation.ts`.** Three reasons, weighed against the two existing candidates:

- `booking-confirmation.ts`'s `pending_payment` variant is dead code (no caller passes that status today) *and* structurally wrong for this use — its CTA links back to the general event page (`renderButton({ href: eventUrl })`), not to a live Stripe Checkout URL. There's no `checkoutUrl` field anywhere in `BookingConfirmationInput`. Reusing it would mean either bolting on a field that only this one caller ever populates (muddying a "general booking status" template with hold-specific concerns), or sending an email whose CTA doesn't actually take the recipient to checkout.
- `waitlist-spot-available.ts` is the closer structural match (direct external action link, price shown in the CTA label) but its copy is explicitly written for a **race**: "First to claim it wins," "If someone else claims it first, no problem — you're still on the waitlist." That framing is actively wrong for this feature — there is no race, the admin reserved this seat for one specific person. Repurposing it as-is would misrepresent the offer.
- A new file costs nothing extra: it reuses every existing shared primitive (`COLORS`, `renderButton`, `renderDetailRow`, `renderShell`, `escapeHtml`, `htmlToText`, `getSiteUrl` from `_shared.ts`) with zero new shared infrastructure, exactly like every other template in this directory.

**New file:** `src/lib/email/templates/waitlist-promotion.ts`, exporting `waitlistPromotionTemplate()`.

Fields (architecture-level — structure and branches, not final prose; see note below):

```ts
interface WaitlistPromotionInput {
  fullName: string
  eventTitle: string
  eventSlug: string
  eventDate: string        // pre-formatted (formatDateFull), like every other template
  eventTime: string        // pre-formatted (formatTime)
  priceInPence: number
  bookingFeePence: number
  checkoutUrl: string      // passed in directly — this template does not construct it (createAdminBookingHold already has it from Stripe)
  holdExpiresAt: string | null   // pre-formatted display string, or null
}
```

Structural branches:
- Heading/lead copy framed as an exclusive offer ("you've been given this spot"), not a race — the one deliberate copy divergence from `waitlist-spot-available.ts` that actually matters.
- Detail rows (event/date/time) + a ticket/fee/total breakdown, structurally mirroring `booking-confirmation.ts`'s existing breakdown table so the "ticket + booking fee + total, fee is non-refundable" pattern reads identically across every email in this codebase that shows a price.
- CTA button → `checkoutUrl` directly (no intermediate "claim" page, unlike `waitlist-spot-available.ts` — there's nothing to claim, the admin already assigned the seat).
- Conditional urgency block: `holdExpiresAt` present → a clear deadline line ("reserved until X — after that we may need to offer it to someone else"); `holdExpiresAt` null → no countdown language, a neutral "complete payment to secure your spot" line.

**I'm deliberately not hand-authoring final marketing copy here** — writing user-facing prose is `ux-designer` territory per my role boundaries, and separately, the user has already said they'll review the exact copy and charge amount before anything sends to Amy/Yasemin. What's specified above is the contract (fields, branches, CTA target) a `backend-developer` needs to build the template and wire it into `createAdminBookingHold`; wording is a review step, not an architecture decision.

---

## 8. Sequencing recommendation

### 8.1 Urgent slice — unblocks Amy + Yasemin today

Ships as one PR. Everything here is required; nothing here is deferred.

1. **Migration `20260713000001`** (§2.4) — `is_admin_hold` / `admin_hold_expires_at` columns + both CHECK constraints. Small, additive, safe.
2. **Migration `20260713000002`** (§6.5) — `admin_promote_waitlist_to_hold` RPC + the one-line reaper predicate fix. *This is the piece that actually protects Amy/Yasemin from the 35-minute reaper* — see §1. **No cron migration yet** — `20260713000003` is systemic-only and not needed today.
3. `src/lib/stripe/checkout.ts` — add `expiresInSeconds?: number` to `CheckoutSessionInput`, default-preserving (§3.3).
4. New `src/lib/bookings/admin-hold.ts` — `createAdminBookingHold()` (§3.2) + the two formula functions (§3.3, §4.3).
5. New `src/lib/email/templates/waitlist-promotion.ts` (§7).
6. `src/app/(admin)/admin/actions.ts` — rewrite `promoteFromWaitlist` per §4.1, **with `holdExpiresAt` hardcoded to `null`** (not yet calling `computeHoldExpiresAt`, since that formula only matters once the revert-cron exists to act on a non-null value — see the flagged tradeoff below).
7. `src/app/api/stripe/webhook/route.ts` — fix #1 in §5.
8. `src/app/events/[slug]/actions.ts` — fix #2 in §5 (`abandonPendingCheckout`'s `from` union + column-clearing).
9. Optionally, same PR: fix #4 in §5 (`cancelEventAndRefundBookings`) — cheap, not blocking.

**Then, operationally (not code):** render `waitlistPromotionTemplate` with Amy's and Yasemin's real data (name, event, price, a placeholder/test `checkoutUrl`) and share the rendered output for review — this is the "show the user the exact copy and charge amount" gate the user asked for, satisfied as a process step before the real click, not as a feature to build. Once approved, click "Promote" on each of their bookings through the existing admin UI (no new UI, no script) — the rewritten `promoteFromWaitlist` handles the rest end-to-end: RPC → Stripe customer → Checkout Session → email with the real payment link.

**Flagged tradeoff, explicitly:** hardcoding `holdExpiresAt: null` in step 6 means *every* admin promotion of a paid-event waitlist entry gets a no-deadline hold until the systemic slice ships — not just Amy's and Yasemin's. Given this platform currently has effectively one admin and the systemic slice is meant to follow "right behind," I think this is an acceptable, clearly-time-boxed gap rather than a reason to block the urgent fix on building the cron first. Worth stating out loud rather than leaving implicit.

### 8.2 Systemic slice — right behind, unblocked by the urgent slice

1. **Migration `20260713000003`** (§6.6) — `revert_expired_admin_holds()` + pg_cron schedule. Deploy checklist: after `supabase db push --include-all --linked`, confirm a real scheduled tick lands in `cron.job_run_details` for job `revert-expired-admin-holds` — a manual `SELECT public.revert_expired_admin_holds();` probe returning `0` is not sufficient proof the schedule itself is firing (per this project's cron-incident history).
2. Flip step 6 above from `holdExpiresAt: null` to `holdExpiresAt: computeHoldExpiresAt(event.date_time)` (§4.3) — a one-line change, the formula was already written and shipped in the urgent slice, just unused until now.
3. Optional, deferred to product/UX: an admin-facing override to force a no-deadline hold on a per-promotion basis, for cases like Amy/Yasemin arising again in the future without needing another manual code change. Not designed here — see §9.

---

## 9. Open questions / flags for the developer

1. **Copy sign-off.** Exact email wording and the charge amount shown to Amy/Yasemin — user has explicitly reserved this review step; not resolved here (§7).
2. **Free-branch capacity-check widening (§4.2).** Recommended but optional — confirm whether to touch the free branch's predicate or leave it byte-identical.
3. **`cancelEventAndRefundBookings` fix (§5, site #4).** Not launch-blocking; recommended to bundle into the urgent-slice PR anyway since it's a 2-line addition in a file already being touched, but confirm.
4. **`cancelBooking` — quick verification, not a design decision.** I believe it never touches a `pending_payment` row (§5, closing note) but didn't fully verify its guard clause; a fast confirming read is worth doing before considering this feature complete.
5. **Per-promotion "no deadline" override in the admin UI (§8.2.3).** Out of scope here — a UX/product decision about whether admins need this control beyond the current formula-driven default, not something I'm resolving.
6. **Permanent audit trail.** I considered and deliberately did not add a third, never-cleared column (e.g., `promoted_from_waitlist_at`) purely for "how many promotions have ever happened" reporting — `is_admin_hold` is intentionally transient/lifecycle-scoped (§2.3), not an audit log. If that reporting need becomes real, it's a separate, small addition (or could ride on the existing `notifications` table, which already logs the promotion email) — flagging as deferred, not forgotten.

---

## Cross-reference

Add to `SYSTEM-DESIGN.md`, near ADR-14 (the other Stripe/booking-fee-adjacent decision):

> **Reference:** See `SYSTEM-DESIGN-admin-waitlist-promotion-payment.md` for the admin waitlist-promotion payment-hold mechanism (`is_admin_hold` / `admin_hold_expires_at`, `admin_promote_waitlist_to_hold` RPC, `revert_expired_admin_holds` cron).
