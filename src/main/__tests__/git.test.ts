import { describe, it, expect, vi, beforeEach } from 'vitest'
import { execSync, execFileSync } from 'child_process'
import {
  gitCommit,
  gitCheckout,
  gitStage,
  gitPush,
  gitStatus,
  gitBranches,
  getRepoPaths,
} from '../git'

vi.mock('child_process', () => ({
  execSync: vi.fn(),
  execFileSync: vi.fn(),
}))

vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>()
  return {
    ...actual,
    readFile: vi.fn(),
  }
})

describe('git.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('gitCommit', () => {
    it('calls execFileSync with commit args', () => {
      gitCommit('/tmp/repo', 'fix: something')

      expect(execFileSync).toHaveBeenCalledWith(
        'git',
        ['commit', '-m', 'fix: something'],
        { cwd: '/tmp/repo', encoding: 'utf-8' }
      )
    })

    it('passes special characters safely via execFileSync', () => {
      gitCommit('/tmp/repo', 'fix: use "proper" quotes')

      expect(execFileSync).toHaveBeenCalledWith(
        'git',
        ['commit', '-m', 'fix: use "proper" quotes'],
        { cwd: '/tmp/repo', encoding: 'utf-8' }
      )
    })
  })

  describe('gitCheckout', () => {
    it('calls execFileSync with checkout args', () => {
      gitCheckout('/tmp/repo', 'feat/new-branch')

      expect(execFileSync).toHaveBeenCalledWith(
        'git',
        ['checkout', 'feat/new-branch'],
        { cwd: '/tmp/repo', encoding: 'utf-8' }
      )
    })

    it('passes branch names with special characters safely', () => {
      gitCheckout('/tmp/repo', 'branch"name')

      expect(execFileSync).toHaveBeenCalledWith(
        'git',
        ['checkout', 'branch"name'],
        { cwd: '/tmp/repo', encoding: 'utf-8' }
      )
    })
  })

  describe('gitStage', () => {
    it('calls execFileSync with git add and file paths', () => {
      gitStage('/tmp/repo', ['file1.ts', 'src/file2.ts'])

      expect(execFileSync).toHaveBeenCalledWith(
        'git',
        ['add', '--', 'file1.ts', 'src/file2.ts'],
        { cwd: '/tmp/repo', encoding: 'utf-8' }
      )
    })

    it('does nothing when files array is empty', () => {
      gitStage('/tmp/repo', [])

      expect(execFileSync).not.toHaveBeenCalled()
    })
  })

  describe('shell injection — gitCommit uses execFileSync (safe)', () => {
    it('uses execFileSync — shell metacharacters are treated as literals', () => {
      // execFileSync does not invoke a shell, so $(whoami) is passed as a
      // literal string to git, not interpreted by the shell.
      const malicious = '$(whoami)'
      gitCommit('/tmp/repo', malicious)

      expect(execFileSync).toHaveBeenCalledWith(
        'git',
        ['commit', '-m', '$(whoami)'],
        expect.any(Object)
      )
      // Verify execSync was NOT used for commit
      expect(execSync).not.toHaveBeenCalled()
    })
  })

  describe('gitPush', () => {
    it('returns stdout on success', () => {
      vi.mocked(execSync).mockReturnValue('Everything up-to-date\n')

      const result = gitPush('/tmp/repo')
      expect(result).toBe('Everything up-to-date\n')
    })

    it('returns error string on failure', () => {
      const error = new Error('push failed') as Error & { stdout: string; stderr: string }
      error.stdout = 'rejected'
      error.stderr = ''
      vi.mocked(execSync).mockImplementation(() => { throw error })

      const result = gitPush('/tmp/repo')
      expect(result).toBe('rejected')
    })

    it('returns error message when no stdout/stderr', () => {
      vi.mocked(execSync).mockImplementation(() => { throw new Error('network error') })

      const result = gitPush('/tmp/repo')
      expect(result).toBe('network error')
    })
  })

  describe('gitStatus', () => {
    it('parses porcelain output correctly', () => {
      vi.mocked(execSync).mockReturnValue('M  src/file.ts\n?? untracked.ts\n')

      const result = gitStatus('/tmp/repo')
      expect(result.files).toContainEqual({ path: 'src/file.ts', status: 'M', staged: true })
      expect(result.files).toContainEqual({ path: 'untracked.ts', status: '?', staged: false })
    })

    it('returns empty files on error', () => {
      vi.mocked(execSync).mockImplementation(() => { throw new Error('not a git repo') })

      const result = gitStatus('/tmp/repo')
      expect(result.files).toEqual([])
    })
  })

  describe('gitBranches', () => {
    it('parses branch output and identifies current branch', () => {
      vi.mocked(execSync).mockReturnValue('  feat/test\n* main\n  develop\n')

      const result = gitBranches('/tmp/repo')
      expect(result.current).toBe('main')
      expect(result.branches).toEqual(['feat/test', 'main', 'develop'])
    })

    it('returns empty on error', () => {
      vi.mocked(execSync).mockImplementation(() => { throw new Error('fail') })

      const result = gitBranches('/tmp/repo')
      expect(result.current).toBe('')
      expect(result.branches).toEqual([])
    })
  })

  describe('getRepoPaths', () => {
    it('returns a copy of REPO_PATHS', () => {
      const paths = getRepoPaths()
      expect(paths).toHaveProperty('BDE')
      expect(paths).toHaveProperty('life-os')
      expect(paths).toHaveProperty('feast')
    })
  })
})
