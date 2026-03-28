/**
 * Git handler unit tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'

// Mock ipc-utils first
vi.mock('../../ipc-utils', () => ({
  safeHandle: vi.fn()
}))

// Mock git module
vi.mock('../../git', () => ({
  getRepoPaths: vi.fn(),
  gitStatus: vi.fn(),
  gitDiffFile: vi.fn(),
  gitStage: vi.fn(),
  gitUnstage: vi.fn(),
  gitCommit: vi.fn(),
  gitPush: vi.fn(),
  gitBranches: vi.fn(),
  gitCheckout: vi.fn()
}))

// Mock validation — passthrough by default
vi.mock('../../validation', () => ({
  validateRepoPath: vi.fn((p: string) => p)
}))

// Mock github-fetch
vi.mock('../../github-fetch', () => ({
  githubFetch: vi.fn(),
  parseNextLink: vi.fn().mockReturnValue(null),
  fetchAllGitHubPages: vi.fn()
}))

// Mock config
vi.mock('../../config', () => ({
  getGitHubToken: vi.fn()
}))

// Mock github-pr-status
vi.mock('../../github-pr-status', () => ({
  pollPrStatuses: vi.fn()
}))

// Mock github-conflict-check
vi.mock('../../github-conflict-check', () => ({
  checkConflictFiles: vi.fn()
}))

// Mock pr-poller
vi.mock('../../pr-poller', () => ({
  getLatestPrList: vi.fn(),
  refreshPrList: vi.fn()
}))

// Mock sprint-local (imported by git-handlers for PR task status updates)
vi.mock('../sprint-local', () => ({
  markTaskDoneByPrNumber: vi.fn(),
  markTaskCancelledByPrNumber: vi.fn(),
  updateTaskMergeableState: vi.fn(),
  UPDATE_ALLOWLIST: new Set(),
  onSprintMutation: vi.fn(),
  buildQuickSpecPrompt: vi.fn(),
  getTemplateScaffold: vi.fn()
}))

// Mock shared/github
vi.mock('../../../shared/github', () => ({
  parsePrUrl: vi.fn()
}))

import { registerGitHandlers } from '../git-handlers'
import { safeHandle } from '../../ipc-utils'
import { getRepoPaths, gitStatus, gitDiffFile, gitCommit } from '../../git'
import { getGitHubToken } from '../../config'
import { githubFetch, parseNextLink } from '../../github-fetch'
import { getLatestPrList, refreshPrList } from '../../pr-poller'
import { pollPrStatuses } from '../../github-pr-status'
import { parsePrUrl } from '../../../shared/github'
import {
  markTaskDoneByPrNumber,
  markTaskCancelledByPrNumber,
  updateTaskMergeableState
} from '../sprint-local'

const mockEvent = {} as IpcMainInvokeEvent

function captureHandler(channel: string): (...args: any[]) => any {
  let captured: ((...args: any[]) => any) | undefined

  vi.mocked(safeHandle).mockImplementation((ch, handler) => {
    if (ch === channel) captured = handler as (...args: any[]) => any
  })

  registerGitHandlers()

  if (!captured) throw new Error(`No handler captured for channel "${channel}"`)
  return captured
}

describe('registerGitHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('registers all expected channels', () => {
    registerGitHandlers()
    const channels = vi.mocked(safeHandle).mock.calls.map(([ch]) => ch)
    expect(channels).toContain('github:fetch')
    expect(channels).toContain('git:getRepoPaths')
    expect(channels).toContain('git:status')
    expect(channels).toContain('git:diff')
    expect(channels).toContain('git:commit')
    expect(channels).toContain('git:push')
    expect(channels).toContain('git:branches')
    expect(channels).toContain('git:checkout')
    expect(channels).toContain('pr:pollStatuses')
    expect(channels).toContain('pr:checkConflictFiles')
    expect(channels).toContain('pr:getList')
    expect(channels).toContain('pr:refreshList')
  })
})

describe('git:getRepoPaths handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns repo paths map', () => {
    const paths = { BDE: '/Users/test/projects/BDE' }
    vi.mocked(getRepoPaths).mockReturnValue(paths)

    const handler = captureHandler('git:getRepoPaths')
    const result = handler(mockEvent)

    expect(getRepoPaths).toHaveBeenCalled()
    expect(result).toEqual(paths)
  })
})

describe('git:status handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns file status when git succeeds', async () => {
    const files = [{ path: 'src/foo.ts', status: 'M', staged: true }]
    vi.mocked(gitStatus).mockResolvedValue({ ok: true, data: { files } })

    const handler = captureHandler('git:status')
    const result = await handler(mockEvent, '/Users/test/projects/BDE')

    expect(gitStatus).toHaveBeenCalledWith('/Users/test/projects/BDE')
    expect(result).toEqual({ files })
  })

  it('returns empty files array on git error', async () => {
    vi.mocked(gitStatus).mockResolvedValue({ ok: false, error: 'git failed' })

    const handler = captureHandler('git:status')
    const result = await handler(mockEvent, '/Users/test/projects/BDE')

    expect(result).toEqual({ files: [] })
  })
})

describe('git:diff handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns diff string when git succeeds', async () => {
    const diff = '--- a/foo.ts\n+++ b/foo.ts\n@@ -1 +1 @@\n-old\n+new'
    vi.mocked(gitDiffFile).mockResolvedValue({ ok: true, data: diff })

    const handler = captureHandler('git:diff')
    const result = await handler(mockEvent, '/Users/test/projects/BDE', 'src/foo.ts')

    expect(gitDiffFile).toHaveBeenCalledWith('/Users/test/projects/BDE', 'src/foo.ts')
    expect(result).toBe(diff)
  })

  it('returns empty string on diff error', async () => {
    vi.mocked(gitDiffFile).mockResolvedValue({ ok: false, error: 'diff error' })

    const handler = captureHandler('git:diff')
    const result = await handler(mockEvent, '/Users/test/projects/BDE')

    expect(result).toBe('')
  })
})

describe('git:commit handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('delegates to gitCommit with repo path and message', async () => {
    vi.mocked(gitCommit).mockResolvedValue(undefined as any)

    const handler = captureHandler('git:commit')
    await handler(mockEvent, '/Users/test/projects/BDE', 'feat: add feature')

    expect(gitCommit).toHaveBeenCalledWith('/Users/test/projects/BDE', 'feat: add feature')
  })
})

describe('github:fetch handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws when GitHub token is not configured', async () => {
    vi.mocked(getGitHubToken).mockReturnValue(null)

    const handler = captureHandler('github:fetch')
    await expect(handler(mockEvent, '/repos/owner/repo/pulls')).rejects.toThrow(
      'GitHub token not configured'
    )
  })

  it('fetches JSON and returns structured response', async () => {
    vi.mocked(getGitHubToken).mockReturnValue('ghp_token')
    vi.mocked(parseNextLink).mockReturnValue(null)

    const mockResponse = {
      ok: true,
      status: 200,
      headers: {
        get: vi.fn((key: string) => {
          if (key === 'content-type') return 'application/json'
          if (key === 'Link') return null
          return null
        })
      },
      json: vi.fn().mockResolvedValue([{ id: 1, title: 'PR #1' }])
    }
    vi.mocked(githubFetch).mockResolvedValue(mockResponse as any)

    const handler = captureHandler('github:fetch')
    const result = await handler(mockEvent, '/repos/owner/repo/pulls')

    expect(githubFetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/owner/repo/pulls',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer ghp_token' })
      })
    )
    expect(result).toMatchObject({ ok: true, status: 200, linkNext: null })
    expect(result.body).toEqual([{ id: 1, title: 'PR #1' }])
  })

  it('strips caller Authorization header', async () => {
    vi.mocked(getGitHubToken).mockReturnValue('server_token')
    vi.mocked(parseNextLink).mockReturnValue(null)

    const mockResponse = {
      ok: true,
      status: 200,
      headers: {
        get: vi.fn((key: string) => {
          if (key === 'content-type') return 'application/json'
          return null
        })
      },
      json: vi.fn().mockResolvedValue({})
    }
    vi.mocked(githubFetch).mockResolvedValue(mockResponse as any)

    const handler = captureHandler('github:fetch')
    await handler(mockEvent, '/repos/owner/repo', {
      headers: { Authorization: 'Bearer caller_token', 'X-Custom': 'value' }
    })

    // The Authorization header in the call should be the server token, not the caller token
    const callArgs = vi.mocked(githubFetch).mock.calls[0]
    expect((callArgs[1] as any).headers.Authorization).toBe('Bearer server_token')
  })

  it('rejects non-api.github.com full URLs', async () => {
    vi.mocked(getGitHubToken).mockReturnValue('ghp_token')

    const handler = captureHandler('github:fetch')
    await expect(handler(mockEvent, 'https://evil.example.com/steal')).rejects.toThrow(
      'github:fetch only allows api.github.com URLs'
    )
  })

  describe('allowlist validation', () => {
    beforeEach(() => {
      vi.mocked(getGitHubToken).mockReturnValue('ghp_token')
      vi.clearAllMocks()
    })

    it('allows GET requests to /repos/.../pulls endpoints', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        headers: {
          get: vi.fn((key: string) => {
            if (key === 'content-type') return 'application/json'
            return null
          })
        },
        json: vi.fn().mockResolvedValue([])
      }
      vi.mocked(githubFetch).mockResolvedValue(mockResponse as any)

      const handler = captureHandler('github:fetch')
      await handler(mockEvent, '/repos/owner/repo/pulls')

      expect(githubFetch).toHaveBeenCalled()
    })

    it('allows GET requests to /repos/.../issues endpoints', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        headers: {
          get: vi.fn((key: string) => {
            if (key === 'content-type') return 'application/json'
            return null
          })
        },
        json: vi.fn().mockResolvedValue([])
      }
      vi.mocked(githubFetch).mockResolvedValue(mockResponse as any)

      const handler = captureHandler('github:fetch')
      await handler(mockEvent, '/repos/owner/repo/issues/123')

      expect(githubFetch).toHaveBeenCalled()
    })

    it('allows POST requests to PR review endpoints', async () => {
      const mockResponse = {
        ok: true,
        status: 201,
        headers: {
          get: vi.fn((key: string) => {
            if (key === 'content-type') return 'application/json'
            return null
          })
        },
        json: vi.fn().mockResolvedValue({})
      }
      vi.mocked(githubFetch).mockResolvedValue(mockResponse as any)

      const handler = captureHandler('github:fetch')
      await handler(mockEvent, '/repos/owner/repo/pulls/42/reviews', { method: 'POST' })

      expect(githubFetch).toHaveBeenCalled()
    })

    it('allows PUT requests to PR merge endpoints', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        headers: {
          get: vi.fn((key: string) => {
            if (key === 'content-type') return 'application/json'
            return null
          })
        },
        json: vi.fn().mockResolvedValue({})
      }
      vi.mocked(githubFetch).mockResolvedValue(mockResponse as any)

      const handler = captureHandler('github:fetch')
      await handler(mockEvent, '/repos/owner/repo/pulls/42/merge', { method: 'PUT' })

      expect(githubFetch).toHaveBeenCalled()
    })

    it('rejects DELETE requests', async () => {
      const handler = captureHandler('github:fetch')
      await expect(
        handler(mockEvent, '/repos/owner/repo', { method: 'DELETE' })
      ).rejects.toThrow('GitHub API request not allowed')

      expect(githubFetch).not.toHaveBeenCalled()
    })

    it('rejects POST to non-allowlisted endpoints', async () => {
      const handler = captureHandler('github:fetch')
      await expect(
        handler(mockEvent, '/repos/owner/repo/collaborators', { method: 'POST' })
      ).rejects.toThrow('GitHub API request not allowed')

      expect(githubFetch).not.toHaveBeenCalled()
    })

    it('rejects requests to admin endpoints', async () => {
      const handler = captureHandler('github:fetch')
      await expect(
        handler(mockEvent, '/admin/users', { method: 'GET' })
      ).rejects.toThrow('GitHub API request not allowed')

      expect(githubFetch).not.toHaveBeenCalled()
    })

    it('rejects requests to delete repo endpoints', async () => {
      const handler = captureHandler('github:fetch')
      await expect(
        handler(mockEvent, '/repos/owner/repo', { method: 'DELETE' })
      ).rejects.toThrow('GitHub API request not allowed')

      expect(githubFetch).not.toHaveBeenCalled()
    })

    it('provides descriptive error message for rejected requests', async () => {
      const handler = captureHandler('github:fetch')
      await expect(
        handler(mockEvent, '/repos/owner/repo/collaborators', { method: 'POST' })
      ).rejects.toThrow(/POST.*\/repos\/owner\/repo\/collaborators/)

      expect(githubFetch).not.toHaveBeenCalled()
    })
  })
})

describe('pr:getList handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns latest PR list when available', () => {
    const payload = {
      prs: [{ id: 1, title: 'PR #1' }],
      checks: { 'sha-abc': { status: 'pass', total: 1, passed: 1, failed: 0, pending: 0 } }
    }
    vi.mocked(getLatestPrList).mockReturnValue(payload as any)

    const handler = captureHandler('pr:getList')
    const result = handler(mockEvent)

    expect(result).toEqual(payload)
  })

  it('returns empty payload when poller has no data yet', () => {
    vi.mocked(getLatestPrList).mockReturnValue(null)

    const handler = captureHandler('pr:getList')
    const result = handler(mockEvent)

    expect(result).toEqual({ prs: [], checks: {} })
  })
})

describe('pr:refreshList handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('delegates to refreshPrList', () => {
    vi.mocked(refreshPrList).mockResolvedValue(undefined as any)

    const handler = captureHandler('pr:refreshList')
    handler(mockEvent)

    expect(refreshPrList).toHaveBeenCalled()
  })
})

describe('pr:pollStatuses handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('marks task done when PR is merged', async () => {
    const prs = [{ taskId: 'task-1', prUrl: 'https://github.com/owner/repo/pull/42' }]
    const results = [{ taskId: 'task-1', merged: true, state: 'MERGED', mergeableState: 'clean' }]

    vi.mocked(pollPrStatuses).mockResolvedValue(results as any)
    vi.mocked(parsePrUrl).mockReturnValue({ owner: 'owner', repo: 'repo', number: 42 } as any)
    vi.mocked(markTaskDoneByPrNumber).mockReturnValue([])
    vi.mocked(updateTaskMergeableState).mockResolvedValue(undefined)

    const handler = captureHandler('pr:pollStatuses')
    const result = await handler(mockEvent, prs)

    expect(markTaskDoneByPrNumber).toHaveBeenCalledWith(42)
    expect(updateTaskMergeableState).toHaveBeenCalledWith(42, 'clean')
    expect(result).toEqual(results)
  })

  it('marks task cancelled when PR is closed without merge', async () => {
    const prs = [{ taskId: 'task-2', prUrl: 'https://github.com/owner/repo/pull/99' }]
    const results = [{ taskId: 'task-2', merged: false, state: 'CLOSED', mergeableState: null }]

    vi.mocked(pollPrStatuses).mockResolvedValue(results as any)
    vi.mocked(parsePrUrl).mockReturnValue({ owner: 'owner', repo: 'repo', number: 99 } as any)
    vi.mocked(markTaskCancelledByPrNumber).mockReturnValue([])
    vi.mocked(updateTaskMergeableState).mockResolvedValue(undefined)

    const handler = captureHandler('pr:pollStatuses')
    const result = await handler(mockEvent, prs)

    expect(markTaskCancelledByPrNumber).toHaveBeenCalledWith(99)
    expect(result).toEqual(results)
  })
})
