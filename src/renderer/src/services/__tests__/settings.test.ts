import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getRepoPaths } from '../settings'

describe('settings service', () => {
  beforeEach(() => {
    vi.mocked(window.api.git.getRepoPaths).mockResolvedValue({
      BDE: '/Users/ryan/projects/BDE',
      'life-os': '/Users/ryan/projects/life-os'
    })
  })

  it('getRepoPaths delegates to window.api.git.getRepoPaths', async () => {
    const result = await getRepoPaths()
    expect(window.api.git.getRepoPaths).toHaveBeenCalled()
    expect(result).toEqual({
      BDE: '/Users/ryan/projects/BDE',
      'life-os': '/Users/ryan/projects/life-os'
    })
  })
})
