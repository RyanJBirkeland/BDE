import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('node:fs', async () => {
  const actual = await vi.importActual('node:fs')
  return { ...actual, readFileSync: vi.fn(), existsSync: vi.fn(), writeFileSync: vi.fn() }
})

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual('node:child_process')
  return { ...actual, execFile: vi.fn() }
})

import { getOAuthToken, invalidateOAuthToken, refreshOAuthTokenFromKeychain } from '../env-utils'
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { execFile } from 'node:child_process'

describe('OAuth token cache', () => {
  beforeEach(() => {
    invalidateOAuthToken()
    vi.mocked(existsSync).mockReturnValue(true)
  })

  it('invalidateOAuthToken forces next call to re-read from disk', () => {
    vi.mocked(readFileSync).mockReturnValue('token-v1')
    const t1 = getOAuthToken()
    expect(t1).toBe('token-v1')

    vi.mocked(readFileSync).mockReturnValue('token-v2')
    expect(getOAuthToken()).toBe('token-v1') // still cached

    invalidateOAuthToken()
    expect(getOAuthToken()).toBe('token-v2') // re-read
  })
})

describe('refreshOAuthTokenFromKeychain', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    invalidateOAuthToken()
  })

  it('writes token file with mode 0o600', async () => {
    const fakeToken = 'fake-oauth-token-abc123'
    const credJson = JSON.stringify({ claudeAiOauth: { accessToken: fakeToken } })

    // execFile is callback-based; promisify wraps it — mock the callback form
    vi.mocked(execFile).mockImplementation((_cmd, _args, _opts, callback: any) => {
      callback(null, { stdout: credJson, stderr: '' })
      return {} as any
    })

    const result = await refreshOAuthTokenFromKeychain()

    expect(result).toBe(true)
    expect(vi.mocked(writeFileSync)).toHaveBeenCalledWith(
      expect.stringContaining('oauth-token'),
      fakeToken,
      { encoding: 'utf8', mode: 0o600 }
    )
  })

  it('returns false when security CLI fails', async () => {
    vi.mocked(execFile).mockImplementation((_cmd, _args, _opts, callback: any) => {
      callback(new Error('security: tool not found'), { stdout: '', stderr: '' })
      return {} as any
    })

    const result = await refreshOAuthTokenFromKeychain()
    expect(result).toBe(false)
    expect(vi.mocked(writeFileSync)).not.toHaveBeenCalled()
  })

  it('returns false when JSON has no accessToken', async () => {
    vi.mocked(execFile).mockImplementation((_cmd, _args, _opts, callback: any) => {
      callback(null, { stdout: JSON.stringify({ claudeAiOauth: {} }), stderr: '' })
      return {} as any
    })

    const result = await refreshOAuthTokenFromKeychain()
    expect(result).toBe(false)
    expect(vi.mocked(writeFileSync)).not.toHaveBeenCalled()
  })
})
