import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    // Playwright E2E specs live under `e2e/` and target a real
    // Supabase stack. Run them via `pnpm e2e`, not here.
    exclude: ['node_modules/**', 'e2e/**', '.next/**', 'dist/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
