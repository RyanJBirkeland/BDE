import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
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
