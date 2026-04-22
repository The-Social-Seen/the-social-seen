# Booking RPCs — manual + future-E2E test plan

The three booking RPCs (`book_event`, `book_event_paid`,
`claim_waitlist_spot`) enforce security-critical invariants:

- email_verified gate (P2-3)
- active-status gate (P2-8a)
- capacity race-safety via SELECT ... FOR UPDATE (P1)
- waitlist position re-compute on cancellation

Vitest can't exercise the RPC directly — it's plpgsql running inside
Postgres. Until Playwright is stood up (FOLLOW-UPS #T-1), these
scenarios are the manual smoke-test checklist before any production
deploy that touches the booking path.

Status: **manual** until Playwright ships.

---

## Scenario matrix

Run on staging with seed data. All three RPCs in each row unless noted.

| # | State setup | Call | Expected |
|---|---|---|---|
| 1 | unverified user (email_verified=false), event has capacity | `book_event` | error: "Verify your email before booking" |
| 2 | suspended user (status='suspended'), verified | `book_event` | error: "Account is not active" |
| 3 | banned user (status='banned'), verified | `book_event` | error: "Account is not active" (middleware also signs them out on next request) |
| 4 | verified active user, free event with capacity | `book_event` | `{ booking_id, status: 'confirmed' }` |
| 5 | same as 4, event at capacity | `book_event` | `{ booking_id, status: 'waitlisted', waitlist_position: N+1 }` |
| 6 | verified active user, paid event | `book_event` | error: "Use book_event_paid for paid events" |
| 7 | verified active user, paid event with capacity | `book_event_paid` | `{ booking_id, status: 'pending_payment' }` |
| 8 | cancelled event (is_cancelled=true) | `book_event` | error: "Event is cancelled" |
| 9 | soft-deleted event (deleted_at set) | `book_event` | error: "Event not found" |
| 10 | two concurrent calls for last seat | `book_event` × 2 in parallel | one returns confirmed, one returns waitlisted. No double-book. |
| 11 | confirmed user cancels via cancelBooking; another user claims | `claim_waitlist_spot` | pending_payment (paid) or confirmed (free). Position-1 waitlister transitions cleanly. |
| 12 | claim_waitlist_spot but event capacity > attendees (no free spot yet) | `claim_waitlist_spot` | error: "Someone else just claimed this spot. You're still on the waitlist." |

---

## How to run

Two ways, equally manual:

### Quick (Postgres psql)

```bash
# From .env.local
set -a && source .env.local && set +a

supabase db remote connect  # opens psql against staging
```

```sql
-- Scenario 1: unverified
SELECT book_event(
  p_event_id  := '<seed-event-uuid>',
  p_user_id   := '<unverified-user-uuid>',
  p_user_email_verified := false,
  p_user_status := 'active'
);
-- Expect an exception.
```

(The RPCs run as SECURITY DEFINER and read the caller's profile fields
via auth.uid() when invoked through the REST API; running via psql
passes them explicitly. Matches the production security boundary
because in either mode the DB is enforcing, not the app.)

### Full (PostgREST via curl)

```bash
curl -s -X POST "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/rpc/book_event" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer <member-jwt>" \
  -H "Content-Type: application/json" \
  -d '{"p_event_id": "..."}'
```

Obtain `<member-jwt>` by signing in via the UI and copying from
devtools → Application → Cookies → `sb-<ref>-auth-token`.

---

## CI gap — Playwright scaffold (post-Phase 2.5)

The right answer is:

1. `supabase start` in CI to get a local DB + Auth.
2. Apply all migrations.
3. Seed test users (one per status × verification combo).
4. Use Playwright to drive the full stack — sign-in via the actual
   login form, then verify the booking flow end-to-end including
   webhook simulation for paid bookings.

Estimate: ~1-1.5 days for the scaffold + these 12 scenarios as
automated tests.

Logged in `docs/FOLLOW-UPS.md` under Testing gaps.

---

## Pre-launch gate

Before the first real member signs up in production, **run this
checklist against production staging** (separate Supabase project)
as a go/no-go. A pass on staging doesn't guarantee production parity
if the two projects diverge (different auth config, different seed
data) — reference `docs/SUPABASE-CONFIG.md` §"Restoring to a fresh
Supabase project" to verify the production project has identical
config to staging.
