# Contributing — invariants to preserve

Short, targeted notes on non-obvious invariants in this codebase that
refactors or "quick fixes" have a history of breaking. If you're about
to modify a file that touches one of these areas, read the relevant
section first.

For broader project rules (design tokens, migrations, RLS, agent
workflow) see [`CLAUDE.md`](../CLAUDE.md).

---

## `notifications.sent_by = recipient_user_id` for system-originated rows

**File(s):** `supabase/functions/daily-notifications/index.ts` (`sendWithLog`),
`src/lib/email/send.ts` (`logSendAttempt`).

**The invariant.** For notifications that originate from a cron job or
system-level trigger (venue reveals, event reminders, review requests,
profile nudges, welcome emails), we set **both** columns to the
recipient's profile id:

```ts
sent_by:          args.relatedProfileId  // = recipient's profile id
recipient_user_id: args.relatedProfileId  // = recipient's profile id
```

**Why this looks wrong and isn't.** Intuitively `sent_by` should be "the
user who sent this" — e.g. an admin, or a `system` uuid for cron. It
isn't, for two reasons:

1. **Legacy path.** Before the `recipient_user_id` FK existed, the
   GDPR scrub RPC (`sanitise_user_notifications`, migration
   `20260428000002`) used `sent_by = p_user_id` to find rows owned by
   a deleting user. Older audit rows still rely on that path. Changing
   `sent_by` to anything else orphans those rows — they won't be
   scrubbed when the user is deleted.
2. **Defence in depth.** Populating **both** columns means the scrub
   RPC catches the row regardless of which path it walks. If a future
   maintainer ever moves `sent_by` to a system uuid, `recipient_user_id`
   still lets the scrub find the row — provided you keep
   `recipient_user_id` populated.

**If you're tempted to "fix" this.** Don't change `sent_by` to a system
uuid (or `NULL`, or an admin id) without first confirming:

- The GDPR scrub RPC still covers every code path that writes audit
  rows. Query `sanitise_user_notifications` and trace every branch.
- You've also kept `recipient_user_id` populated. Dropping it at the
  same time as changing `sent_by` loses scrub coverage entirely.
- Admin-initiated sends (e.g. `emailEventAttendees`) already use
  `sent_by = admin_id, recipient_user_id = attendee_id` — that's a
  different pattern, deliberately. Don't unify them without revisiting
  the scrub logic.

If you need a better audit trail for "who triggered the send" (e.g. to
distinguish cron-sent reminders from admin announcements), add a
separate `source` or `triggered_by` column rather than overloading
`sent_by`.

---

## `NEXT_PUBLIC_*` env vars MUST be read as literal string accesses

**File(s):** `src/lib/supabase/client.ts`, any Client Component that
reads a `NEXT_PUBLIC_*` var.

Next.js **statically replaces** `process.env.NEXT_PUBLIC_FOO` at build
time. Dynamic reads (`process.env[name]`, `const key = 'NEXT_PUBLIC_FOO'; process.env[key]`)
return `undefined` in the browser bundle because the replacement never
fires. The fix is always: write the literal string.

If you're tempted to DRY this up into a `getEnv(name)` helper: don't.
See PR #42 (commit `295f2d0`) for the bug this caused.

---

## New columns on `public.profiles` require an explicit anon decision

Per `CLAUDE.md` — the secure-by-default posture (migration
`20260420000003`) is that anon only reads columns on the allow-list.
Any new column is invisible to anon unless the migration explicitly
adds it to the GRANT. Omit from the anon GRANT unless the column is
genuinely needed for public event rendering and safe to expose
publicly. Document the decision in the migration header.

---

## Image hosts — update BOTH `next.config.ts` AND `ALLOWED_IMAGE_HOSTS`

When adding a new external image source (e.g. Instagram CDN for the
Phase 3 oEmbed work), you must update:

1. `next.config.ts` `remotePatterns` — so `next/image` will load it.
2. `ALLOWED_IMAGE_HOSTS` in `src/lib/utils/images.ts` — so our
   security-layer host-allowlist passes it through.

A drift test (`src/lib/utils/__tests__/images-drift.test.ts`) enforces
the pair stays in sync. If you updated one and the drift test fires,
update the other — don't disable the test.
