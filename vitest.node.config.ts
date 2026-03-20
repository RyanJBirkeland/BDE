import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/main/**/*.test.ts'],
    globals: true,
    exclude: ['node_modules', '**/.worktrees/**', '.claude/worktrees/**', '**/out/**'],
  },
})
