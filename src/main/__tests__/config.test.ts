import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the settings module (config.ts now delegates to settings.ts)
vi.mock('../settings', () => ({
  getSetting: vi.fn().mockReturnValue(null),
}))

import { getSetting } from '../settings'
import {
  getSupabaseConfig,
  getGitHubToken,
  getGatewayConfig,
  getTaskRunnerConfig,
} from '../config'

describe('config.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getSetting).mockReturnValue(null)
    delete process.env['VITE_SUPABASE_URL']
    delete process.env['VITE_SUPABASE_ANON_KEY']
    delete process.env['GITHUB_TOKEN']
    delete process.env['SPRINT_API_KEY']
    delete process.env['TASK_RUNNER_URL']
  })

  describe('getSupabaseConfig', () => {
    it('returns null when no settings or env vars exist', () => {
      expect(getSupabaseConfig()).toBeNull()
    })

    it('returns config from settings', () => {
      vi.mocked(getSetting).mockImplementation((key: string) => {
        if (key === 'supabase.url') return 'https://sb.io'
        if (key === 'supabase.anonKey') return 'key123'
        return null
      })

      expect(getSupabaseConfig()).toEqual({ url: 'https://sb.io', anonKey: 'key123' })
    })

    it('falls back to env vars when settings are missing', () => {
      process.env['VITE_SUPABASE_URL'] = 'https://env.sb.io'
      process.env['VITE_SUPABASE_ANON_KEY'] = 'envkey'

      expect(getSupabaseConfig()).toEqual({ url: 'https://env.sb.io', anonKey: 'envkey' })
    })
  })

  describe('getGitHubToken', () => {
    it('returns null when no setting or env var', () => {
      expect(getGitHubToken()).toBeNull()
    })

    it('returns token from settings', () => {
      vi.mocked(getSetting).mockImplementation((key: string) =>
        key === 'github.token' ? 'gh_settings_token' : null
      )

      expect(getGitHubToken()).toBe('gh_settings_token')
    })

    it('falls back to GITHUB_TOKEN env var', () => {
      process.env['GITHUB_TOKEN'] = 'gh_env_token'

      expect(getGitHubToken()).toBe('gh_env_token')
    })
  })

  describe('getGatewayConfig', () => {
    it('returns null when url or token is missing', () => {
      expect(getGatewayConfig()).toBeNull()
    })

    it('returns config when both url and token are set', () => {
      vi.mocked(getSetting).mockImplementation((key: string) => {
        if (key === 'gateway.url') return 'ws://gw'
        if (key === 'gateway.token') return 'tok123'
        return null
      })

      expect(getGatewayConfig()).toEqual({ url: 'ws://gw', token: 'tok123' })
    })

    it('returns null when token is missing', () => {
      vi.mocked(getSetting).mockImplementation((key: string) => {
        if (key === 'gateway.url') return 'ws://gw'
        return null
      })

      expect(getGatewayConfig()).toBeNull()
    })
  })

  describe('getTaskRunnerConfig', () => {
    it('returns null when apiKey is missing', () => {
      expect(getTaskRunnerConfig()).toBeNull()
    })

    it('returns config from settings', () => {
      vi.mocked(getSetting).mockImplementation((key: string) => {
        if (key === 'taskRunner.apiKey') return 'api_key'
        if (key === 'taskRunner.url') return 'http://runner:9999'
        return null
      })

      expect(getTaskRunnerConfig()).toEqual({ url: 'http://runner:9999', apiKey: 'api_key' })
    })

    it('uses default URL when only apiKey is set', () => {
      vi.mocked(getSetting).mockImplementation((key: string) => {
        if (key === 'taskRunner.apiKey') return 'api_key'
        return null
      })

      expect(getTaskRunnerConfig()).toEqual({ url: 'http://127.0.0.1:18799', apiKey: 'api_key' })
    })

    it('falls back to env vars', () => {
      process.env['SPRINT_API_KEY'] = 'env_api_key'
      process.env['TASK_RUNNER_URL'] = 'http://env-runner'

      expect(getTaskRunnerConfig()).toEqual({ url: 'http://env-runner', apiKey: 'env_api_key' })
    })
  })
})
