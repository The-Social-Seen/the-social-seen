import { defineConfig } from '@playwright/test'

/**
 * Playwright config for The Social Seen E2E suite.
 *
 * Two Playwright projects:
 *   - `rpc` — RPC-focused: scenarios call Postgres RPCs directly via
 *     PostgREST. No browser, no dev server. Specs live at e2e/*.spec.ts.
 *   - `ui` — Browser-driven: chromium hits a local Next.js dev server
 *     to exercise registration, login, and OTP verification end-to-end.
 *     Specs live at e2e/ui/*.spec.ts. Tests assume the local Supabase
 *     stack includes Inbucket (mail catcher) so the OTP can be read.
 *
 * Tests target a **local** Supabase stack (default
 * `http://127.0.0.1:54321`) seeded with the repo's migrations. Never
 * point at production or staging — `e2e/helpers/supabase.ts` refuses
 * to run if `SUPABASE_URL` resolves to a hosted project.
 *
 * Preconditions (local):
 *   supabase start               # boots DB + Auth + Inbucket
 *   pnpm e2e                     # rpc + ui projects together
 *   pnpm e2e --project=rpc       # rpc only (no dev server)
 *   pnpm e2e --project=ui        # ui only (auto-starts dev server)
 *
 * Preconditions (CI):
 *   the GitHub Actions job `e2e` starts supabase + applies migrations
 *   before invoking the runner (see .github/workflows/ci.yml).
 */

const PORT = 6500
const BASE_URL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`

// In CI we run against a production build — dev-mode cold-start
// hydration + framer-motion's initial opacity:0 makes the forms
// intermittently "not visible" to Playwright even after 30s. Prod
// build hydrates in ~100ms and matches what real users hit.
// Locally we still prefer `pnpm dev` for fast iteration (reuses an
// already-listening server).
const webServerCommand = process.env.CI
  ? `pnpm start --port ${PORT}`
  : `pnpm dev --port ${PORT}`

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },

  // Serial by default — both suites mutate shared rows (events,
  // bookings, profiles) and races would cause false failures.
  fullyParallel: false,
  workers: 1,
  retries: 0,

  reporter: process.env.CI ? [['github'], ['list']] : 'list',

  use: {
    extraHTTPHeaders: {
      'Content-Type': 'application/json',
    },
  },

  // The server boots only when the `ui` project actually runs.
  // Playwright reuses an already-listening server on the same port.
  // CI uses `pnpm start` (prod); local uses `pnpm dev` (HMR).
  webServer: {
    command: webServerCommand,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    // 180s to allow for `pnpm build` on a cold CI runner; dev-mode
    // local starts take <5s.
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },

  projects: [
    {
      name: 'rpc',
      testDir: './e2e',
      // Top-level specs only; UI specs live in e2e/ui/.
      testMatch: /e2e\/[^/]+\.spec\.ts$/,
    },
    {
      name: 'ui',
      testDir: './e2e/ui',
      use: {
        baseURL: BASE_URL,
        viewport: { width: 1280, height: 800 },
      },
    },
  ],
})
