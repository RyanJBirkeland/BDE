import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the settings module (config.ts now delegates to settings.ts)
vi.mock('../settings', () => ({
  getSetting: vi.fn().mockReturnValue(null),
}))

import { getSetting } from '../settings'
import {
  getGitHubToken,
} from '../config'

describe('config.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getSetting).mockReturnValue(null)
    delete process.env['GITHUB_TOKEN']
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
