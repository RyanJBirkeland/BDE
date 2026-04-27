import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: vi.fn() } }))
vi.mock('../../ipc-utils', () => ({ safeHandle: vi.fn() }))
vi.mock('../../settings', () => ({
  getSetting: vi.fn(),
  setSetting: vi.fn(),
  getSettingJson: vi.fn(),
  setSettingJson: vi.fn(),
  deleteSetting: vi.fn()
}))
vi.mock('../../services/settings-profiles', () => ({
  saveProfile: vi.fn(),
  loadProfile: vi.fn(),
  applyProfile: vi.fn(),
  listProfiles: vi.fn(),
  deleteProfile: vi.fn()
}))
vi.mock('../../secure-storage', () => ({
  SENSITIVE_SETTING_KEYS: new Set(['github.token', 'supabase.serviceKey', 'claude.apiKey'])
}))
vi.mock('../../paths', () => ({ validateWorktreeBase: vi.fn() }))
vi.mock('../../events/settings-events', () => ({ emitSettingChanged: vi.fn() }))
vi.mock('../../mcp-server/token-store', () => ({
  readOrCreateToken: vi.fn(),
  regenerateToken: vi.fn()
}))

import { parseSetJsonArgs } from '../config-handlers'

describe('parseSetJsonArgs', () => {
  it('accepts an allowed key with a normal value', () => {
    const result = parseSetJsonArgs(['task.templates', [{ name: 'x', prompt: 'y' }]])
    expect(result[0]).toBe('task.templates')
    expect(result[1]).toEqual([{ name: 'x', prompt: 'y' }])
  })

  it('blocks writes to sensitive keys', () => {
    expect(() => parseSetJsonArgs(['github.token', 'secret'])).toThrow('sensitive')
    expect(() => parseSetJsonArgs(['supabase.serviceKey', 'secret'])).toThrow('sensitive')
    expect(() => parseSetJsonArgs(['claude.apiKey', 'secret'])).toThrow('sensitive')
  })

  it('throws when key is not a string', () => {
    expect(() => parseSetJsonArgs([42, 'value'])).toThrow('non-empty string')
    expect(() => parseSetJsonArgs([null, 'value'])).toThrow('non-empty string')
  })

  it('throws when key is empty string', () => {
    expect(() => parseSetJsonArgs(['', 'value'])).toThrow('non-empty string')
    expect(() => parseSetJsonArgs(['   ', 'value'])).toThrow('non-empty string')
  })

  it('rejects values whose JSON serialisation exceeds 1 MB', () => {
    // A plain string of 1_048_577 chars serialises to > 1MB (with enclosing quotes)
    const bigString = 'a'.repeat(1_048_577)
    expect(() => parseSetJsonArgs(['some.key', bigString])).toThrow('too large')
  })

  it('accepts values just under the 1 MB limit', () => {
    // A string with < 1MB characters serialises to < 1MB JSON
    const value = 'a'.repeat(500_000)
    expect(() => parseSetJsonArgs(['some.key', value])).not.toThrow()
  })

  it('preserves the value as-is on success', () => {
    const obj = { nested: { deep: true }, arr: [1, 2, 3] }
    const [, returned] = parseSetJsonArgs(['feature.config', obj])
    expect(returned).toBe(obj)
  })
})
