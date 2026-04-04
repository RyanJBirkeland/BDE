import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  saveProfile,
  loadProfile,
  listProfiles,
  deleteProfile,
  applyProfile
} from '../settings-profiles'
import * as settings from '../../settings'

// Mock settings module
vi.mock('../../settings', () => ({
  getSetting: vi.fn(),
  setSetting: vi.fn(),
  deleteSetting: vi.fn(),
  getSettingJson: vi.fn(),
  setSettingJson: vi.fn()
}))

describe('settings-profiles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('saveProfile', () => {
    it('saves a named profile as JSON in settings table', () => {
      const mockGetSetting = vi.mocked(settings.getSetting)
      const mockSetSettingJson = vi.mocked(settings.setSettingJson)
      const mockGetSettingJson = vi.mocked(settings.getSettingJson)

      // Mock existing settings
      mockGetSetting.mockImplementation((key: string) => {
        const values: Record<string, string> = {
          'agentManager.maxConcurrent': '3',
          'agentManager.worktreeBase': '~/worktrees',
          'agentManager.maxRuntime': '3600000',
          'agentManager.defaultModel': 'sonnet',
          'appearance.theme': 'dark',
          'appearance.reducedMotion': 'false'
        }
        return values[key] ?? null
      })

      // Mock empty manifest initially
      mockGetSettingJson.mockReturnValue([])

      saveProfile('dev-mode')

      // Should save profile snapshot
      expect(mockSetSettingJson).toHaveBeenCalledWith(
        'profiles.dev-mode',
        expect.objectContaining({
          'agentManager.maxConcurrent': '3',
          'agentManager.worktreeBase': '~/worktrees',
          'agentManager.maxRuntime': '3600000',
          'agentManager.defaultModel': 'sonnet',
          'appearance.theme': 'dark',
          'appearance.reducedMotion': 'false'
        })
      )

      // Should update manifest
      expect(mockSetSettingJson).toHaveBeenCalledWith(
        'profiles._manifest',
        ['dev-mode']
      )
    })

    it('does not duplicate profile names in manifest', () => {
      const mockGetSetting = vi.mocked(settings.getSetting)
      const mockSetSettingJson = vi.mocked(settings.setSettingJson)
      const mockGetSettingJson = vi.mocked(settings.getSettingJson)

      mockGetSetting.mockReturnValue('test-value')
      // Mock existing manifest with the profile already present
      mockGetSettingJson.mockReturnValue(['dev-mode', 'prod-mode'])

      saveProfile('dev-mode')

      // Should not add duplicate
      expect(mockSetSettingJson).toHaveBeenCalledWith(
        'profiles._manifest',
        ['dev-mode', 'prod-mode']
      )
    })
  })

  describe('loadProfile', () => {
    it('loads a profile and returns the settings map', () => {
      const mockGetSettingJson = vi.mocked(settings.getSettingJson)

      const mockSnapshot = {
        'agentManager.maxConcurrent': '5',
        'appearance.theme': 'light'
      }
      mockGetSettingJson.mockReturnValue(mockSnapshot)

      const result = loadProfile('test-profile')

      expect(mockGetSettingJson).toHaveBeenCalledWith('profiles.test-profile')
      expect(result).toEqual(mockSnapshot)
    })

    it('returns null if profile does not exist', () => {
      const mockGetSettingJson = vi.mocked(settings.getSettingJson)
      mockGetSettingJson.mockReturnValue(null)

      const result = loadProfile('nonexistent')

      expect(result).toBeNull()
    })
  })

  describe('applyProfile', () => {
    it('applies all settings from a profile', () => {
      const mockGetSettingJson = vi.mocked(settings.getSettingJson)
      const mockSetSetting = vi.mocked(settings.setSetting)

      const mockSnapshot = {
        'agentManager.maxConcurrent': '5',
        'appearance.theme': 'light'
      }
      mockGetSettingJson.mockReturnValue(mockSnapshot)

      const result = applyProfile('test-profile')

      expect(result).toBe(true)
      expect(mockSetSetting).toHaveBeenCalledWith('agentManager.maxConcurrent', '5')
      expect(mockSetSetting).toHaveBeenCalledWith('appearance.theme', 'light')
    })

    it('deletes settings with null values', () => {
      const mockGetSettingJson = vi.mocked(settings.getSettingJson)
      const mockSetSetting = vi.mocked(settings.setSetting)
      const mockDeleteSetting = vi.mocked(settings.deleteSetting)

      const mockSnapshot = {
        'agentManager.maxConcurrent': '5',
        'appearance.theme': null
      }
      mockGetSettingJson.mockReturnValue(mockSnapshot)

      applyProfile('test-profile')

      expect(mockSetSetting).toHaveBeenCalledWith('agentManager.maxConcurrent', '5')
      expect(mockDeleteSetting).toHaveBeenCalledWith('appearance.theme')
    })

    it('returns false if profile does not exist', () => {
      const mockGetSettingJson = vi.mocked(settings.getSettingJson)
      mockGetSettingJson.mockReturnValue(null)

      const result = applyProfile('nonexistent')

      expect(result).toBe(false)
    })
  })

  describe('listProfiles', () => {
    it('lists all profile names from manifest', () => {
      const mockGetSettingJson = vi.mocked(settings.getSettingJson)
      mockGetSettingJson.mockReturnValue(['dev-mode', 'prod-mode', 'test-mode'])

      const result = listProfiles()

      expect(mockGetSettingJson).toHaveBeenCalledWith('profiles._manifest')
      expect(result).toEqual(['dev-mode', 'prod-mode', 'test-mode'])
    })

    it('returns empty array if no profiles exist', () => {
      const mockGetSettingJson = vi.mocked(settings.getSettingJson)
      mockGetSettingJson.mockReturnValue(null)

      const result = listProfiles()

      expect(result).toEqual([])
    })
  })

  describe('deleteProfile', () => {
    it('deletes a profile and updates manifest', () => {
      const mockDeleteSetting = vi.mocked(settings.deleteSetting)
      const mockGetSettingJson = vi.mocked(settings.getSettingJson)
      const mockSetSettingJson = vi.mocked(settings.setSettingJson)

      mockGetSettingJson.mockReturnValue(['dev-mode', 'prod-mode', 'test-mode'])

      deleteProfile('prod-mode')

      expect(mockDeleteSetting).toHaveBeenCalledWith('profiles.prod-mode')
      expect(mockSetSettingJson).toHaveBeenCalledWith(
        'profiles._manifest',
        ['dev-mode', 'test-mode']
      )
    })

    it('handles deleting nonexistent profile gracefully', () => {
      const mockDeleteSetting = vi.mocked(settings.deleteSetting)
      const mockGetSettingJson = vi.mocked(settings.getSettingJson)
      const mockSetSettingJson = vi.mocked(settings.setSettingJson)

      mockGetSettingJson.mockReturnValue(['dev-mode'])

      deleteProfile('nonexistent')

      expect(mockDeleteSetting).toHaveBeenCalledWith('profiles.nonexistent')
      expect(mockSetSettingJson).toHaveBeenCalledWith(
        'profiles._manifest',
        ['dev-mode']
      )
    })
  })
})
