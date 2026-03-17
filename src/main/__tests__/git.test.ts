import { describe, it, expect, vi, beforeEach } from 'vitest'

// The promisified mock that git.ts will use as execFileAsync
const mockExecFileAsync = vi.fn().mockResolvedValue({ stdout: '', stderr: '' })

vi.mock('child_process', () => {
  const execFile = vi.fn() as any
  execFile[Symbol.for('nodejs.util.promisify.custom')] = mockExecFileAsync
  return { execFile }
})

import {
  gitCommit,
  gitCheckout,
  gitStage,
  gitUnstage,
  gitPush,
  gitStatus,
  gitBranches,
  gitDiffFile,
  getRepoPaths,
} from '../git'

describe('git.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' })
  })

  describe('gitCommit', () => {
    it('calls execFileAsync with commit args', async () => {
      await gitCommit('/tmp/repo', 'fix: something')

      expect(mockExecFileAsync).toHaveBeenCalledWith(
        'git',
        ['commit', '-m', 'fix: something'],
        { cwd: '/tmp/repo', encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
      )
    })

    it('passes special characters safely via execFileAsync', async () => {
      await gitCommit('/tmp/repo', 'fix: use "proper" quotes')

      expect(mockExecFileAsync).toHaveBeenCalledWith(
        'git',
        ['commit', '-m', 'fix: use "proper" quotes'],
        { cwd: '/tmp/repo', encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
      )
    })
  })

  describe('gitCheckout', () => {
    it('calls execFileAsync with checkout args', async () => {
      await gitCheckout('/tmp/repo', 'feat/new-branch')

      expect(mockExecFileAsync).toHaveBeenCalledWith(
        'git',
        ['checkout', 'feat/new-branch'],
        { cwd: '/tmp/repo', encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
      )
    })

    it('passes branch names with special characters safely', async () => {
      await gitCheckout('/tmp/repo', 'branch"name')

      expect(mockExecFileAsync).toHaveBeenCalledWith(
        'git',
        ['checkout', 'branch"name'],
        { cwd: '/tmp/repo', encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
      )
    })
  })

  describe('gitStage', () => {
    it('calls execFileAsync with git add and file paths', async () => {
      await gitStage('/tmp/repo', ['file1.ts', 'src/file2.ts'])

      expect(mockExecFileAsync).toHaveBeenCalledWith(
        'git',
        ['add', '--', 'file1.ts', 'src/file2.ts'],
        { cwd: '/tmp/repo', encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
      )
    })

    it('does nothing when files array is empty', async () => {
      await gitStage('/tmp/repo', [])

      expect(mockExecFileAsync).not.toHaveBeenCalled()
    })
  })

  describe('shell injection — gitCommit uses execFileAsync (safe)', () => {
    it('shell metacharacters are treated as literals', async () => {
      const malicious = '$(whoami)'
      await gitCommit('/tmp/repo', malicious)

      expect(mockExecFileAsync).toHaveBeenCalledWith(
        'git',
        ['commit', '-m', '$(whoami)'],
        expect.any(Object)
      )
    })
  })

  describe('gitPush', () => {
    it('returns stdout on success', async () => {
      mockExecFileAsync.mockResolvedValue({
        stdout: 'Everything up-to-date',
        stderr: '',
      })

      const result = await gitPush('/tmp/repo')
      expect(result).toBe('Everything up-to-date')
    })

    it('rejects on non-zero exit code', async () => {
      mockExecFileAsync.mockRejectedValue(
        new Error('error: failed to push some refs')
      )

      await expect(gitPush('/tmp/repo')).rejects.toThrow('error: failed to push some refs')
    })

    it('rejects on spawn error', async () => {
      mockExecFileAsync.mockRejectedValue(new Error('spawn git ENOENT'))

      await expect(gitPush('/tmp/repo')).rejects.toThrow('spawn git ENOENT')
    })

    it('uses fallback message when stdout and stderr are empty', async () => {
      mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' })

      const result = await gitPush('/tmp/repo')
      expect(result).toBe('Pushed successfully')
    })
  })

  describe('gitStatus', () => {
    it('parses porcelain output correctly', async () => {
      mockExecFileAsync.mockResolvedValue({
        stdout: 'M  src/file.ts\n?? untracked.ts\n',
        stderr: '',
      })

      const result = await gitStatus('/tmp/repo')
      expect(result.files).toContainEqual({ path: 'src/file.ts', status: 'M', staged: true })
      expect(result.files).toContainEqual({ path: 'untracked.ts', status: '?', staged: false })
    })

    it('returns empty files on error', async () => {
      mockExecFileAsync.mockRejectedValue(new Error('not a git repo'))

      const result = await gitStatus('/tmp/repo')
      expect(result.files).toEqual([])
    })
  })

  describe('gitBranches', () => {
    it('parses branch output and identifies current branch', async () => {
      mockExecFileAsync.mockResolvedValue({
        stdout: '  feat/test\n* main\n  develop\n',
        stderr: '',
      })

      const result = await gitBranches('/tmp/repo')
      expect(result.current).toBe('main')
      expect(result.branches).toEqual(['feat/test', 'main', 'develop'])
    })

    it('returns empty on error', async () => {
      mockExecFileAsync.mockRejectedValue(new Error('fail'))

      const result = await gitBranches('/tmp/repo')
      expect(result.current).toBe('')
      expect(result.branches).toEqual([])
    })
  })

  describe('gitUnstage', () => {
    it('calls execFileAsync with reset HEAD args', async () => {
      await gitUnstage('/tmp/repo', ['file1.ts'])

      expect(mockExecFileAsync).toHaveBeenCalledWith(
        'git',
        ['reset', 'HEAD', '--', 'file1.ts'],
        { cwd: '/tmp/repo', encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
      )
    })

    it('does nothing when files array is empty', async () => {
      await gitUnstage('/tmp/repo', [])

      expect(mockExecFileAsync).not.toHaveBeenCalled()
    })
  })

  describe('gitDiffFile', () => {
    it('calls execFileAsync for both staged and unstaged diffs', async () => {
      mockExecFileAsync
        .mockResolvedValueOnce({ stdout: 'unstaged diff\n', stderr: '' })
        .mockResolvedValueOnce({ stdout: 'staged diff\n', stderr: '' })

      const result = await gitDiffFile('/tmp/repo', 'src/file.ts')

      expect(mockExecFileAsync).toHaveBeenCalledWith(
        'git',
        ['diff', '--', 'src/file.ts'],
        expect.objectContaining({ cwd: '/tmp/repo' })
      )
      expect(mockExecFileAsync).toHaveBeenCalledWith(
        'git',
        ['diff', '--cached', '--', 'src/file.ts'],
        expect.objectContaining({ cwd: '/tmp/repo' })
      )
      expect(result).toContain('staged diff')
    })

    it('filenames with special chars are safe — no shell interpretation', async () => {
      await gitDiffFile('/tmp/repo', 'file$(whoami).ts')

      expect(mockExecFileAsync).toHaveBeenCalledWith(
        'git',
        ['diff', '--', 'file$(whoami).ts'],
        expect.any(Object)
      )
    })

    it('returns empty string on error', async () => {
      mockExecFileAsync.mockRejectedValue(new Error('fail'))

      expect(await gitDiffFile('/tmp/repo')).toBe('')
    })
  })

  describe('shell injection — gitStage uses execFileAsync (safe)', () => {
    it('filenames with shell metacharacters are passed as array args, not interpolated', async () => {
      await gitStage('/tmp/repo', ['$(rm -rf /)', 'file;echo pwned'])

      expect(mockExecFileAsync).toHaveBeenCalledWith(
        'git',
        ['add', '--', '$(rm -rf /)', 'file;echo pwned'],
        expect.any(Object)
      )
    })
  })

  describe('shell injection — gitCheckout uses execFileAsync (safe)', () => {
    it('branch names with semicolons do not inject', async () => {
      await gitCheckout('/tmp/repo', 'branch;rm -rf /')

      expect(mockExecFileAsync).toHaveBeenCalledWith(
        'git',
        ['checkout', 'branch;rm -rf /'],
        expect.any(Object)
      )
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
