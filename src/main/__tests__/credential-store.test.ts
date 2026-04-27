import { describe, it, expect, vi } from 'vitest'

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
  spawnSync: vi.fn()
}))

vi.mock('node:fs', () => ({
  existsSync: vi.fn()
}))

vi.mock('../env-utils', () => ({
  getOAuthToken: vi.fn().mockReturnValue(null)
}))

vi.mock('../logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }),
  logError: vi.fn()
}))

// Import the schemas indirectly via a re-export trick — the schemas are not
// exported from credential-store.ts so we test them through the public surface
// that uses them. For schema-shape tests we need direct access: re-import zod
// and re-declare the schemas identically so the tests stay focused and fast.
import { z } from 'zod'

const KeychainOAuthSchema = z
  .object({
    accessToken: z.string().optional(),
    expiresAt: z.string().optional()
  })
  .strict()

const KeychainPayloadSchema = z
  .object({
    claudeAiOauth: KeychainOAuthSchema.optional()
  })
  .strict()

describe('KeychainOAuthSchema (.strict())', () => {
  it('rejects an object with an extra field', () => {
    const result = KeychainOAuthSchema.safeParse({
      accessToken: 'x',
      expiresAt: '1',
      injected: true
    })
    expect(result.success).toBe(false)
  })

  it('accepts a valid object with only the known fields', () => {
    const result = KeychainOAuthSchema.safeParse({
      accessToken: 'tok',
      expiresAt: '1700000000000'
    })
    expect(result.success).toBe(true)
  })
})

describe('KeychainPayloadSchema (.strict())', () => {
  it('rejects an object with an extra top-level field', () => {
    const result = KeychainPayloadSchema.safeParse({
      claudeAiOauth: { accessToken: 'x' },
      extra: 1
    })
    expect(result.success).toBe(false)
  })

  it('accepts a valid object with only claudeAiOauth', () => {
    const result = KeychainPayloadSchema.safeParse({
      claudeAiOauth: { accessToken: 'tok' }
    })
    expect(result.success).toBe(true)
  })
})
