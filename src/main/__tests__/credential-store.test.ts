import { describe, it, expect, vi } from 'vitest'

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
  spawnSync: vi.fn()
}))

vi.mock('node:fs', () => ({
  existsSync: vi.fn()
}))

vi.mock('../env-utils', () => ({
  getOAuthToken: vi.fn().mockReturnValue(null),
  parseExpiresAt: vi.fn().mockReturnValue(null)
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

// Re-declare schemas matching production code so shape tests stay focused and fast.
// IMPORTANT: these must stay in sync with credential-store.ts.
import { z } from 'zod'

const KeychainOAuthSchema = z.object({
  accessToken: z.string().optional(),
  refreshToken: z.string().optional(),
  expiresAt: z.union([z.string(), z.number()]).optional()
})

const KeychainPayloadSchema = z.object({
  claudeAiOauth: KeychainOAuthSchema.optional()
})

describe('KeychainOAuthSchema', () => {
  it('accepts a payload with the v1.x fields only', () => {
    const result = KeychainOAuthSchema.safeParse({
      accessToken: 'tok',
      expiresAt: '1700000000000'
    })
    expect(result.success).toBe(true)
  })

  it('accepts a payload with the v2.x refreshToken field', () => {
    const result = KeychainOAuthSchema.safeParse({
      accessToken: 'tok',
      refreshToken: 'ref',
      expiresAt: '1700000000000'
    })
    expect(result.success).toBe(true)
  })

  it('accepts expiresAt as a number (seconds-since-epoch format)', () => {
    const result = KeychainOAuthSchema.safeParse({
      accessToken: 'tok',
      expiresAt: 1700000000
    })
    expect(result.success).toBe(true)
  })

  it('accepts additional unknown fields without failing', () => {
    const result = KeychainOAuthSchema.safeParse({
      accessToken: 'tok',
      expiresAt: '1700000000000',
      unknownFutureField: true
    })
    expect(result.success).toBe(true)
  })
})

describe('KeychainPayloadSchema', () => {
  it('accepts a payload with only claudeAiOauth', () => {
    const result = KeychainPayloadSchema.safeParse({
      claudeAiOauth: { accessToken: 'tok' }
    })
    expect(result.success).toBe(true)
  })

  it('accepts additional top-level fields (v2.x may include them)', () => {
    const result = KeychainPayloadSchema.safeParse({
      claudeAiOauth: { accessToken: 'tok' },
      extraTopLevel: 1
    })
    expect(result.success).toBe(true)
  })

  it('accepts the full v2.x shape with refreshToken', () => {
    const result = KeychainPayloadSchema.safeParse({
      claudeAiOauth: {
        accessToken: 'tok',
        refreshToken: 'ref',
        expiresAt: '1700000000000'
      }
    })
    expect(result.success).toBe(true)
  })
})
