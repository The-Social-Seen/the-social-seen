import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Supabase Edge Functions run on Deno — remote imports + different
    // globals. Don't lint them with the Node/Next config.
    "supabase/functions/**",
    // Agent worktrees, plugin caches, and skill scaffolding live under
    // .claude/. They contain stale TypeScript copies from prior branches
    // and tooling assets that aren't part of the app source.
    ".claude/**",
  ]),
]);

export default eslintConfig;
