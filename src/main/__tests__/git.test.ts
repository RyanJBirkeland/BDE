import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { execFileAsyncMock } = vi.hoisted(() => ({
  execFileAsyncMock: vi.fn().mockResolvedValue({ stdout: '', stderr: '' })
}))

vi.mock('child_process', () => {
  const execFile = vi.fn() as any
  execFile[Symbol.for('nodejs.util.promisify.custom')] = execFileAsyncMock
  return { execFile }
})

vi.mock('../config', () => ({
  getGitHubToken: vi.fn()
}))

vi.mock('../db', () => ({
  getDb: vi.fn()
}))

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
  pollPrStatuses,
} from '../git'
import { parsePrUrl } from '../../shared/github'
import { getGitHubToken } from '../config'
import { getDb } from '../db'

describe('git.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    execFileAsyncMock.mockResolvedValue({ stdout: '', stderr: '' })
  })

  describe('gitCommit', () => {
    it('calls execFileAsync with commit args', async () => {
      await gitCommit('/tmp/repo', 'fix: something')

      expect(execFileAsyncMock).toHaveBeenCalledWith(
        'git',
        ['commit', '-m', 'fix: something'],
        expect.objectContaining({ cwd: '/tmp/repo', encoding: 'utf-8' })
      )
    })

    it('passes special characters safely via execFileAsync', async () => {
      await gitCommit('/tmp/repo', 'fix: use "proper" quotes')

      expect(execFileAsyncMock).toHaveBeenCalledWith(
        'git',
        ['commit', '-m', 'fix: use "proper" quotes'],
        expect.objectContaining({ cwd: '/tmp/repo', encoding: 'utf-8' })
      )
    })
  })

  describe('gitCheckout', () => {
    it('calls execFileAsync with checkout args', async () => {
      await gitCheckout('/tmp/repo', 'feat/new-branch')

      expect(execFileAsyncMock).toHaveBeenCalledWith(
        'git',
        ['checkout', 'feat/new-branch'],
        expect.objectContaining({ cwd: '/tmp/repo', encoding: 'utf-8' })
      )
    })

    it('passes branch names with special characters safely', async () => {
      await gitCheckout('/tmp/repo', 'branch"name')

      expect(execFileAsyncMock).toHaveBeenCalledWith(
        'git',
        ['checkout', 'branch"name'],
        expect.objectContaining({ cwd: '/tmp/repo', encoding: 'utf-8' })
      )
    })
  })

  describe('gitStage', () => {
    it('calls execFileAsync with git add and file paths', async () => {
      await gitStage('/tmp/repo', ['file1.ts', 'src/file2.ts'])

      expect(execFileAsyncMock).toHaveBeenCalledWith(
        'git',
        ['add', '--', 'file1.ts', 'src/file2.ts'],
        expect.objectContaining({ cwd: '/tmp/repo', encoding: 'utf-8' })
      )
    })

    it('does nothing when files array is empty', async () => {
      await gitStage('/tmp/repo', [])

      expect(execFileAsyncMock).not.toHaveBeenCalled()
    })
  })

  describe('shell injection — gitCommit uses execFileAsync (safe)', () => {
    it('shell metacharacters are treated as literals', async () => {
      const malicious = '$(whoami)'
      await gitCommit('/tmp/repo', malicious)

      expect(execFileAsyncMock).toHaveBeenCalledWith(
        'git',
        ['commit', '-m', '$(whoami)'],
        expect.any(Object)
      )
    })
  })

  describe('gitPush', () => {
    it('returns stdout on success', async () => {
      execFileAsyncMock.mockResolvedValueOnce({ stdout: 'Everything up-to-date', stderr: '' })

      const result = await gitPush('/tmp/repo')
      expect(result).toBe('Everything up-to-date')
    })

    it('throws on non-zero exit code', async () => {
      execFileAsyncMock.mockRejectedValueOnce(new Error('error: failed to push some refs'))

      await expect(gitPush('/tmp/repo')).rejects.toThrow('error: failed to push some refs')
    })

    it('throws on spawn error', async () => {
      execFileAsyncMock.mockRejectedValueOnce(new Error('spawn git ENOENT'))

      await expect(gitPush('/tmp/repo')).rejects.toThrow('spawn git ENOENT')
    })

    it('uses fallback message when stdout and stderr are empty', async () => {
      execFileAsyncMock.mockResolvedValueOnce({ stdout: '', stderr: '' })

      const result = await gitPush('/tmp/repo')
      expect(result).toBe('Pushed successfully')
    })
  })

  describe('gitStatus', () => {
    it('parses porcelain output correctly', async () => {
      execFileAsyncMock.mockResolvedValueOnce({ stdout: 'M  src/file.ts\n?? untracked.ts\n', stderr: '' })

      const result = await gitStatus('/tmp/repo')
      expect(result.files).toContainEqual({ path: 'src/file.ts', status: 'M', staged: true })
      expect(result.files).toContainEqual({ path: 'untracked.ts', status: '?', staged: false })
    })

    it('returns empty files on error', async () => {
      execFileAsyncMock.mockRejectedValueOnce(new Error('not a git repo'))

      const result = await gitStatus('/tmp/repo')
      expect(result.files).toEqual([])
    })
  })

  describe('gitBranches', () => {
    it('parses branch output and identifies current branch', async () => {
      execFileAsyncMock.mockResolvedValueOnce({ stdout: '  feat/test\n* main\n  develop\n', stderr: '' })

      const result = await gitBranches('/tmp/repo')
      expect(result.current).toBe('main')
      expect(result.branches).toEqual(['feat/test', 'main', 'develop'])
    })

    it('returns empty on error', async () => {
      execFileAsyncMock.mockRejectedValueOnce(new Error('fail'))

      const result = await gitBranches('/tmp/repo')
      expect(result.current).toBe('')
      expect(result.branches).toEqual([])
    })
  })

  describe('gitUnstage', () => {
    it('calls execFileAsync with reset HEAD args', async () => {
      await gitUnstage('/tmp/repo', ['file1.ts'])

      expect(execFileAsyncMock).toHaveBeenCalledWith(
        'git',
        ['reset', 'HEAD', '--', 'file1.ts'],
        expect.objectContaining({ cwd: '/tmp/repo', encoding: 'utf-8' })
      )
    })

    it('does nothing when files array is empty', async () => {
      await gitUnstage('/tmp/repo', [])

      expect(execFileAsyncMock).not.toHaveBeenCalled()
    })
  })

  describe('gitDiffFile', () => {
    it('calls execFileAsync for both staged and unstaged diffs', async () => {
      execFileAsyncMock
        .mockResolvedValueOnce({ stdout: 'unstaged diff\n', stderr: '' })
        .mockResolvedValueOnce({ stdout: 'staged diff\n', stderr: '' })

      const result = await gitDiffFile('/tmp/repo', 'src/file.ts')

      expect(execFileAsyncMock).toHaveBeenCalledWith(
        'git',
        ['diff', '--', 'src/file.ts'],
        expect.objectContaining({ cwd: '/tmp/repo' })
      )
      expect(execFileAsyncMock).toHaveBeenCalledWith(
        'git',
        ['diff', '--cached', '--', 'src/file.ts'],
        expect.objectContaining({ cwd: '/tmp/repo' })
      )
      expect(result).toContain('staged diff')
    })

    it('filenames with special chars are safe via execFileAsync', async () => {
      await gitDiffFile('/tmp/repo', 'file$(whoami).ts')

      expect(execFileAsyncMock).toHaveBeenCalledWith(
        'git',
        ['diff', '--', 'file$(whoami).ts'],
        expect.any(Object)
      )
    })

    it('returns empty string on error', async () => {
      execFileAsyncMock.mockRejectedValueOnce(new Error('fail'))

      expect(await gitDiffFile('/tmp/repo')).toBe('')
    })
  })

  describe('shell injection — gitStage uses execFileAsync (safe)', () => {
    it('filenames with shell metacharacters are passed as array args, not interpolated', async () => {
      await gitStage('/tmp/repo', ['$(rm -rf /)', 'file;echo pwned'])

      expect(execFileAsyncMock).toHaveBeenCalledWith(
        'git',
        ['add', '--', '$(rm -rf /)', 'file;echo pwned'],
        expect.any(Object)
      )
    })
  })

  describe('shell injection — gitCheckout uses execFileAsync (safe)', () => {
    it('branch names with semicolons do not inject', async () => {
      await gitCheckout('/tmp/repo', 'branch;rm -rf /')

      expect(execFileAsyncMock).toHaveBeenCalledWith(
        'git',
        ['checkout', 'branch;rm -rf /'],
        expect.any(Object)
      )
    })
  })

  describe('getRepoPaths', () => {
    it('returns a copy of REPO_PATHS', () => {
      const paths = getRepoPaths()
      expect(paths).toHaveProperty('bde')
      expect(paths).toHaveProperty('life-os')
      expect(paths).toHaveProperty('feast')
    })
  })

  // --- PR status polling ---

  describe('parsePrUrl', () => {
    it('extracts owner/repo/number from a standard GitHub PR URL', () => {
      const result = parsePrUrl('https://github.com/octocat/hello-world/pull/42')
      expect(result).toEqual({ owner: 'octocat', repo: 'hello-world', number: 42 })
    })

    it('handles RBTECHBOT fork URLs', () => {
      const result = parsePrUrl('https://github.com/RyanJBirkeland/BDE/pull/163')
      expect(result).toEqual({ owner: 'RyanJBirkeland', repo: 'BDE', number: 163 })
    })

    it('returns null for non-PR GitHub URLs', () => {
      expect(parsePrUrl('https://github.com/octocat/hello-world')).toBeNull()
      expect(parsePrUrl('https://github.com/octocat/hello-world/issues/5')).toBeNull()
    })

    it('returns null for non-GitHub URLs', () => {
      expect(parsePrUrl('https://example.com/pull/1')).toBeNull()
      expect(parsePrUrl('')).toBeNull()
    })

    it('extracts from URLs with trailing path segments', () => {
      const result = parsePrUrl('https://github.com/org/repo/pull/99/files')
      expect(result).toEqual({ owner: 'org', repo: 'repo', number: 99 })
    })
  })

  describe('PR status polling', () => {
    const mockFetch = vi.fn()
    let mockRun: ReturnType<typeof vi.fn>
    let mockPrepare: ReturnType<typeof vi.fn>

    beforeEach(() => {
      mockFetch.mockReset()
      vi.stubGlobal('fetch', mockFetch)
      mockRun = vi.fn()
      mockPrepare = vi.fn(() => ({ run: mockRun }))
      vi.mocked(getDb).mockReturnValue({ prepare: mockPrepare } as any)
      vi.mocked(getGitHubToken).mockReturnValue('ghp_test_token')
    })

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    describe('fetchPrStatusRest (via pollPrStatuses)', () => {
      it('returns MERGED state when PR is merged', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          headers: { get: (): null => null },
          json: async () => ({ state: 'closed', merged_at: '2024-01-01T00:00:00Z' })
        })

        const results = await pollPrStatuses([
          { taskId: 't1', prUrl: 'https://github.com/octocat/repo/pull/1' }
        ])

        expect(results[0].state).toBe('MERGED')
        expect(results[0].merged).toBe(true)
        expect(results[0].mergedAt).toBe('2024-01-01T00:00:00Z')
      })

      it('returns OPEN state when PR is open', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          headers: { get: (): null => null },
          json: async () => ({ state: 'open', merged_at: null })
        })

        const results = await pollPrStatuses([
          { taskId: 't1', prUrl: 'https://github.com/octocat/repo/pull/1' }
        ])

        expect(results[0].state).toBe('OPEN')
        expect(results[0].merged).toBe(false)
      })

      it('returns CLOSED state when PR is closed but not merged', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          headers: { get: (): null => null },
          json: async () => ({ state: 'closed', merged_at: null })
        })

        const results = await pollPrStatuses([
          { taskId: 't1', prUrl: 'https://github.com/octocat/repo/pull/1' }
        ])

        expect(results[0].state).toBe('CLOSED')
        expect(results[0].merged).toBe(false)
      })

      it('returns error state on network failure', async () => {
        mockFetch.mockRejectedValueOnce(new Error('Network error'))

        const results = await pollPrStatuses([
          { taskId: 't1', prUrl: 'https://github.com/octocat/repo/pull/1' }
        ])

        expect(results[0].state).toBe('error')
        expect(results[0].merged).toBe(false)
      })

      it('returns error state on non-OK HTTP response', async () => {
        mockFetch.mockResolvedValueOnce({ ok: false, headers: { get: (): null => null } })

        const results = await pollPrStatuses([
          { taskId: 't1', prUrl: 'https://github.com/octocat/repo/pull/1' }
        ])

        expect(results[0].state).toBe('error')
      })

      it('returns unknown state for invalid PR URL', async () => {
        const results = await pollPrStatuses([
          { taskId: 't1', prUrl: 'https://example.com/not-a-pr' }
        ])

        expect(results[0].state).toBe('unknown')
        expect(mockFetch).not.toHaveBeenCalled()
      })

      it('returns error state when no GitHub token is available', async () => {
        vi.mocked(getGitHubToken).mockReturnValue(null)

        const results = await pollPrStatuses([
          { taskId: 't1', prUrl: 'https://github.com/octocat/repo/pull/1' }
        ])

        expect(results[0].state).toBe('error')
        expect(mockFetch).not.toHaveBeenCalled()
      })
    })

    describe('pollPrStatuses', () => {
      it('processes multiple PRs and returns results for all', async () => {
        mockFetch
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({ state: 'open', merged_at: null })
          })
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({ state: 'closed', merged_at: '2024-06-01T00:00:00Z' })
          })

        const results = await pollPrStatuses([
          { taskId: 't1', prUrl: 'https://github.com/octocat/repo/pull/1' },
          { taskId: 't2', prUrl: 'https://github.com/octocat/repo/pull/2' }
        ])

        expect(results).toHaveLength(2)
        expect(results[0].taskId).toBe('t1')
        expect(results[1].taskId).toBe('t2')
      })

      it('skips DB update when PR URL is unparseable', async () => {
        const results = await pollPrStatuses([
          { taskId: 't1', prUrl: 'not-a-url' }
        ])

        expect(results).toHaveLength(1)
        expect(mockPrepare).not.toHaveBeenCalled()
      })

      it('returns empty array for empty input', async () => {
        const results = await pollPrStatuses([])
        expect(results).toEqual([])
      })
    })

    describe('markTaskDoneOnMerge (via pollPrStatuses)', () => {
      it('updates sprint_tasks to done with completed_at on merge', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          headers: { get: (): null => null },
          json: async () => ({ state: 'closed', merged_at: '2024-01-15T12:00:00Z' })
        })

        await pollPrStatuses([
          { taskId: 't1', prUrl: 'https://github.com/octocat/repo/pull/55' }
        ])

        expect(mockPrepare).toHaveBeenCalledWith(
          "UPDATE sprint_tasks SET status='done', completed_at=? WHERE pr_number=? AND status='active'"
        )
        expect(mockRun).toHaveBeenCalledWith(expect.any(String), 55)
      })
    })

    describe('markTaskCancelled (via pollPrStatuses)', () => {
      it('updates sprint_tasks to cancelled with completed_at on close', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          headers: { get: (): null => null },
          json: async () => ({ state: 'closed', merged_at: null })
        })

        await pollPrStatuses([
          { taskId: 't1', prUrl: 'https://github.com/octocat/repo/pull/77' }
        ])

        expect(mockPrepare).toHaveBeenCalledWith(
          "UPDATE sprint_tasks SET status='cancelled', completed_at=? WHERE pr_number=? AND status='active'"
        )
        expect(mockRun).toHaveBeenCalledWith(expect.any(String), 77)
      })

      it('does not update DB when PR is still open', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          headers: { get: (): null => null },
          json: async () => ({ state: 'open', merged_at: null })
        })

        await pollPrStatuses([
          { taskId: 't1', prUrl: 'https://github.com/octocat/repo/pull/88' }
        ])

        expect(mockPrepare).not.toHaveBeenCalled()
      })
    })
  })
})
