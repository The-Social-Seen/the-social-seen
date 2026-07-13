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

---

# Addendum (2026-07-13, same day) — Gap A: remediate an unpaid `confirmed` booking; Gap B: manually release an active hold

> Produced by: Architect agent (addendum pass, mid-incident)
> Date: 2026-07-13
> Status: Spec — hand to `backend-developer` for implementation
> Base branch: `claude/event-payment-confirmation-175811` (PR #113, not yet merged). The base spec above (§0–§9) is already implemented on this branch — migrations `20260713000001` and `20260713000002` are live in the repo, `admin-hold.ts`, `waitlist-promotion.ts`, `promoteFromWaitlist`, the webhook fix, and the `abandonPendingCheckout` fix are all shipped and match the base spec exactly. This addendum builds directly on that code — see §Addendum-D for the precise diff shape.

This addendum does not replace or revise §0–§9 above. Two new, narrow gaps, discovered mid-incident, both real production bookings (Amy Sangam, Yasemin Salp — confirmed, paid event, `stripe_payment_id IS NULL`) blocking a payment link that needs to go out **today**.

---

## Addendum §0 — TL;DR

| Item | Detail |
|---|---|
| Gap A | Two production bookings are `status='confirmed'` on a paid event with `stripe_payment_id IS NULL` — the exact bug this whole PR fixes, except it already happened to them *before* the fix existed. `admin_promote_waitlist_to_hold` cannot touch them (hard-rejects anything not `waitlisted`). |
| Gap B | No admin action exists to manually release an active `pending_payment` hold back to `waitlisted` if the member doesn't pay. Stand-in for the still-deferred, still-not-being-built 4h auto-revert cron. |
| New RPC (Gap A) | `public.admin_hold_confirmed_booking_for_payment(p_booking_id, p_booking_fee_pence, p_hold_expires_at)` — admin-gated, requires `status='confirmed' AND stripe_payment_id IS NULL`, on a **paid** event, **capacity check deliberately skipped** (§A.1). |
| New RPC (Gap B) | `public.admin_revert_hold_to_waitlist(p_booking_id)` — admin-gated, origin-agnostic (`is_admin_hold=true AND status='pending_payment'` is the whole predicate), always reverts to `waitlisted`, never `confirmed`. |
| Schema changes | **None.** Both gaps are solved entirely with the columns migration `20260713000001` already shipped (`is_admin_hold`, `admin_hold_expires_at`). No new columns, no new enum values, no RLS changes. |
| TS refactor | `src/lib/bookings/admin-hold.ts`: `createAdminBookingHold` (existing, unchanged public contract) is re-implemented as a thin wrapper over a new internal `runAdminHoldFlow()`, driven by a small origin-config lookup table — so the rollback-destination difference (§Addendum-A.4) is structurally impossible to mix up, not just "commented carefully." New public export `createAdminPaymentRemediationHold()` is the second thin wrapper. New, separate public export `releaseAdminBookingHold()` for Gap B. |
| New email | `confirmedUnpaidPaymentLinkTemplate()` in new file `src/lib/email/templates/confirmed-unpaid-payment-link.ts` — deliberately NOT `waitlistPromotionTemplate` (wrong framing — these two never left the waitlist this cycle; see §Addendum-A.5). |
| New Server Actions | `sendPaymentLinkForConfirmedBooking(bookingId)` and `demoteAdminHold(bookingId)` in `src/app/(admin)/admin/actions.ts`. |
| New UI | `SendPaymentLinkButton.tsx` and `DemoteHoldButton.tsx` in `src/components/admin/`, wired into `BookingsTable.tsx` alongside the existing `PromoteButton`/`NoShowButton`. |
| Migration | One new file, `supabase/migrations/20260713000004_admin_hold_confirmed_booking_and_release_rpcs.sql`. Deliberately numbered **past** the reserved `20260713000003` slot (the still-deferred cron migration) so it can never collide when that PR eventually lands — see §Addendum-D. |
| Stripe session expiry on manual demote | **Yes, actively call `stripe.checkout.sessions.expire()`** — but ordered *after* the DB-side revert commits, as a best-effort close, not a precondition gate. Full reasoning in §Addendum-B.2 (this refines, not just confirms, the brief's own instinct). |
| Cron relationship | Gap B's RPC is **not** called by, and does not call, the still-unbuilt `revert_expired_admin_holds()` (§6.1). Deliberately kept as a sibling with a different WHERE-predicate (time-gated bulk vs ungated single-row-admin-gated). Reasoning in §Addendum-B.6. The deferred cron migration file is not touched. |

---

## Addendum §0.1 — Validating the brief's own reasoning

Going through the five numbered points in the brief in order, since it explicitly asked for validation rather than silent agreement:

1. **Separate RPC, not a modification of `admin_promote_waitlist_to_hold`; capacity check skipped.** Confirmed on both counts — see §Addendum-A.1 for the full capacity-check argument (I agree with it and can't find a hole in it). Refined: the precondition needs to be tighter than stated. `status='confirmed' AND stripe_payment_id IS NULL AND deleted_at IS NULL` is necessary but not sufficient — the RPC also needs a defensive `price_at_booking > 0` check, because `booking_fee_pence` is about to be set to a positive number and the existing `chk_bookings_free_no_booking_fee` CHECK (`price_at_booking > 0 OR booking_fee_pence = 0`) will reject that combination if `price_at_booking` is ever 0 on a row that shouldn't be. See §Addendum-A.2.
2. **One RPC, origin-agnostic, always reverts to `waitlisted`.** Confirmed — this is exactly right, and the reasoning ("reverting to `confirmed` would silently recreate the bug") is correct. On "reuse/extract the same UPDATE shape... your call which is cleaner": I decided **not** to make the future cron call this new RPC in a loop — full reasoning in §Addendum-B.6. The UPDATE shape is kept textually identical in spirit (same three column assignments, same post-recompute step) without an actual call-through relationship, because the two functions' WHERE-predicates are genuinely different (time-gated bulk vs ungated single-row), not just two copies of the same operation.
3. **Actively call `stripe.checkout.sessions.expire()`.** Confirmed the instinct, refined the mechanics: it should run *after* the DB revert (not before, not as a gate), best-effort, non-blocking. I considered and rejected calling it first — full ordering argument in §Addendum-B.2.
4. **Shared internal logic, two thin entry points, rollback-destination must be impossible to mix up.** Confirmed and concretized: this is exactly what an origin-config lookup table (§Addendum-A.4) buys you that a comment doesn't. On the email question ("your call, but flag it"): a new template is needed, not a conditional branch — same reasoning the base spec already used to justify `waitlist-promotion.ts` as its own file rather than reusing `waitlist-spot-available.ts`. Flagged and resolved in §Addendum-A.5.
5. **UI trace.** Confirmed the diagnosis exactly: `BookingRow` in `BookingsTable.tsx` doesn't carry the two hold columns; the data already flows through at runtime (the page's `...b` spread includes them via `AdminEventBooking`), only the TypeScript *type* blocks reading them. Refined: the page's `getEventBookings` **select does not need to change** — `is_admin_hold`/`admin_hold_expires_at` are already selected (line 1633 of `admin/actions.ts`, shipped in the base PR). The only page-level change needed is a one-line new prop (`isPaidEvent={event.price > 0}`), and `event.price` is already fetched (`getAdminEventById` does `select('*')`). Full trace in §Addendum-C.

---

## Addendum §A — Gap A: `admin_hold_confirmed_booking_for_payment`

### A.1 — Why the capacity check is skipped (confirming the brief's reasoning)

Agreed, and worth stating precisely why, since every sibling RPC in this family (`book_event`, `book_event_paid`, `claim_waitlist_spot`, `admin_promote_waitlist_to_hold`) *does* have a capacity check, so a reader could reasonably assume its absence here is a bug.

The capacity check in every sibling RPC answers the question "is there a free seat for this NEW admission?" Gap A never admits anyone new — the booking is already `status='confirmed'`, which by this codebase's own accounting (`admin_promote_waitlist_to_hold`'s capacity query counts `status IN ('confirmed', 'pending_payment')`, i.e. `confirmed` already counts as an occupied seat) already occupies a seat today, this instant, before this RPC runs or doesn't. Transitioning `confirmed → pending_payment` doesn't change the seat count in that accounting at all (`pending_payment` is counted exactly the same as `confirmed` everywhere else in this codebase). Adding a capacity gate here would be checking a condition that is, by construction, always already satisfied by the row's own pre-existing state — and worse, on the exact subset of events where it could theoretically read as "over capacity" (e.g. if `capacity` was edited down after the booking was made — `EC-04` in `SYSTEM-DESIGN.md` already establishes the app tolerates this), it would block the one action that fixes the underlying incident. Skipping it is correct, not an oversight — the SQL comment says so explicitly (see §A.2).

### A.2 — SQL: `admin_hold_confirmed_booking_for_payment`

Same shape/family as `admin_promote_waitlist_to_hold` (lock booking, lock event, validate, transition) — admin-gated via the identical in-body role check, same `jsonb_build_object('error', ...)` convention, same `SET search_path = public, pg_catalog` posture, same `p_booking_id / p_booking_fee_pence / p_hold_expires_at` parameter shape (deliberately identical names/order to `admin_promote_waitlist_to_hold` so the shared TS orchestration in §Addendum-A.4 can call either RPC generically).

```sql
CREATE OR REPLACE FUNCTION public.admin_hold_confirmed_booking_for_payment(
  p_booking_id        uuid,
  p_booking_fee_pence integer,
  p_hold_expires_at   timestamptz   -- NULL = no auto-revert (same convention as admin_promote_waitlist_to_hold)
)
RETURNS jsonb AS $$
DECLARE
  v_is_admin          boolean;
  v_event_id          uuid;
  v_user_id           uuid;
  v_current_status    booking_status;
  v_stripe_payment_id text;
  v_price_at_booking  integer;
  v_price             integer;
  v_event_date        timestamptz;
  v_is_cancelled      boolean;
BEGIN
  -- Admin gate — identical pattern to admin_promote_waitlist_to_hold.
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

  -- Lock the booking row.
  SELECT event_id, user_id, status, stripe_payment_id, price_at_booking
  INTO   v_event_id, v_user_id, v_current_status, v_stripe_payment_id, v_price_at_booking
  FROM   public.bookings
  WHERE  id = p_booking_id
    AND  deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Booking not found');
  END IF;

  IF v_current_status != 'confirmed' THEN
    RETURN jsonb_build_object(
      'error',
      CASE
        WHEN v_current_status = 'waitlisted'      THEN 'This booking is still on the waitlist — use Promote instead'
        WHEN v_current_status = 'pending_payment' THEN 'This booking already has a payment link outstanding'
        WHEN v_current_status = 'cancelled'       THEN 'This booking was cancelled'
        WHEN v_current_status = 'no_show'         THEN 'This booking is marked as a no-show'
        ELSE 'Only confirmed bookings can be sent a payment link'
      END
    );
  END IF;

  -- The defining precondition. The row IS 'confirmed' at this point
  -- either way — only stripe_payment_id distinguishes "paid, all good,
  -- leave alone" from "the exact bug this RPC exists to remediate."
  -- Checked as its own branch (not folded into the status CASE above)
  -- because it needs a different, more specific message: sending a
  -- second payment link to someone who has already paid risks a
  -- duplicate charge, which is a materially worse mistake than any of
  -- the status-mismatch cases above.
  IF v_stripe_payment_id IS NOT NULL THEN
    RETURN jsonb_build_object('error', 'This booking has already been paid');
  END IF;

  -- Lock the event row.
  SELECT price, date_time, is_cancelled
  INTO   v_price, v_event_date, v_is_cancelled
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

  -- Nothing to remediate on a free event — a confirmed seat there is
  -- already correct and final. Mirrors admin_promote_waitlist_to_hold's
  -- own "free events aren't held" guard.
  IF v_price = 0 THEN
    RETURN jsonb_build_object('error', 'This is a free event — nothing to remediate');
  END IF;

  -- Defensive: chk_bookings_free_no_booking_fee
  -- (price_at_booking > 0 OR booking_fee_pence = 0) would reject setting
  -- a nonzero booking_fee_pence on a row whose price_at_booking is <= 0.
  -- That combination should be impossible for a genuinely paid event,
  -- but if some historical data anomaly produced it (e.g. the booking
  -- was created back when the event was priced differently, or a prior
  -- manual data fix went wrong), fail with a clear, specific message
  -- instead of a raw, confusing 23514 constraint-violation error.
  IF v_price_at_booking <= 0 THEN
    RETURN jsonb_build_object(
      'error',
      'This booking has no ticket price on record — cannot collect payment. Needs manual investigation before retrying.'
    );
  END IF;

  -- Deliberately NO capacity check — see
  -- SYSTEM-DESIGN-admin-waitlist-promotion-payment.md Addendum §A.1.
  -- This booking already occupies its seat as 'confirmed' today;
  -- requiring payment for a seat already held is not a new admission.
  -- Gating this on capacity would perversely block remediation on
  -- exactly the at-capacity events most likely to need it (the ones
  -- with a waitlist in the first place).

  -- Transition. waitlist_position is untouched — a 'confirmed' booking
  -- never carries one (the state machine never sets it for this
  -- status), so there is nothing to preserve or null out.
  UPDATE public.bookings
  SET    status                 = 'pending_payment',
         booking_fee_pence      = p_booking_fee_pence,
         is_admin_hold          = true,
         admin_hold_expires_at  = p_hold_expires_at
  WHERE  id                 = p_booking_id
    AND  status             = 'confirmed'
    AND  stripe_payment_id IS NULL;

  RETURN jsonb_build_object(
    'booking_id', p_booking_id,
    'user_id',    v_user_id,
    'status',     'pending_payment'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public, pg_catalog;

REVOKE EXECUTE ON FUNCTION public.admin_hold_confirmed_booking_for_payment(uuid, integer, timestamptz) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_hold_confirmed_booking_for_payment(uuid, integer, timestamptz) TO authenticated;
```

**Why this name, not the brief's suggested `admin_send_payment_link_for_confirmed_booking`:** this RPC only performs the DB transition — it doesn't send anything (no Stripe call, no email; that's the TS orchestration layer, §Addendum-A.4). `admin_promote_waitlist_to_hold` sets the precedent: its TS wrapper also sends a payment-link email, but the RPC's own name describes the DB transition ("to `hold`"), not the downstream side-effect. `admin_hold_confirmed_booking_for_payment` follows that exact pattern. The Server Action that *does* describe the full user-facing effect is named `sendPaymentLinkForConfirmedBooking` (§Addendum-A.6) — the same two-tier split that already exists between `admin_promote_waitlist_to_hold` (RPC) and `promoteFromWaitlist` (Server Action).

**No new CHECK constraints needed.** Both existing constraints from migration `20260713000001` already cover this RPC's writes as column-level invariants, not RPC-specific ones: `chk_bookings_admin_hold_requires_pending_payment` is satisfied because the UPDATE sets `status='pending_payment'` in the same statement as `is_admin_hold=true`; `chk_bookings_admin_hold_expiry_requires_flag` is satisfied regardless of whether `p_hold_expires_at` is NULL, since `is_admin_hold=true` makes it vacuously true.

### A.3 — `sendPaymentLinkForConfirmedBooking` hardcodes `holdExpiresAt: null`, same as `promoteFromWaitlist`

For exactly the same reason already accepted and documented for the base spec (§8.1 step 6 / §8.2 step 2): the revert-cron that would act on a non-null deadline (`revert_expired_admin_holds`, migration `20260713000003`) still doesn't exist and isn't being built now (explicit constraint on this task). Setting a real deadline today would create a hold nothing ever reverts automatically — Gap B (manual release) exists precisely to cover that gap in the interim. `computeHoldExpiresAt()` (already exported from `admin-hold.ts`, unused by design) is **not** wired up for Gap A either, for full symmetry with the waitlist-promotion path — there is no reason for the two remediation paths to have different deadline policies while the cron doesn't exist for either. When the systemic cron slice eventually ships, flipping both callers from `null` to `computeHoldExpiresAt(event.date_time)` is a one-line change each, in the same pass.

### A.4 — TS: refactoring `admin-hold.ts` around a shared flow + origin config

**Constraint that must hold:** `createAdminBookingHold`'s existing public signature, behavior, and test coverage (`src/lib/bookings/__tests__/admin-hold.test.ts`, `src/app/(admin)/admin/__tests__/actions-promote-waitlist-paid.test.ts`) must be preserved byte-for-byte. This is a refactor of *internals only* — the waitlist-promotion path must not change in any observable way.

Add a small origin-config table and an internal flow function. The two existing per-origin differences — which RPC to call, and where to roll back to on Stripe/profile failure — become table lookups instead of hand-written duplicate logic, which is what makes the rollback-destination mistake the brief is worried about structurally impossible rather than merely "commented against":

```ts
// ── Origin config (Addendum §A.4) ───────────────────────────────────────────
//
// The two admin-hold flows (waitlist promotion, confirmed-booking payment
// remediation) share every step except: which RPC transitions the row,
// where to roll back to if Stripe/profile lookup fails AFTER the RPC has
// already committed, and which email template to send. Expressing those
// three differences as one lookup table — instead of two near-duplicate
// functions — means a future edit to one origin's rollback destination
// can't accidentally leak into the other by copy-paste.

type AdminHoldOrigin = 'waitlist_promotion' | 'payment_remediation'

/** Fields every hold-notification email needs, regardless of origin.
 *  Deliberately NOT imported from waitlist-promotion.ts (whose
 *  `WaitlistPromotionInput` name is specific to that origin) — kept
 *  local here so the already-shipped, tested waitlist-promotion.ts file
 *  requires zero changes. Both waitlistPromotionTemplate's existing
 *  input type and the new confirmedUnpaidPaymentLinkTemplate's input
 *  type are structurally identical to this, so TypeScript accepts
 *  either as `renderEmail` below without any explicit coupling. */
interface AdminHoldEmailContext {
  fullName: string
  eventTitle: string
  eventSlug: string
  eventDate: string
  eventTime: string
  priceInPence: number
  bookingFeePence: number
  checkoutUrl: string
  holdExpiresAt: string | null
}

interface AdminHoldOriginConfig {
  rpcName: 'admin_promote_waitlist_to_hold' | 'admin_hold_confirmed_booking_for_payment'
  /** Where to roll back to if Stripe/profile lookup fails AFTER the RPC
   *  already committed the transition. THE field this whole refactor
   *  exists to make foolproof. */
  rollbackStatus: 'waitlisted' | 'confirmed'
  templateName: string
  notificationType: 'waitlist' | 'reminder'
  renderEmail: (input: AdminHoldEmailContext) => RenderedTemplate
}

const ADMIN_HOLD_ORIGINS: Record<AdminHoldOrigin, AdminHoldOriginConfig> = {
  waitlist_promotion: {
    rpcName: 'admin_promote_waitlist_to_hold',
    rollbackStatus: 'waitlisted',   // unchanged from today's behaviour
    templateName: 'waitlist_promotion',
    notificationType: 'waitlist',
    renderEmail: waitlistPromotionTemplate,
  },
  payment_remediation: {
    rpcName: 'admin_hold_confirmed_booking_for_payment',
    // NOT 'waitlisted' — they were never waitlisted this cycle. If
    // Stripe/profile lookup fails after the RPC already flipped them to
    // pending_payment, the honest rollback is back to 'confirmed'
    // (unpaid) — functionally a no-op that leaves them exactly where
    // they started, still needing remediation, not worse off.
    rollbackStatus: 'confirmed',
    templateName: 'confirmed_unpaid_payment_link',
    notificationType: 'reminder',
    renderEmail: confirmedUnpaidPaymentLinkTemplate,
  },
}

async function runAdminHoldFlow(
  origin: AdminHoldOrigin,
  supabaseUserScoped: SupabaseClient,
  bookingId: string,
  options: { holdExpiresAt: Date | null },
): Promise<CreateAdminBookingHoldResult> {
  const config = ADMIN_HOLD_ORIGINS[origin]
  const admin = createAdminClient()

  // Steps 1–3 (fetch booking, fetch event, defensive free-event guard,
  // compute bookingFeePence) — IDENTICAL to today's createAdminBookingHold
  // steps 1–3, unchanged.
  //
  // Step 4 — the only RPC-call-site change: config.rpcName instead of the
  // literal 'admin_promote_waitlist_to_hold' string.
  const { data: rpcData, error: rpcError } = await supabaseUserScoped.rpc(
    config.rpcName,
    {
      p_booking_id: bookingId,
      p_booking_fee_pence: bookingFeePence, // from step 3
      p_hold_expires_at: options.holdExpiresAt?.toISOString() ?? null,
    },
  )
  // Step 5 — unwrap RPC error — IDENTICAL.
  // Steps 6–8 (profile fetch, ensureStripeCustomer, Checkout Session) —
  // IDENTICAL.
  // Step 9a (persist session id) — IDENTICAL.
  // Step 9b (email) — config.renderEmail(...) instead of the literal
  // waitlistPromotionTemplate(...) call; config.templateName /
  // config.notificationType instead of the literal 'waitlist_promotion'
  // string and 'waitlist' value passed to sendEmail().
  // Step 9c (success return) — IDENTICAL.
  //
  // Step 10 (catch — Stripe/profile failure) — THE parameterized branch:
  //   await admin.from('bookings').update({
  //     status: config.rollbackStatus,
  //     is_admin_hold: false,
  //     admin_hold_expires_at: null,
  //   }).eq('id', bookingId).eq('status', 'pending_payment')
  // ...
}

export async function createAdminBookingHold(
  supabaseUserScoped: SupabaseClient,
  bookingId: string,
  options: { holdExpiresAt: Date | null },
): Promise<CreateAdminBookingHoldResult> {
  return runAdminHoldFlow('waitlist_promotion', supabaseUserScoped, bookingId, options)
}

export async function createAdminPaymentRemediationHold(
  supabaseUserScoped: SupabaseClient,
  bookingId: string,
  options: { holdExpiresAt: Date | null },
): Promise<CreateAdminBookingHoldResult> {
  return runAdminHoldFlow('payment_remediation', supabaseUserScoped, bookingId, options)
}
```

`CreateAdminBookingHoldResult` (existing interface) is reused unchanged for both — its shape (`success`, `error?`, `status?: 'pending_payment'`, `checkoutUrl?`, `holdExpiresAt?`) is already origin-agnostic.

### A.5 — New email: `confirmedUnpaidPaymentLinkTemplate`

**Why a new file, not a conditional branch inside `waitlist-promotion.ts`:** the same three reasons the base spec (§7) already used to reject reusing `waitlist-spot-available.ts`, applied to this new pairing:

- `waitlistPromotionTemplate`'s copy is explicitly framed as "you were on the waitlist... we've set a seat aside." That is **factually wrong** for Amy/Yasemin — they were never told they left a confirmed seat, and telling them they were "on the waitlist" when they believe they already hold a ticket is actively confusing, and could read as a mistake or a scam attempt ("wait, was I on a waitlist? I thought I had a ticket").
- A conditional branch bolted onto a single-purpose template muddies it for two audiences — the exact anti-pattern the base spec already rejected for `booking-confirmation.ts`'s dead `pending_payment` branch.
- A new file costs nothing extra — it reuses the same shared primitives (`COLORS`, `renderButton`, `renderDetailRow`, `renderShell`, `escapeHtml`, `htmlToText`, `getSiteUrl`, `formatPriceExact`) with zero new shared infrastructure, exactly like every other template in this directory.

New file: `src/lib/email/templates/confirmed-unpaid-payment-link.ts`, exporting `confirmedUnpaidPaymentLinkTemplate()`.

```ts
export interface ConfirmedUnpaidPaymentLinkInput {
  fullName: string
  eventTitle: string
  eventSlug: string
  eventDate: string        // pre-formatted (formatDateFull)
  eventTime: string        // pre-formatted (formatTime)
  priceInPence: number
  bookingFeePence: number
  checkoutUrl: string
  holdExpiresAt: string | null   // pre-formatted, or null — see below
}
```

Structural differences from `waitlistPromotionTemplate` (everything else — the price breakdown table, the CTA button, the urgency-block conditional shape — is identical, reused verbatim as a pattern):

- **Subject** (illustrative, not final — see disclaimer below): `Action needed: complete payment for {eventTitle}` — not `You're in: {eventTitle}` (which implies a fresh admission).
- **Heading/opening line** (illustrative): "Let's finish confirming your spot." / "Hi {firstName} — you have a confirmed place at {eventTitle}, but we're missing a completed payment on our side. To keep your spot, please complete payment below." — explicitly does **not** mention the waitlist anywhere.
- Urgency block: same conditional structure as `waitlistPromotionTemplate` (deadline text if `holdExpiresAt` is set, neutral "complete payment to secure your spot" line if `null`) — reused as-is; the underlying claim ("after that we may need to offer the spot to someone else") is equally true for a remediated hold, since Gap B's demote is exactly the mechanism that would carry that out.

**Illustrative only, not final** — same discipline as the base spec's §7: exact wording and the amount shown to Amy/Yasemin is the user's own explicitly-reserved review step, not resolved here. The backend-developer implementing this should mark the copy "first draft in house style, not final" in the file header, exactly matching `waitlist-promotion.ts`'s own existing disclaimer comment.

### A.6 — New Server Action: `sendPaymentLinkForConfirmedBooking`

In `src/app/(admin)/admin/actions.ts`, alongside `promoteFromWaitlist`:

```ts
export async function sendPaymentLinkForConfirmedBooking(bookingId: string) {
  const { supabase } = await requireAdmin()

  if (!bookingId) return { error: 'Booking ID is required' }

  const { data: booking, error: bookingError } = await supabase
    .from('bookings')
    .select('id, event_id, user_id, status, stripe_payment_id')
    .eq('id', bookingId)
    .is('deleted_at', null)
    .single()

  if (bookingError || !booking) return { error: 'Booking not found' }
  if (booking.status !== 'confirmed') {
    return { error: 'Only confirmed bookings can be sent a payment link' }
  }
  if (booking.stripe_payment_id) {
    return { error: 'This booking has already been paid' }
  }

  const { data: event } = await supabase
    .from('events')
    .select('id, slug, price')
    .eq('id', booking.event_id)
    .single()

  if (!event) return { error: 'Event not found' }
  if (event.price === 0) {
    return { error: 'This is a free event — nothing to remediate' }
  }

  // holdExpiresAt hardcoded null — same deferred-cron tradeoff as
  // promoteFromWaitlist. See Addendum §A.3.
  const result = await createAdminPaymentRemediationHold(supabase, bookingId, {
    holdExpiresAt: null,
  })

  if (!result.success) return { error: result.error }

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', booking.user_id)
    .single()

  revalidatePath('/admin/events')
  revalidatePath(`/admin/events/${event.id}/bookings`)
  revalidatePath(`/events/${event.slug}`)
  revalidatePath('/bookings')

  return {
    success: true,
    memberName: profile?.full_name ?? 'Member',
    status: 'pending_payment' as const,
    holdExpiresAt: result.holdExpiresAt ?? null,
  }
}
```

This pre-validates `status`/`stripe_payment_id`/`event.price` in TS *before* ever calling the RPC — belt-and-braces, matching this family's established habit of the Server Action pre-checking what the RPC will re-validate anyway under lock (see `promoteFromWaitlist`'s own pre-fetch-and-branch, and `admin_promote_waitlist_to_hold`'s independent re-validation of everything `promoteFromWaitlist` already checked).

**Note on `revalidatePath`:** unlike the existing `promoteFromWaitlist`, this includes `/admin/events/${event.id}/bookings` — the actual page this button lives on. The existing `promoteFromWaitlist` does *not* revalidate that nested path today (only `/admin/events`, which is a sibling list page, not this detail page) — a plausible pre-existing gap, flagged here but **not fixed**, since it's outside this addendum's two named gaps. Both new Server Actions in this addendum correctly include the nested path from the start.

---

## Addendum §B — Gap B: `admin_revert_hold_to_waitlist`

### B.1 — Confirming the origin-agnostic design

Agreed without reservation: `is_admin_hold=true AND status='pending_payment'` is a complete, self-sufficient predicate, and the RPC genuinely does not need to know or care whether the row arrived there via `admin_promote_waitlist_to_hold` (Gap A's sibling, the original feature) or via `admin_hold_confirmed_booking_for_payment` (Gap A, this addendum) — both leave the row in an identical `is_admin_hold`/`status` shape. Always reverting to `waitlisted`, never `confirmed`, is correct for the same reason the brief states: reverting a remediated hold to `confirmed`-unpaid would silently recreate the exact incident this whole feature exists to fix. `waitlisted` is the only exit that's safe for every origin.

### B.2 — Stripe Checkout Session expiry: yes, but ordered *after* the DB revert, not before

The brief's own instinct ("yes, since this path has a live request context") is right; here is the refinement on *how*.

**Two possible orderings, and why DB-first wins:**

- **Stripe-expire-first, then DB-revert:** if `expire()` succeeds, the race window is provably zero from that point on — the session is dead, no payment can ever complete on it, and the DB revert that follows is safe by construction. Attractive on paper. But it requires interpreting Stripe's error response to decide whether to proceed: if `expire()` fails because the session already has a successful payment, the DB revert must be **aborted**, not attempted — reverting a booking that was just legitimately paid for would be actively wrong. This makes the DB-revert conditional on correctly parsing a third-party error shape, which is fragile, and this codebase has no existing precedent anywhere for typed Stripe-error inspection (every existing catch block does `err instanceof Error ? err.message : String(err)` — see `cancelEventAndRefundBookings`, `claimWaitlistSpot`, `createAdminBookingHold` itself).
- **DB-revert-first (via the RPC, under `FOR UPDATE`), then Stripe-expire as best-effort:** the RPC's own locked `WHERE is_admin_hold = true AND status = 'pending_payment'` guard means the revert **only actually happens** if the row was still genuinely an active hold at that exact instant inside that transaction. If the webhook had *already* confirmed the booking microseconds earlier (payment succeeded, webhook landed, status flipped to `confirmed`, `is_admin_hold` cleared per the base spec's fix #1), the RPC's UPDATE simply matches zero rows — Postgres's own row-locking means the two writers (this RPC's transaction and the webhook's `.eq('status', 'pending_payment')` UPDATE) are already correctly serialized against each other with no extra code, exactly as the base spec's §6.1 already reasoned through for the cron case. The RPC detects the zero-rows case and returns a clear error rather than silently succeeding (§B.3).

DB-first is simpler, doesn't require guessing at Stripe's error taxonomy, and matches this codebase's dominant, already-established philosophy everywhere else in this family: **the locked SQL transition is the one and only source of truth; everything layered around it (Stripe, email) is best-effort and non-blocking.** I'm going with DB-first.

**Residual risk, named explicitly (same discipline as the base spec's §6.4):** there remains a narrow window — the time between the DB revert committing and the `expire()` call landing at Stripe, typically milliseconds within the same request — during which a payment could theoretically complete. If it does, the webhook's own `.eq('status', 'pending_payment')` guard will find the row already `waitlisted` and no-op: money taken, no reconciliation. This is not a new risk Gap B introduces — it's the same class of risk already accepted for the natural-expiry path throughout the base spec (§6.4's own "residual risk, named explicitly" section) and it's fundamentally the "webhook hasn't landed yet" lag that exists in *any* ordering, not something Stripe-expire-first would have actually eliminated either (Stripe-expire-first only protects the case where our own code is the slow one; it does nothing for genuine webhook-delivery lag on a payment that already succeeded moments before we ever touched this row). Gap B's ordering narrows this window from "up to 15 minutes of cron-polling lag" (the accepted risk for the automatic path) down to "typically sub-second, within one request" for the manual path — a real improvement, not a full close.

**On detecting the "already paid" case specifically:** the TS orchestration (§B.4) should still special-case a `stripe.checkout.sessions.expire()` failure that looks like "session already complete" and escalate it to Sentry with a distinct tag, since — per the above — that specific failure shape is the one case where it might mean a payment just raced the revert. I'm not confident enough in Stripe Node SDK's exact error message/code for this to assert it here (this codebase has no existing precedent to check against, per above) — flagged as an open question for the implementer to verify empirically against the live SDK types (§Addendum-Open-Questions, item 2).

### B.3 — SQL: `admin_revert_hold_to_waitlist`

```sql
CREATE OR REPLACE FUNCTION public.admin_revert_hold_to_waitlist(
  p_booking_id uuid
)
RETURNS jsonb AS $$
DECLARE
  v_is_admin     boolean;
  v_event_id     uuid;
  v_status       booking_status;
  v_is_hold      boolean;
  v_new_position integer;
BEGIN
  -- Admin gate — identical pattern to the other two admin_* RPCs in this family.
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RETURN jsonb_build_object('error', 'Admin access required');
  END IF;

  -- Lock the booking row.
  SELECT event_id, status, is_admin_hold
  INTO   v_event_id, v_status, v_is_hold
  FROM   public.bookings
  WHERE  id = p_booking_id
    AND  deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Booking not found');
  END IF;

  -- Deliberately origin-agnostic — see Addendum §B.1. This RPC doesn't
  -- need to know or care whether the row became a hold via
  -- admin_promote_waitlist_to_hold or admin_hold_confirmed_booking_for_payment.
  -- Also the guard that makes the DB-first Stripe-expiry ordering safe
  -- (Addendum §B.2): if the webhook already confirmed this booking a
  -- moment ago, this branch fires and the caller learns the hold is
  -- already gone, instead of the UPDATE below silently matching zero
  -- rows and returning a falsely-successful response.
  IF NOT v_is_hold OR v_status != 'pending_payment' THEN
    RETURN jsonb_build_object(
      'error',
      'This booking is not an active payment hold — it may have already been paid, cancelled, or reverted.'
    );
  END IF;

  -- Always reverts to 'waitlisted' — never 'confirmed', even for a hold
  -- that originated from admin_hold_confirmed_booking_for_payment (Gap
  -- A). Reverting a remediated hold to an unpaid 'confirmed' would
  -- silently recreate the exact incident this whole feature exists to
  -- fix. 'waitlisted' is the only sane exit for ANY hold, regardless of
  -- origin. See Addendum §B.1.
  UPDATE public.bookings
  SET    status                 = 'waitlisted',
         is_admin_hold          = false,
         admin_hold_expires_at  = NULL
  WHERE  id                     = p_booking_id
    AND  status                 = 'pending_payment'
    AND  is_admin_hold          = true;

  -- Recompute waitlist numbering for the affected event — this
  -- booking's frozen waitlist_position can now collide with positions
  -- reassigned while it was held. Identical reasoning to
  -- revert_expired_admin_holds() (base spec §2.3, §6.3) — deliberately
  -- NOT calling that (still-unbuilt) function; see Addendum §B.6.
  -- recompute_waitlist_positions is GRANTed to `authenticated` only
  -- (not service_role), but that grant governs external PostgREST
  -- invocation, not this in-body PERFORM from another SECURITY DEFINER
  -- function owned by the same role — identical reasoning already
  -- established for revert_expired_admin_holds' own call (base spec
  -- §6.1). No additional grant needed.
  PERFORM public.recompute_waitlist_positions(v_event_id);

  SELECT waitlist_position INTO v_new_position
  FROM   public.bookings
  WHERE  id = p_booking_id;

  RETURN jsonb_build_object(
    'booking_id',         p_booking_id,
    'event_id',           v_event_id,
    'status',             'waitlisted',
    'waitlist_position',  v_new_position
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public, pg_catalog;

REVOKE EXECUTE ON FUNCTION public.admin_revert_hold_to_waitlist(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_revert_hold_to_waitlist(uuid) TO authenticated;
```

No `event_date < now()` guard, deliberately — releasing a hold doesn't depend on the event being in the future. If anything it's *more* useful for after-the-fact cleanup on a just-passed event (same spirit as `SYSTEM-DESIGN.md`'s `EC-03`, which already accepts past-event waitlist entries as an admin-managed cleanup case, not an error state).

No `p_reason` / audit column, deliberately — matching the base spec's own explicit restraint (§9, item 6): `notifications` (the email log) plus Sentry (for the Stripe-race case, §B.2/§B.4) already provide adequate audit surface for a demo-scale admin tool. If a permanent "who demoted what, when, why" log becomes a real product need, that's a separate, small addition later.

### B.4 — TS: `releaseAdminBookingHold`

New export in `src/lib/bookings/admin-hold.ts`, alongside `createAdminBookingHold` / `createAdminPaymentRemediationHold`. Structurally separate from the `runAdminHoldFlow`/`ADMIN_HOLD_ORIGINS` machinery (§A.4) — releasing is a fundamentally different operation (reverting an existing hold, not creating one), and forcing it through the same config table would add branching complexity for zero code reuse (there's no RPC-name/rollback-status/email-template axis to share — release has exactly one RPC, one destination, no email in this design).

```ts
export interface ReleaseAdminBookingHoldResult {
  success: boolean
  error?: string
  status?: 'waitlisted'
  waitlistPosition?: number | null
}

export async function releaseAdminBookingHold(
  supabaseUserScoped: SupabaseClient,
  bookingId: string,
): Promise<ReleaseAdminBookingHoldResult> {
  // 1. DB-side revert FIRST — authoritative. See Addendum §B.2 for why
  // this must happen before the Stripe-expire call, not after or
  // gated-by-it.
  const { data: rpcData, error: rpcError } = await supabaseUserScoped.rpc(
    'admin_revert_hold_to_waitlist',
    { p_booking_id: bookingId },
  )

  if (rpcError) {
    console.error('[releaseAdminBookingHold] RPC error:', rpcError.message)
    return { success: false, error: 'Something went wrong. Please try again.' }
  }

  const rpcResult = rpcData as Record<string, unknown>
  if (rpcResult.error) {
    return { success: false, error: rpcResult.error as string }
  }

  // 2. Best-effort: proactively expire the outstanding Stripe Checkout
  // Session so a stale link can't be paid after the DB-side revert has
  // already committed. NOT a precondition for step 1 — that already
  // succeeded. A failure here is logged but never rolled back and never
  // surfaced as an error to the admin: the seat is already correctly
  // freed either way. See Addendum §B.2.
  const admin = createAdminClient()
  const { data: booking } = await admin
    .from('bookings')
    .select('stripe_checkout_session_id')
    .eq('id', bookingId)
    .single()

  const sessionId = booking?.stripe_checkout_session_id
  if (sessionId) {
    try {
      const stripe = getStripeClient()
      await stripe.checkout.sessions.expire(sessionId)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      // Heuristic, NOT verified against the live Stripe SDK — see
      // Addendum open question #2. Intent: Stripe refuses to expire a
      // Session that already has a successful payment. If that's what
      // just happened, the member may have paid in the webhook-lag
      // window between our DB revert committing and this call landing
      // (Addendum §B.2's named residual risk) — escalate loudly so an
      // operator reconciles by hand, matching this codebase's existing
      // posture for "payment succeeded but our state doesn't reflect
      // it" (see cancelEventAndRefundBookings' own
      // "Refund issued but booking UPDATE failed" branch).
      const looksAlreadyPaid = /complete|paid|succeeded/i.test(message)
      if (looksAlreadyPaid) {
        Sentry.captureException(err, {
          tags: {
            surface: 'releaseAdminBookingHold',
            signal: 'possible_race_paid_after_revert',
          },
          extra: { bookingId, sessionId },
          level: 'error',
        })
      } else {
        console.warn(
          '[releaseAdminBookingHold] Stripe session expire failed (non-blocking):',
          sessionId,
          message,
        )
      }
    }
  }

  return {
    success: true,
    status: 'waitlisted',
    waitlistPosition: (rpcResult.waitlist_position as number | null) ?? null,
  }
}
```

Requires new imports in `admin-hold.ts`: `getStripeClient` from `@/lib/stripe/server` (not currently imported there — every other Stripe call in this file goes through `createBookingCheckoutSession`/`ensureStripeCustomer` wrappers in `checkout.ts`; this is the first *direct* Stripe SDK call in `admin-hold.ts`).

### B.5 — New Server Action: `demoteAdminHold`

```ts
export async function demoteAdminHold(bookingId: string) {
  const { supabase } = await requireAdmin()

  if (!bookingId) return { error: 'Booking ID is required' }

  // Pre-fetch for revalidatePath targets and the success message only —
  // the RPC re-validates everything that matters for correctness under
  // lock (§B.3). This fetch is UX, not a security boundary.
  const { data: booking, error: bookingError } = await supabase
    .from('bookings')
    .select('id, event_id, user_id')
    .eq('id', bookingId)
    .is('deleted_at', null)
    .single()

  if (bookingError || !booking) return { error: 'Booking not found' }

  const result = await releaseAdminBookingHold(supabase, bookingId)
  if (!result.success) return { error: result.error }

  const [{ data: event }, { data: profile }] = await Promise.all([
    supabase.from('events').select('slug').eq('id', booking.event_id).single(),
    supabase.from('profiles').select('full_name').eq('id', booking.user_id).single(),
  ])

  revalidatePath('/admin/events')
  revalidatePath(`/admin/events/${booking.event_id}/bookings`)
  if (event?.slug) revalidatePath(`/events/${event.slug}`)
  revalidatePath('/bookings')

  return {
    success: true,
    memberName: profile?.full_name ?? 'Member',
    status: 'waitlisted' as const,
    waitlistPosition: result.waitlistPosition ?? null,
  }
}
```

### B.6 — Explicit decision: the future cron does NOT call this RPC (and this RPC does not call it)

The brief asked me to decide whether the future `revert_expired_admin_holds()` cron (base spec §6.1, still unbuilt, still not being built now) should eventually be rewritten to loop over `admin_revert_hold_to_waitlist()` per matched row, or keep its own bulk `UPDATE`.

**Decision: keep them as siblings, sharing the same UPDATE shape in spirit (copy-consistent), with no actual call-through relationship.** Reasoning:

- The two functions' WHERE-predicates are genuinely different, not just "the same operation, different trigger." The cron's predicate is time-gated and narrow: `admin_hold_expires_at < now()` — only *expired* holds. Gap B's predicate is deliberately ungated: an admin can release a hold that hasn't reached its deadline yet, or one with no deadline at all (which, per §A.3/§8.1, is *every* hold right now, since the systemic slice hasn't shipped). Gap B is not "run the cron logic early" — it's a manual override with a strictly broader eligibility set.
- The bulk single-`UPDATE`-for-N-rows form (§6.1) already has its atomicity/race-safety reasoning fully worked through and reviewed in the base spec. Refactoring it into a per-row RPC loop for a migration that doesn't exist yet would mean re-deriving that reasoning for no immediate benefit, and risks the "don't touch the deferred cron migration" constraint on this task by proxy (even though the constraint technically only forbids touching the file, changing the *design* out from under a future implementer without them present to review it seems equally against the spirit of "don't build it now").
- It would not even be *incorrect* to later loop the cron over this RPC (running `recompute_waitlist_positions` once per row instead of once per distinct event within a tick is wasteful, not wrong — it's convergent/idempotent), so this isn't a hard technical blocker either way — it's a genuine judgment call, made in favour of leaving §6.1 completely untouched today and flagging the choice explicitly for whoever builds the cron next (§Addendum-Open-Questions, item 4), rather than deciding it unilaterally now for code that doesn't exist.

---

## Addendum §C — UI wiring

### C.1 — `BookingsTable.tsx`: tracing exactly what needs to change

Current `BookingRow` (local interface, lines 17–32) does not declare `is_admin_hold`/`admin_hold_expires_at`. The **data** for both fields is already present on every row passed in today — `getEventBookings` (`admin/actions.ts` line 1633, shipped in the base PR) already selects `is_admin_hold, admin_hold_expires_at`, `AdminEventBooking` (the function's return type) already carries both, and the page's `normalisedBookings = bookings.map((b) => ({ ...b, profile: ... }))` spread already forwards them. Only the **type** blocks the component from reading them — a pure additive fix:

```ts
interface BookingRow {
  id: string
  status: string
  waitlist_position: number | null
  booked_at: string
  created_at: string
  stripe_payment_id?: string | null
  stripe_refund_id?: string | null
  refunded_amount_pence?: number | null
  cancelled_at?: string | null
  // NEW — admin waitlist-promotion / payment-remediation hold mechanism.
  // Data already flows through from getEventBookings; only the type was
  // missing it. Non-optional booleans (matches the DB column: NOT NULL
  // DEFAULT false).
  is_admin_hold: boolean
  admin_hold_expires_at: string | null
  profile: { id: string; full_name: string; email: string; avatar_url: string | null; phone_number: string | null } | null
}
```

`BookingsTableProps` needs one new prop, `isPaidEvent: boolean` — pre-computed at the page level, following the exact same precedent already set by `isPastEvent` (also pre-computed booleans handed down rather than raw fields the component derives itself):

```ts
interface BookingsTableProps {
  bookings: BookingRow[]
  eventId: string
  isPastEvent?: boolean
  /** NEW — event.price > 0. Gates the "Send payment link" button, which
   *  only makes sense on a paid event (a free 'confirmed' booking has
   *  nothing to remediate — see Addendum §A.2). */
  isPaidEvent?: boolean
}
```

New per-row visibility booleans, alongside the existing `showPromote`/`showNoShow`/`showUndoNoShow` (both desktop and mobile branches read the same three-way-exclusive logic, since `status` values are mutually exclusive — a row can never match more than one of these five conditions at once):

```ts
const showSendPaymentLink =
  isPaidEvent && booking.status === 'confirmed' && !booking.stripe_payment_id
// Defence in depth: is_admin_hold=true already guarantees
// status==='pending_payment' at the DB level (chk_bookings_admin_hold_requires_pending_payment),
// but checking both costs nothing and protects against a stale/inconsistent read.
const showDemote = booking.is_admin_hold === true && booking.status === 'pending_payment'
```

Rendered alongside the existing three buttons in both layouts — desktop `<td className="py-3 text-right">` action cell, and the mobile card's `hasAction` block (which needs widening: `const hasAction = showPromote || showNoShow || showUndoNoShow || showSendPaymentLink || showDemote`):

```tsx
{showSendPaymentLink && <SendPaymentLinkButton bookingId={booking.id} />}
{showDemote && <DemoteHoldButton bookingId={booking.id} />}
```

No `isPastEvent` gate on either new button, deliberately, for consistency with the existing (not idealized) behaviour of `PromoteButton` — it also doesn't gate on `isPastEvent` today, relying entirely on the RPC's own date check as the correctness backstop. Adding an inconsistent UI-layer gate only to the two new buttons would create an unexplained asymmetry for a future reader.

### C.2 — New components

`src/components/admin/SendPaymentLinkButton.tsx` and `src/components/admin/DemoteHoldButton.tsx`, both following `PromoteButton.tsx`'s existing pattern exactly (`useTransition`, `alert(result.error)` for failure — not an inline error span, matching `PromoteButton` specifically since that's the sibling the brief pointed at — inline success message, same gold/danger visual language already used elsewhere in this table). `DemoteHoldButton` adds one thing `PromoteButton` doesn't have: a native `confirm()` guard before calling the action, since demoting is more consequential (kills a live payment link, moves someone off a confirmed-track back onto the waitlist) than promoting — this is my own judgment call, not explicitly requested, flagged in case the developer prefers dropping it for pattern-consistency with the confirm-less `PromoteButton`/`NoShowButton`.

Both call their respective new Server Actions (§A.6, §B.5) and read `result.memberName` (deliberately not `result.promotedName` — nobody was promoted in either flow, and reusing that field name here would be a wrong-but-passing-TypeScript smell).

### C.3 — Page wiring: `src/app/(admin)/admin/events/[id]/bookings/page.tsx`

One line added to the existing `<BookingsTable>` call:

```tsx
<BookingsTable
  bookings={normalisedBookings}
  eventId={id}
  isPastEvent={new Date(event.date_time) < new Date()}
  isPaidEvent={event.price > 0}
/>
```

**No change needed to any data-fetching.** `getAdminEventById(id)` already does `select('*')` on `events`, so `event.price` is already present on the object this page already has in scope — this is purely new prop-passing, zero new queries. This directly confirms the brief's own question 5: the page's `select`/mapping does not need extending; only the JSX does.

---

## Addendum §D — Migration plan

One new file: `supabase/migrations/20260713000004_admin_hold_confirmed_booking_and_release_rpcs.sql`, containing both new functions from §A.2 and §B.3.

**Numbering note:** deliberately `...000004`, skipping past `...000003` — that filename is reserved in the base spec (§6.6) for the still-deferred `revert_expired_admin_holds` cron migration, which this task explicitly must not create or touch. Migration files don't need to be created in a strict unbroken sequence relative to files that don't exist yet; `000004` has no dependency on `000003` (Gap A/B's RPCs are fully independent of the cron), so this ordering is safe and leaves `000003` cleanly available for whoever eventually builds that PR.

Header comment for the new migration should state plainly: **zero new columns, zero new enum values, zero RLS policy changes.** Both gaps are solved entirely using the `is_admin_hold`/`admin_hold_expires_at` columns and their two CHECK constraints, already shipped in `20260713000001`. This migration only adds two new functions.

**Post-merge:** same as every other migration in this project — CI applies to local Supabase only. After merge, run manually: `supabase db push --include-all --linked`. Verify:

```sql
SELECT proname FROM pg_proc
WHERE proname IN ('admin_hold_confirmed_booking_for_payment', 'admin_revert_hold_to_waitlist');
```

**Rollback:** `DROP FUNCTION IF EXISTS public.admin_hold_confirmed_booking_for_payment(uuid, integer, timestamptz);` and `DROP FUNCTION IF EXISTS public.admin_revert_hold_to_waitlist(uuid);`. Not destructive either direction — no data loss, only future behaviour changes. (Any bookings already transitioned via these functions before a rollback would be stuck as `pending_payment`/`is_admin_hold=true` with no RPC left to move them — same class of residual state the base spec already accepts for its own rollback story.)

---

## Addendum §E — Files changed / created (summary)

**New files:**
- `supabase/migrations/20260713000004_admin_hold_confirmed_booking_and_release_rpcs.sql`
- `src/lib/email/templates/confirmed-unpaid-payment-link.ts`
- `src/components/admin/SendPaymentLinkButton.tsx`
- `src/components/admin/DemoteHoldButton.tsx`

**Modified files:**
- `src/lib/bookings/admin-hold.ts` — internal refactor (`runAdminHoldFlow` + `ADMIN_HOLD_ORIGINS`) behind the existing `createAdminBookingHold` export; two new exports (`createAdminPaymentRemediationHold`, `releaseAdminBookingHold`); new `getStripeClient` import.
- `src/app/(admin)/admin/actions.ts` — two new Server Actions (`sendPaymentLinkForConfirmedBooking`, `demoteAdminHold`); new imports (`createAdminPaymentRemediationHold`, `releaseAdminBookingHold`).
- `src/components/admin/BookingsTable.tsx` — `BookingRow` interface gains two fields; `BookingsTableProps` gains `isPaidEvent`; new button-visibility logic + rendering in both desktop and mobile layouts.
- `src/app/(admin)/admin/events/[id]/bookings/page.tsx` — one new prop on the existing `<BookingsTable>` call.

**Not modified (confirmed, not just assumed):**
- `src/types/index.ts` — `AdminEventBooking` already carries `is_admin_hold`/`admin_hold_expires_at` (base PR). No type changes needed for either gap.
- Any RLS policy — both new RPCs are `SECURITY DEFINER` with in-body admin-role checks, identical posture to their siblings.
- `admin_promote_waitlist_to_hold`'s own SQL body — untouched; only called via the refactored shared TS wrapper, same as before.
- The deferred cron migration (`...000003`) — does not exist, not created, not touched.
- `src/lib/email/templates/waitlist-promotion.ts` — untouched; the new email template is a fully separate file (§A.5), and the shared TS type it's compared against (`AdminHoldEmailContext`) is declared locally in `admin-hold.ts`, not imported from this file.

**Test surface (for the tester agent, not written here):** `src/lib/bookings/__tests__/admin-hold.test.ts` needs both a regression pass (the `runAdminHoldFlow` refactor must not change `createAdminBookingHold`'s observable behavior) and new cases for `createAdminPaymentRemediationHold` + `releaseAdminBookingHold`. `src/app/(admin)/admin/__tests__/actions-promote-waitlist-paid.test.ts` or a new sibling file needs cases for `sendPaymentLinkForConfirmedBooking` + `demoteAdminHold`, including the security-relevant ones (non-admin rejected, already-paid rejected, wrong-status rejected, capacity deliberately NOT enforced for Gap A). `src/components/admin/__tests__/BookingsTable.test.tsx` needs cases for the two new button-visibility conditions. New test files likely needed for `SendPaymentLinkButton.tsx` and `DemoteHoldButton.tsx` themselves.

---

## Addendum — Open questions / flags for the developer

1. **Copy sign-off (Gap A email).** Same reserved review step as the base spec's own open question #1 — exact wording and the amount shown to Amy/Yasemin is not resolved here (§A.5).
2. **Stripe "already paid" error detection in `releaseAdminBookingHold` is an unverified heuristic.** The `/complete|paid|succeeded/i` message-matching in §B.4 is my best guess at Stripe Node SDK's error wording for "cannot expire a Session with a successful payment" — this codebase has no existing precedent for typed Stripe-error inspection to check it against. Needs empirical verification against the live SDK (or Stripe's docs for the specific error `type`/`code` on `checkout.sessions.expire`) before shipping; get this wrong and the Sentry escalation either never fires (silent race) or fires on unrelated transient errors (noise).
3. **`DemoteHoldButton`'s `confirm()` guard** is my own addition, not explicitly requested (§C.2) — confirm whether to keep it or drop it for pattern-consistency with the confirm-less `PromoteButton`/`NoShowButton`.
4. **Whether the future (still unbuilt) `revert_expired_admin_holds` cron should eventually call `admin_revert_hold_to_waitlist` per-row instead of keeping its own bulk `UPDATE`.** Explicit judgment call made in §B.6 (keep them as siblings, don't refactor the cron design now) — flagged for whoever actually builds that migration to reconsider with fresh eyes, since it's a real (if low-stakes) fork in the road I'm deciding without that PR in front of me.
5. **Pre-existing `revalidatePath` gap in `promoteFromWaitlist`** (and by extension `cancelEvent`/`cancelEventAndRefundBookings`) — none of them revalidate the nested `/admin/events/${id}/bookings` page they actually affect, only sibling/list paths. Both new Server Actions in this addendum correctly include it (§A.6, §B.5), but the pre-existing gap in already-shipped code is flagged, not fixed, here — out of scope for these two gaps specifically.
6. **`cancelBooking` (member self-cancel) re-confirmed out of scope for both gaps.** It hard-rejects anything not `status='confirmed'`... which means once Gap A's remediation flips a booking to `pending_payment`, a member can no longer self-cancel it via that path (same as any other `pending_payment` row today — they'd need to abandon checkout instead, which already correctly handles `is_admin_hold` clearing per the base spec's fix #2). No change needed, but noting the interaction explicitly since it wasn't obvious without tracing it.
