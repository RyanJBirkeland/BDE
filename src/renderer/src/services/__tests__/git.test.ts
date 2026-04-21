import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  getRepoPaths,
  getGitStatus,
  getGitDiff,
  stageFiles,
  unstageFiles,
  commit,
  push,
  getBranches
} from '../git'

describe('git service', () => {
  beforeEach(() => {
    vi.mocked(window.api.git.getRepoPaths).mockResolvedValue({})
    vi.mocked(window.api.git.status).mockResolvedValue({ files: [], branch: 'main' })
    vi.mocked(window.api.git.diff).mockResolvedValue('')
    vi.mocked(window.api.git.stage).mockResolvedValue(undefined)
    vi.mocked(window.api.git.unstage).mockResolvedValue(undefined)
    vi.mocked(window.api.git.commit).mockResolvedValue(undefined)
    vi.mocked(window.api.git.push).mockResolvedValue('')
    vi.mocked(window.api.git.branches).mockResolvedValue({ current: 'main', branches: ['main'] })
  })

  it('getRepoPaths delegates to window.api.git.getRepoPaths', async () => {
    vi.mocked(window.api.git.getRepoPaths).mockResolvedValue({ bde: '/Users/ryan/projects/BDE' })
    const result = await getRepoPaths()
    expect(window.api.git.getRepoPaths).toHaveBeenCalled()
    expect(result).toEqual({ bde: '/Users/ryan/projects/BDE' })
  })

  it('getGitStatus delegates to window.api.git.status', async () => {
    await getGitStatus('/cwd')
    expect(window.api.git.status).toHaveBeenCalledWith('/cwd')
  })

  it('getGitDiff delegates to window.api.git.diff', async () => {
    await getGitDiff('/cwd', 'file.ts')
    expect(window.api.git.diff).toHaveBeenCalledWith('/cwd', 'file.ts')
  })

  it('stageFiles delegates to window.api.git.stage', async () => {
    await stageFiles('/cwd', ['a.ts'])
    expect(window.api.git.stage).toHaveBeenCalledWith('/cwd', ['a.ts'])
  })

  it('unstageFiles delegates to window.api.git.unstage', async () => {
    await unstageFiles('/cwd', ['a.ts'])
    expect(window.api.git.unstage).toHaveBeenCalledWith('/cwd', ['a.ts'])
  })

  it('commit delegates to window.api.git.commit', async () => {
    await commit('/cwd', 'feat: add thing')
    expect(window.api.git.commit).toHaveBeenCalledWith('/cwd', 'feat: add thing')
  })

  it('push delegates to window.api.git.push', async () => {
    await push('/cwd')
    expect(window.api.git.push).toHaveBeenCalledWith('/cwd')
  })

  it('getBranches delegates to window.api.git.branches', async () => {
    await getBranches('/cwd')
    expect(window.api.git.branches).toHaveBeenCalledWith('/cwd')
  })
})
