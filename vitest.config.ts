import { defineConfig } from 'vitest/config'

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify('0.0.0-test')
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/renderer/src/test-setup.ts'],
    exclude: [
      'src/main/**/*.test.ts',
      'node_modules',
      '**/.worktrees/**',
      '.claude/worktrees/**',
      '**/out/**',
      '**/dist/**',
      '**/release/**',
      'e2e/**'
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'json-summary'],
      include: ['src/renderer/src/**/*.{ts,tsx}'],
      exclude: ['**/__tests__/**', '**/*.d.ts', '**/test-setup.ts', '**/design-system/**'],
      thresholds: {
        statements: 72,
        branches: 66,
        functions: 70,
        lines: 74
      }
    }
  }
})
