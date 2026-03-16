import { describe, it, expect, vi, beforeEach } from 'vitest'
import { execSync } from 'child_process'
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
    it('calls execSync with commit -m and the message', () => {
      gitCommit('/tmp/repo', 'fix: something')

      expect(execSync).toHaveBeenCalledWith(
        'git commit -m "fix: something"',
        { cwd: '/tmp/repo', encoding: 'utf-8' }
      )
    })

    it('escapes double quotes in the message', () => {
      gitCommit('/tmp/repo', 'fix: use "proper" quotes')

      expect(execSync).toHaveBeenCalledWith(
        'git commit -m "fix: use \\"proper\\" quotes"',
        { cwd: '/tmp/repo', encoding: 'utf-8' }
      )
    })
  })

  describe('gitCheckout', () => {
    it('calls execSync with checkout and branch name', () => {
      gitCheckout('/tmp/repo', 'feat/new-branch')

      expect(execSync).toHaveBeenCalledWith(
        'git checkout "feat/new-branch"',
        { cwd: '/tmp/repo', encoding: 'utf-8' }
      )
    })

    it('escapes double quotes in branch name', () => {
      gitCheckout('/tmp/repo', 'branch"name')

      expect(execSync).toHaveBeenCalledWith(
        'git checkout "branch\\"name"',
        { cwd: '/tmp/repo', encoding: 'utf-8' }
      )
    })
  })

  describe('gitStage', () => {
    it('calls execSync with git add and quoted file paths', () => {
      gitStage('/tmp/repo', ['file1.ts', 'src/file2.ts'])

      expect(execSync).toHaveBeenCalledWith(
        'git add "file1.ts" "src/file2.ts"',
        { cwd: '/tmp/repo', encoding: 'utf-8' }
      )
    })

    it('does nothing when files array is empty', () => {
      gitStage('/tmp/repo', [])

      expect(execSync).not.toHaveBeenCalled()
    })
  })

  describe('shell injection — gitCommit', () => {
    it('does NOT use execFileSync — message with $(whoami) is interpolated into shell string', () => {
      // This test documents the current behavior: gitCommit uses string interpolation
      // with execSync, which means shell metacharacters in the message ARE interpreted
      // by the shell. The quote escaping only handles double quotes.
      //
      // A message containing $(whoami) would be passed as:
      //   git commit -m "$(whoami)"
      // which the shell WILL execute as a command substitution.
      //
      // This is a known security issue — gitCommit should use execFileSync instead.
      const malicious = '$(whoami)'
      gitCommit('/tmp/repo', malicious)

      // Verify it's called with string interpolation (not safe execFileSync)
      const call = vi.mocked(execSync).mock.calls[0]
      expect(call[0]).toBe('git commit -m "$(whoami)"')
      // The command string contains the shell metacharacter unescaped
      expect(call[0]).toContain('$(whoami)')
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
