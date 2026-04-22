import { defineConfig } from '@playwright/test'

/**
 * Playwright config for The Social Seen E2E suite.
 *
 * The current test suite is **RPC-focused** — scenarios exercise
 * booking behaviour by calling Postgres RPCs directly via PostgREST
 * rather than driving a browser. Playwright is used as the test
 * runner for consistent CI integration + a future path to UI E2E.
 *
 * Tests target a **local** Supabase stack (default
 * `http://127.0.0.1:54321`) seeded with the repo's migrations. Never
 * point at production or staging — `e2e/helpers/supabase.ts` refuses
 * to run if `SUPABASE_URL` resolves to a hosted project.
 *
 * Preconditions (local):
 *   supabase start               # once per session
 *   pnpm e2e                     # run the suite
 *
 * Preconditions (CI):
 *   the GitHub Actions job `e2e` starts supabase + applies migrations
 *   before invoking the runner (see .github/workflows/ci.yml).
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },

  // Serial by default — the RPC suite mutates shared `events` /
  // `bookings` rows and races would cause false failures. When we add
  // browser-level UI tests later they should go in their own project
  // with `fullyParallel: true`.
  fullyParallel: false,
  workers: 1,
  retries: 0,

  reporter: process.env.CI ? [['github'], ['list']] : 'list',

  use: {
    // No baseURL — the RPC suite uses the Supabase REST endpoint
    // resolved from env. When UI tests land they'll set baseURL to
    // the dev-server URL and reuse `request` for fixtures.
    extraHTTPHeaders: {
      'Content-Type': 'application/json',
    },
  },

  projects: [
    {
      name: 'rpc',
      testMatch: /.*\.spec\.ts$/,
    },
  ],
})
