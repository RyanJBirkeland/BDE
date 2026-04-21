import os from 'node:os'
import { defineConfig } from 'vitest/config'

// Cap the thread pool so concurrent pipeline agents don't saturate the CPU.
// Default is cpuCount which causes 32+ threads on an 8-core machine with 4 agents.
// Math.ceil(cores / 3) gives 3 threads on an 8-core — enough headroom for parallel pushes.
const maxThreads = Math.max(1, Math.ceil(os.cpus().length / 3))

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify('0.0.0-test')
  },
  esbuild: {
    jsx: 'automatic'
  },
  test: {
    env: {
      BDE_TEST_DB: ':memory:'
    },
    environment: 'jsdom',
    globals: true,
    maxWorkers: maxThreads,
    minWorkers: 1,
    setupFiles: ['./src/renderer/src/test-setup.ts'],
    exclude: [
      'src/main/**/*.test.ts',
      'node_modules',
      '**/.worktrees/**',
      '.claude/worktrees/**',
      '**/out/**',
      '**/dist/**',
      '**/release/**',
      'e2e/**',
      'src/renderer/src/views/__tests__/SettingsView.test.tsx'
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'json-summary'],
      include: ['src/renderer/src/**/*.{ts,tsx}'],
      exclude: ['**/__tests__/**', '**/*.d.ts', '**/test-setup.ts', '**/design-system/**'],
      thresholds: {
        statements: 72,
        branches: 65,
        functions: 73.5,
        lines: 73
      }
    }
  }
})
