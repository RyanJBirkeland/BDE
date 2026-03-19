import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync, writeFileSync } from 'fs'

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return {
    ...actual,
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
  }
})

import {
  getSupabaseConfig,
  getGitHubToken,
  getGatewayConfig,
  GatewayConfigError,
  saveGatewayConfig,
  clearConfigCache,
} from '../config'

describe('config.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearConfigCache()
    delete process.env['VITE_SUPABASE_URL']
    delete process.env['VITE_SUPABASE_ANON_KEY']
    delete process.env['GITHUB_TOKEN']
  })

  describe('getSupabaseConfig', () => {
    it('returns null when config file is missing', () => {
      vi.mocked(readFileSync).mockImplementation(() => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      })

      expect(getSupabaseConfig()).toBeNull()
    })

    it('returns null when JSON is corrupt', () => {
      vi.mocked(readFileSync).mockReturnValue('not json{{{')

      expect(getSupabaseConfig()).toBeNull()
    })

    it('returns config from file when both fields present', () => {
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({ supabaseUrl: 'https://sb.io', supabaseAnonKey: 'key123' })
      )

      const result = getSupabaseConfig()
      expect(result).toEqual({ url: 'https://sb.io', anonKey: 'key123' })
    })

    it('falls back to env vars when file fields are missing', () => {
      vi.mocked(readFileSync).mockReturnValue('{}')
      process.env['VITE_SUPABASE_URL'] = 'https://env.sb.io'
      process.env['VITE_SUPABASE_ANON_KEY'] = 'envkey'

      const result = getSupabaseConfig()
      expect(result).toEqual({ url: 'https://env.sb.io', anonKey: 'envkey' })
    })
  })

  describe('getGitHubToken', () => {
    it('returns null when config file is missing and no env var', () => {
      vi.mocked(readFileSync).mockImplementation(() => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      })

      expect(getGitHubToken()).toBeNull()
    })

    it('falls back to GITHUB_TOKEN env var when file is missing', () => {
      vi.mocked(readFileSync).mockImplementation(() => { throw new Error('fail') })
      process.env['GITHUB_TOKEN'] = 'gh_env_token'

      expect(getGitHubToken()).toBe('gh_env_token')
    })

    it('returns token from config file', () => {
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({ githubToken: 'gh_file_token' })
      )

      expect(getGitHubToken()).toBe('gh_file_token')
    })

    it('returns null when config exists but githubToken field is missing', () => {
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({ gatewayToken: 'gw_tok', gatewayUrl: 'ws://gw' })
      )

      expect(getGitHubToken()).toBeNull()
    })
  })

  describe('getGatewayConfig', () => {
    it('throws GatewayConfigError with missing-file reason when config file is missing (ENOENT)', () => {
      const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      vi.mocked(readFileSync).mockImplementation(() => { throw err })

      expect(() => getGatewayConfig()).toThrow(GatewayConfigError)
      try {
        getGatewayConfig()
      } catch (e) {
        expect(e).toBeInstanceOf(GatewayConfigError)
        expect((e as GatewayConfigError).reason).toBe('missing-file')
        expect((e as GatewayConfigError).message).toContain('openclaw.json')
      }
    })

    it('throws GatewayConfigError with missing-token reason when gatewayToken is missing', () => {
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ gatewayUrl: 'ws://localhost' }))

      expect(() => getGatewayConfig()).toThrow(GatewayConfigError)
      try {
        getGatewayConfig()
      } catch (e) {
        expect(e).toBeInstanceOf(GatewayConfigError)
        expect((e as GatewayConfigError).reason).toBe('missing-token')
        expect((e as GatewayConfigError).message).toContain('gatewayToken')
      }
    })

    it('throws with parse error when JSON is corrupt', () => {
      vi.mocked(readFileSync).mockReturnValue('{{not json}}')

      expect(() => getGatewayConfig()).toThrow()
    })

    it('returns url and token on success', () => {
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({ gatewayUrl: 'ws://gw', gatewayToken: 'tok123' })
      )

      expect(getGatewayConfig()).toEqual({ url: 'ws://gw', token: 'tok123' })
    })

    it('falls back to nested gateway.auth.token format', () => {
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({ gateway: { auth: { token: 'nested_tok' }, port: 9999 } })
      )

      const result = getGatewayConfig()
      expect(result.token).toBe('nested_tok')
      expect(result.url).toBe('ws://127.0.0.1:9999')
    })
  })

  describe('saveGatewayConfig', () => {
    it('merges into existing config', () => {
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ existing: true }))

      saveGatewayConfig('ws://new', 'new_token')

      expect(vi.mocked(writeFileSync)).toHaveBeenCalledWith(
        expect.stringContaining('openclaw.json'),
        expect.stringContaining('"gatewayToken": "new_token"'),
        'utf-8'
      )
      // Verify existing keys are preserved
      const written = JSON.parse(vi.mocked(writeFileSync).mock.calls[0][1] as string)
      expect(written.existing).toBe(true)
      expect(written.gatewayUrl).toBe('ws://new')
    })

    it('creates fresh config when file is missing', () => {
      vi.mocked(readFileSync).mockImplementation(() => { throw new Error('ENOENT') })

      saveGatewayConfig('ws://fresh', 'fresh_token')

      const written = JSON.parse(vi.mocked(writeFileSync).mock.calls[0][1] as string)
      expect(written.gatewayUrl).toBe('ws://fresh')
      expect(written.gatewayToken).toBe('fresh_token')
    })
  })
})
