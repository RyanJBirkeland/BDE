import { describe, it, expect, vi, beforeEach } from 'vitest'

const { execFileAsyncMock } = vi.hoisted(() => {
  const execFileAsyncMock = vi.fn().mockResolvedValue({ stdout: '', stderr: '' })
  return { execFileAsyncMock }
})

vi.mock('child_process', () => {
  const execFile = vi.fn() as any
  execFile[Symbol.for('nodejs.util.promisify.custom')] = execFileAsyncMock
  return { execFile, spawn: vi.fn() }
})

vi.mock('fs/promises', () => ({
  readdir: vi.fn(),
  stat: vi.fn(),
  access: vi.fn(),
  mkdir: vi.fn()
}))

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  app: { getPath: () => '/tmp' }
}))

vi.mock('../../settings', () => ({
  getSettingJson: vi.fn(() => [])
}))

vi.mock('../../ipc-utils', () => ({
  safeHandle: vi.fn()
}))

vi.mock('../../broadcast', () => ({
  broadcast: vi.fn()
}))

import { scanLocalRepos, listGithubRepos, cloneRepo } from '../repo-discovery'
import { readdir, stat, access, mkdir } from 'fs/promises'
import { spawn } from 'child_process'
import { getSettingJson } from '../../settings'

describe('scanLocalRepos', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns repos found in scanned directories', async () => {
    vi.mocked(readdir).mockResolvedValue(['repo-a', 'repo-b'] as any)
    vi.mocked(stat).mockResolvedValue({ isDirectory: () => true } as any)
    vi.mocked(access).mockResolvedValue(undefined)
    execFileAsyncMock.mockResolvedValue({
      stdout: 'git@github.com:owner/repo-a.git\n',
      stderr: ''
    })

    const result = await scanLocalRepos(['/Users/test/projects'])
    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'repo-a', localPath: '/Users/test/projects/repo-a' })
      ])
    )
  })

  it('filters out already-configured repos', async () => {
    vi.mocked(getSettingJson).mockReturnValue([
      { name: 'repo-a', localPath: '/Users/test/projects/repo-a' }
    ] as any)
    vi.mocked(readdir).mockResolvedValue(['repo-a', 'repo-b'] as any)
    vi.mocked(stat).mockResolvedValue({ isDirectory: () => true } as any)
    vi.mocked(access).mockResolvedValue(undefined)
    execFileAsyncMock.mockResolvedValue({ stdout: '', stderr: '' })

    const result = await scanLocalRepos(['/Users/test/projects'])
    expect(result.find((r) => r.name === 'repo-a')).toBeUndefined()
    expect(result.find((r) => r.name === 'repo-b')).toBeDefined()
  })

  it('rejects paths with .. traversal', async () => {
    await expect(scanLocalRepos(['/Users/test/../etc'])).rejects.toThrow()
  })

  it('skips non-directory entries', async () => {
    vi.mocked(readdir).mockResolvedValue(['file.txt'] as any)
    vi.mocked(stat).mockResolvedValue({ isDirectory: () => false } as any)

    const result = await scanLocalRepos(['/Users/test/projects'])
    expect(result).toEqual([])
  })
})

describe('listGithubRepos', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('parses gh CLI output and maps fields', async () => {
    execFileAsyncMock.mockResolvedValue({
      stdout: JSON.stringify([
        {
          name: 'my-repo',
          owner: { login: 'octocat' },
          description: 'A test repo',
          visibility: 'public',
          url: 'https://github.com/octocat/my-repo'
        }
      ]),
      stderr: ''
    })

    const result = await listGithubRepos()
    expect(result).toEqual([
      {
        name: 'my-repo',
        owner: 'octocat',
        description: 'A test repo',
        isPrivate: false,
        url: 'https://github.com/octocat/my-repo'
      }
    ])
  })

  it('filters out already-configured repos', async () => {
    vi.mocked(getSettingJson).mockReturnValue([
      { name: 'my-repo', localPath: '/x', githubOwner: 'octocat', githubRepo: 'my-repo' }
    ] as any)
    execFileAsyncMock.mockResolvedValue({
      stdout: JSON.stringify([
        {
          name: 'my-repo',
          owner: { login: 'octocat' },
          description: '',
          visibility: 'public',
          url: ''
        }
      ]),
      stderr: ''
    })

    const result = await listGithubRepos()
    expect(result).toEqual([])
  })

  it('throws descriptive error when gh is not found', async () => {
    const err = new Error('ENOENT') as any
    err.code = 'ENOENT'
    execFileAsyncMock.mockRejectedValue(err)

    await expect(listGithubRepos()).rejects.toThrow(/gh/)
  })
})

describe('cloneRepo destDir validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects destDir outside home directory', () => {
    expect(() => cloneRepo('owner', 'repo', '/etc/evil')).toThrow(
      'Clone destination must be within your home directory'
    )
  })

  it('rejects destDir that is an absolute path outside home', () => {
    expect(() => cloneRepo('owner', 'repo', '/tmp/evil-dest')).toThrow(
      'Clone destination must be within your home directory'
    )
  })

  it('accepts destDir within home directory', () => {
    vi.mocked(mkdir).mockResolvedValue(undefined as any)
    vi.mocked(spawn).mockReturnValue({
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn()
    } as any)
    // ~/projects expands to homedir/projects — should not throw
    expect(() => cloneRepo('owner', 'repo', '~/projects')).not.toThrow()
  })
})

describe('cloneRepo owner/repo validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects owner containing a forward slash', () => {
    expect(() => cloneRepo('bad/owner', 'repo', '~/projects')).toThrow(
      'Invalid repository identifier'
    )
  })

  it('rejects owner containing a space', () => {
    expect(() => cloneRepo('bad owner', 'repo', '~/projects')).toThrow(
      'Invalid repository identifier'
    )
  })

  it('rejects owner containing a semicolon', () => {
    expect(() => cloneRepo('owner;rm -rf /', 'repo', '~/projects')).toThrow(
      'Invalid repository identifier'
    )
  })

  it('rejects repo containing a forward slash', () => {
    expect(() => cloneRepo('owner', 'bad/repo', '~/projects')).toThrow(
      'Invalid repository identifier'
    )
  })

  it('accepts a normal owner and repo like anthropics/claude-code', () => {
    vi.mocked(mkdir).mockResolvedValue(undefined as any)
    vi.mocked(spawn).mockReturnValue({
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn()
    } as any)
    // Should not throw
    expect(() => cloneRepo('anthropics', 'claude-code', '~/projects')).not.toThrow()
  })

  it('accepts owner/repo with underscores and dots', () => {
    vi.mocked(mkdir).mockResolvedValue(undefined as any)
    vi.mocked(spawn).mockReturnValue({
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn()
    } as any)
    expect(() => cloneRepo('my_org', 'my.repo', '~/projects')).not.toThrow()
  })
})
