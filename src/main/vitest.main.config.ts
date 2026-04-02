import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/main/**/*.test.ts'],
    globalSetup: ['./src/main/vitest-global-setup.ts']
  }
})
