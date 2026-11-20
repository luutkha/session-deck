import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [{ find: /^@\//, replacement: `${resolve('src/renderer')}/` }]
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    // Git-heavy suites (worktrees, pushes to a local bare remote) need 1-2 s each alone and several times that when
    // many files run in parallel on Windows; the 5 s default made them fail only in the full run (see docs/LESSONS.md).
    testTimeout: 30000,
    hookTimeout: 30000
  }
})
