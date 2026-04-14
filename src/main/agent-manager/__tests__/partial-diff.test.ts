/**
 * Tests for partial diff capture on agent failure.
 * Verifies that git diff is captured and stored before worktree cleanup.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { promisify } from 'node:util'
import { capturePartialDiff, classifyDiffCaptureError } from '../partial-diff-capture'
import type { IAgentTaskRepository } from '../../data/sprint-task-repository'

// Mock node:child_process before importing module under test
vi.mock('node:child_process', () => {
  const execFile = vi.fn() as ReturnType<typeof vi.fn> & { [k: symbol]: unknown }
  execFile[promisify.custom] = vi.fn()
  return { execFile }
})

// Mock broadcast (required by run-agent imports)
vi.mock('../../broadcast', () => ({
  broadcast: vi.fn()
}))

// Mock agent-history (required by run-agent imports)
vi.mock('../../agent-history', () => ({
  createAgentRecord: vi.fn(),
  updateAgentMeta: vi.fn()
}))

// Mock paths (required by run-agent imports)
vi.mock('../../paths', () => ({
  getGhRepo: vi.fn().mockReturnValue('owner/repo')
}))

// Mock worktree (required by run-agent imports)
vi.mock('../worktree', () => ({
  cleanupWorktree: vi.fn()
}))

// Mock sdk-adapter (required by run-agent imports)
vi.mock('../sdk-adapter', () => ({
  spawnAgent: vi.fn()
}))

// Mock prompt-composer (required by run-agent imports)
vi.mock('../../lib/prompt-composer', () => ({
  buildAgentPrompt: vi.fn().mockReturnValue('mock prompt')
}))

// Mock completion (required by run-agent imports)
vi.mock('../completion', () => ({
  resolveSuccess: vi.fn(),
  resolveFailure: vi.fn()
}))

// Mock fast-fail (required by run-agent imports)
vi.mock('../fast-fail', () => ({
  classifyExit: vi.fn()
}))

// Mock agent-event-mapper (required by run-agent imports)
vi.mock('../agent-event-mapper', () => ({
  mapRawMessage: vi.fn(),
  emitAgentEvent: vi.fn()
}))

import { execFile } from 'node:child_process'

const execFileMock = vi.mocked(execFile)

function getCustomMock(): ReturnType<typeof vi.fn> {
  return (execFileMock as unknown as Record<symbol, ReturnType<typeof vi.fn>>)[promisify.custom]
}

const noopLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
}

const mockRepo: IAgentTaskRepository = {
  getTask: vi.fn(),
  updateTask: vi.fn(),
  getQueuedTasks: vi.fn(),
  getTasksWithDependencies: vi.fn(),
  getOrphanedTasks: vi.fn(),
  clearStaleClaimedBy: vi.fn().mockReturnValue(0),
  getActiveTaskCount: vi.fn(),
  claimTask: vi.fn(),
  getGroup: vi.fn().mockReturnValue(null),
  getGroupTasks: vi.fn().mockReturnValue([]),
  getGroupsWithDependencies: vi.fn().mockReturnValue([])
}

describe('classifyDiffCaptureError', () => {
  it('classifies ENOENT as git-missing', () => {
    const err = Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' })
    expect(classifyDiffCaptureError(err)).toBe('git-missing')
  })

  it('classifies bad revision as no-head', () => {
    expect(classifyDiffCaptureError(new Error("fatal: bad revision 'HEAD'"))).toBe('no-head')
  })

  it('classifies not a git repository as not-a-repo', () => {
    expect(classifyDiffCaptureError(new Error('fatal: not a git repository'))).toBe('not-a-repo')
  })

  it('classifies maxBuffer as max-buffer', () => {
    expect(classifyDiffCaptureError(new Error('stdout maxBuffer length exceeded'))).toBe(
      'max-buffer'
    )
  })

  it('classifies unknown errors as unknown', () => {
    expect(classifyDiffCaptureError(new Error('some other failure'))).toBe('unknown')
  })
})

describe('capturePartialDiff', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('captures and stores non-empty diff', async () => {
    const diff = `diff --git a/src/file.ts b/src/file.ts
index abc123..def456 100644
--- a/src/file.ts
+++ b/src/file.ts
@@ -1,3 +1,4 @@
 export function hello() {
+  console.log('world')
   return 'hello'
 }
`

    getCustomMock().mockResolvedValueOnce({ stdout: diff, stderr: '' })

    await capturePartialDiff('task-1', '/tmp/worktrees/task-1', mockRepo, noopLogger)

    expect(mockRepo.updateTask).toHaveBeenCalledWith('task-1', {
      partial_diff: diff
    })
    expect(noopLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('Captured partial diff for task task-1')
    )
  })

  it('does not call updateTask when diff is empty', async () => {
    getCustomMock().mockResolvedValueOnce({ stdout: '', stderr: '' })

    await capturePartialDiff('task-2', '/tmp/worktrees/task-2', mockRepo, noopLogger)

    expect(mockRepo.updateTask).not.toHaveBeenCalled()
  })

  it('does not call updateTask when diff is only whitespace', async () => {
    getCustomMock().mockResolvedValueOnce({ stdout: '   \n  \n ', stderr: '' })

    await capturePartialDiff('task-3', '/tmp/worktrees/task-3', mockRepo, noopLogger)

    expect(mockRepo.updateTask).not.toHaveBeenCalled()
  })

  it('truncates diff at 50KB and adds truncation notice', async () => {
    const largeChunk = 'a'.repeat(1024) // 1KB
    const largeDiff = largeChunk.repeat(60) // 60KB

    getCustomMock().mockResolvedValueOnce({ stdout: largeDiff, stderr: '' })

    await capturePartialDiff('task-4', '/tmp/worktrees/task-4', mockRepo, noopLogger)

    const MAX_SIZE = 50 * 1024
    expect(mockRepo.updateTask).toHaveBeenCalledWith('task-4', {
      partial_diff: largeDiff.slice(0, MAX_SIZE) + '\n\n[... diff truncated at 50KB]'
    })
    expect(noopLogger.info).toHaveBeenCalledWith(expect.stringContaining('truncated'))
  })

  it('logs ENOENT errors at error level', async () => {
    const enoentError = Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' })
    getCustomMock().mockRejectedValueOnce(enoentError)

    await capturePartialDiff('task-5', '/tmp/worktrees/task-5', mockRepo, noopLogger)

    expect(mockRepo.updateTask).not.toHaveBeenCalled()
    expect(noopLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('git binary not found on PATH')
    )
    expect(noopLogger.warn).not.toHaveBeenCalled()
  })

  it('logs non-ENOENT errors at warn level', async () => {
    getCustomMock().mockRejectedValueOnce(new Error('fatal: not a git repository'))

    await capturePartialDiff('task-5b', '/tmp/worktrees/task-5b', mockRepo, noopLogger)

    expect(mockRepo.updateTask).not.toHaveBeenCalled()
    expect(noopLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to capture partial diff')
    )
    expect(noopLogger.error).not.toHaveBeenCalled()
  })

  it('calls git diff HEAD with correct cwd', async () => {
    getCustomMock().mockResolvedValueOnce({ stdout: 'diff content', stderr: '' })

    await capturePartialDiff('task-6', '/worktree/path', mockRepo, noopLogger)

    const calls = getCustomMock().mock.calls
    expect(calls[0][0]).toBe('git')
    expect(calls[0][1]).toEqual(['diff', 'HEAD'])
    expect(calls[0][2]).toMatchObject({
      cwd: '/worktree/path',
      maxBuffer: 50 * 1024
    })
  })

  it('handles updateTask failure gracefully', async () => {
    getCustomMock().mockResolvedValueOnce({ stdout: 'diff', stderr: '' })
    vi.mocked(mockRepo.updateTask).mockImplementationOnce(() => {
      throw new Error('DB error')
    })

    await capturePartialDiff('task-7', '/tmp/worktrees/task-7', mockRepo, noopLogger)

    expect(noopLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to capture partial diff')
    )
  })
})
