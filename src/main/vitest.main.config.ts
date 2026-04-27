import os from 'node:os'
import { defineConfig } from 'vitest/config'

// Cap workers to prevent CPU saturation when multiple agents push simultaneously.
const maxWorkers = Math.max(1, Math.ceil(os.cpus().length / 3))

export default defineConfig({
  test: {
    env: {
      FLEET_TEST_DB: ':memory:'
    },
    environment: 'node',
    globals: true,
    maxWorkers,
    include: ['src/main/**/*.test.ts'],
    globalSetup: ['./src/main/vitest-global-setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/main/**/*.ts'],
      exclude: ['src/main/**/*.test.ts', 'src/main/__tests__/**', 'src/main/vitest.main.config.ts'],
      thresholds: {
        statements: 71,
        branches: 62,
        functions: 72,
        lines: 72
      }
    }
  }
})
