import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getRepoPaths } from '../settings'

describe('settings service', () => {
  beforeEach(() => {
    vi.mocked(window.api.getRepoPaths).mockResolvedValue({
      BDE: '/Users/ryan/projects/BDE',
      'life-os': '/Users/ryan/projects/life-os'
    })
  })

  it('getRepoPaths delegates to window.api.getRepoPaths', async () => {
    const result = await getRepoPaths()
    expect(window.api.getRepoPaths).toHaveBeenCalled()
    expect(result).toEqual({
      BDE: '/Users/ryan/projects/BDE',
      'life-os': '/Users/ryan/projects/life-os'
    })
  })
})
