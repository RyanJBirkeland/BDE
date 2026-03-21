import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the settings module (config.ts now delegates to settings.ts)
vi.mock('../settings', () => ({
  getSetting: vi.fn().mockReturnValue(null),
}))

import { getSetting } from '../settings'
import {
  getSupabaseConfig,
  getGitHubToken,
} from '../config'

describe('config.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getSetting).mockReturnValue(null)
    delete process.env['VITE_SUPABASE_URL']
    delete process.env['VITE_SUPABASE_ANON_KEY']
    delete process.env['GITHUB_TOKEN']
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
})
