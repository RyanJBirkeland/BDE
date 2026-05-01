import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../async-utils', () => ({
  execFileAsync: vi.fn()
}))

import { execFileAsync } from '../async-utils'
import { clearDefaultBranchCache, resolveDefaultBranch } from '../default-branch'

const mockedExec = vi.mocked(execFileAsync)

describe('resolveDefaultBranch', () => {
  beforeEach(() => {
    clearDefaultBranchCache()
    mockedExec.mockReset()
  })

  afterEach(() => {
    clearDefaultBranchCache()
  })

  it('returns the branch name parsed from origin/HEAD', async () => {
    mockedExec.mockResolvedValueOnce({ stdout: 'origin/master\n', stderr: '' })

    const branch = await resolveDefaultBranch('/repo')

    expect(branch).toBe('master')
    expect(mockedExec).toHaveBeenCalledWith(
      'git',
      ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'],
      { cwd: '/repo' }
    )
  })

  it('returns main when origin/HEAD reports main', async () => {
    mockedExec.mockResolvedValueOnce({ stdout: 'origin/main\n', stderr: '' })

    expect(await resolveDefaultBranch('/repo')).toBe('main')
  })

  it('falls back to main when origin/HEAD is not configured', async () => {
    mockedExec.mockRejectedValueOnce(
      new Error('fatal: ref refs/remotes/origin/HEAD is not a symbolic ref')
    )

    expect(await resolveDefaultBranch('/repo')).toBe('main')
  })

  it('caches the resolved branch per repo', async () => {
    mockedExec.mockResolvedValueOnce({ stdout: 'origin/develop\n', stderr: '' })

    await resolveDefaultBranch('/repo-a')
    await resolveDefaultBranch('/repo-a')
    await resolveDefaultBranch('/repo-a')

    expect(mockedExec).toHaveBeenCalledTimes(1)
  })

  it('resolves separately per repo path', async () => {
    mockedExec
      .mockResolvedValueOnce({ stdout: 'origin/master\n', stderr: '' })
      .mockResolvedValueOnce({ stdout: 'origin/main\n', stderr: '' })

    expect(await resolveDefaultBranch('/repo-a')).toBe('master')
    expect(await resolveDefaultBranch('/repo-b')).toBe('main')
    expect(mockedExec).toHaveBeenCalledTimes(2)
  })

  it('clearDefaultBranchCache forces re-detection', async () => {
    mockedExec
      .mockResolvedValueOnce({ stdout: 'origin/master\n', stderr: '' })
      .mockResolvedValueOnce({ stdout: 'origin/main\n', stderr: '' })

    expect(await resolveDefaultBranch('/repo')).toBe('master')
    clearDefaultBranchCache()
    expect(await resolveDefaultBranch('/repo')).toBe('main')
  })

  it('handles refs without origin/ prefix gracefully', async () => {
    mockedExec.mockResolvedValueOnce({ stdout: 'develop\n', stderr: '' })

    expect(await resolveDefaultBranch('/repo')).toBe('develop')
  })
})
