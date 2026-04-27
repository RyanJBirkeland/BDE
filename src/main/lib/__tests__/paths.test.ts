import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getRepoConfig } from '../../paths'

vi.mock('../../settings', () => ({
  getSettingJson: vi.fn()
}))

// Import after mock so the mock is in place when paths.ts initialises
import { getSettingJson } from '../../settings'

describe('getRepoConfig', () => {
  beforeEach(() => {
    vi.mocked(getSettingJson).mockReturnValue(null)
  })

  it('returns null when no repos are configured', () => {
    vi.mocked(getSettingJson).mockReturnValue(null)
    expect(getRepoConfig('BDE')).toBeNull()
  })

  it('returns null for an unknown repo name', () => {
    vi.mocked(getSettingJson).mockReturnValue([
      { name: 'BDE', localPath: '/projects/bde' }
    ])
    expect(getRepoConfig('nonexistent')).toBeNull()
  })

  it('returns the matching config by exact name', () => {
    const repo = { name: 'BDE', localPath: '/projects/bde' }
    vi.mocked(getSettingJson).mockReturnValue([repo])
    expect(getRepoConfig('BDE')).toEqual(repo)
  })

  it('matches case-insensitively regardless of input casing', () => {
    const repo = { name: 'BDE', localPath: '/projects/bde' }
    vi.mocked(getSettingJson).mockReturnValue([repo])
    expect(getRepoConfig('bde')).toEqual(repo)
    expect(getRepoConfig('Bde')).toEqual(repo)
    expect(getRepoConfig('BDE')).toEqual(repo)
  })

  it('matches when the stored name uses mixed case', () => {
    const repo = { name: 'MyProject', localPath: '/projects/myproject' }
    vi.mocked(getSettingJson).mockReturnValue([repo])
    expect(getRepoConfig('MYPROJECT')).toEqual(repo)
    expect(getRepoConfig('myproject')).toEqual(repo)
  })

  it('returns the first match when multiple repos have the same lower-cased name', () => {
    const first = { name: 'BDE', localPath: '/a' }
    const second = { name: 'bde', localPath: '/b' }
    vi.mocked(getSettingJson).mockReturnValue([first, second])
    expect(getRepoConfig('bde')).toEqual(first)
  })
})
