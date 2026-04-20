/**
 * Dev-only route to verify Sentry integration.
 * Disabled in production — returns 404.
 *
 * Usage: visit /api/sentry-test — throws a test error.
 * Sentry will only report it when NODE_ENV === "production" (per config),
 * so use `NODE_ENV=production pnpm build && pnpm start` locally to test.
 */

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  if (process.env.NODE_ENV === "production" && !process.env.SENTRY_ALLOW_TEST_ROUTE) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  throw new Error("Sentry test error — if you see this in Sentry, integration works.");
}
