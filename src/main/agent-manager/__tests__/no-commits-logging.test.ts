/**
 * Tests that the no-commits path logs uncommitted diff and status, and that
 * the task is requeued with the canonical NO_COMMITS_NOTE message.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { promisify } from 'node:util'

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, existsSync: vi.fn(() => true) }
})

vi.mock('node:child_process', () => {
  const execFile = vi.fn() as ReturnType<typeof vi.fn> & { [k: symbol]: unknown }
  execFile[promisify.custom] = vi.fn()
  return { execFile }
})

vi.mock('../../broadcast', () => ({
  broadcast: vi.fn(),
  broadcastCoalesced: vi.fn()
}))

vi.mock('../../env-utils', () => ({
  buildAgentEnv: vi.fn().mockReturnValue({})
}))

import { execFile } from 'node:child_process'
import { hasCommitsAheadOfMain } from '../resolve-success-phases'
import { NO_COMMITS_NOTE } from '../failure-messages'
import type { IAgentTaskRepository } from '../../data/sprint-task-repository'

const execFileMock = vi.mocked(execFile)

function getCustomMock(): ReturnType<typeof vi.fn> {
  return (execFileMock as unknown as Record<symbol, ReturnType<typeof vi.fn>>)[promisify.custom]
}

function mockExecFileSequence(responses: Array<{ stdout?: string; error?: Error }>) {
  let callIndex = 0
  getCustomMock().mockImplementation((..._args: unknown[]) => {
    const resp = responses[callIndex] ?? { stdout: '' }
    callIndex++
    if (resp.error) return Promise.reject(resp.error)
    return Promise.resolve({ stdout: resp.stdout ?? '', stderr: '' })
  })
}

const mockRepo: IAgentTaskRepository = {
  getTask: vi.fn().mockReturnValue(null),
  updateTask: vi.fn().mockReturnValue(null),
  getQueuedTasks: vi.fn(),
  getTasksWithDependencies: vi.fn().mockReturnValue([]),
  getOrphanedTasks: vi.fn(),
  clearStaleClaimedBy: vi.fn().mockReturnValue(0),
  getActiveTaskCount: vi.fn().mockReturnValue(0),
  claimTask: vi.fn(),
  getGroup: vi.fn().mockReturnValue(null),
  getGroupTasks: vi.fn().mockReturnValue([]),
  getGroupsWithDependencies: vi.fn().mockReturnValue([])
}

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), event: vi.fn() }
}

describe('hasCommitsAheadOfMain — no-commits path', () => {
  beforeEach(() => {
    getCustomMock().mockReset()
    vi.mocked(mockRepo.updateTask).mockReset()
    vi.mocked(mockRepo.updateTask).mockReturnValue(null)
    vi.mocked(mockRepo.getTask).mockReset()
    vi.mocked(mockRepo.getTask).mockReturnValue(null)
  })

  it('logs uncommitted diff and status when agent exited without commits', async () => {
    const logger = makeLogger()

    mockExecFileSequence([
      { stdout: '0\n' }, // git rev-list --count (no commits)
      { stdout: '--- a/src/foo.ts\n+++ b/src/foo.ts\n@@ -1 +1 @@\n-old\n+new\n' }, // git diff HEAD
      { stdout: 'M  src/foo.ts\n' } // git status --porcelain
    ])

    const result = await hasCommitsAheadOfMain({
      taskId: 'task-1',
      branch: 'agent/t-1-test-abcdef12',
      worktreePath: '/tmp/wt',
      agentSummary: null,
      retryCount: 0,
      repo: mockRepo,
      logger,
      onTaskTerminal: vi.fn().mockResolvedValue(undefined),
      resolveFailure: vi.fn().mockReturnValue(false)
    })

    expect(result).toBe(false)

    const warnCalls: string[] = logger.warn.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(warnCalls.some((msg) => msg.includes('no-commits — uncommitted status'))).toBe(true)
    expect(warnCalls.some((msg) => msg.includes('no-commits — uncommitted diff'))).toBe(true)
    expect(warnCalls.some((msg) => msg.includes('src/foo.ts'))).toBe(true)
  })

  it('requeues task with NO_COMMITS_NOTE when agent produced no commits', async () => {
    const logger = makeLogger()
    const resolveFailure = vi.fn().mockReturnValue(false)

    mockExecFileSequence([
      { stdout: '0\n' }, // git rev-list --count
      { stdout: '' }, // git diff HEAD (empty)
      { stdout: '' } // git status --porcelain (empty)
    ])

    await hasCommitsAheadOfMain({
      taskId: 'task-2',
      branch: 'agent/t-2-test-abcdef12',
      worktreePath: '/tmp/wt',
      agentSummary: null,
      retryCount: 0,
      repo: mockRepo,
      logger,
      onTaskTerminal: vi.fn().mockResolvedValue(undefined),
      resolveFailure
    })

    const [notesArg] = resolveFailure.mock.calls[0] as [{ notes?: string }]
    expect(notesArg.notes).toBe(NO_COMMITS_NOTE)
  })

  it('includes agent summary in notes alongside NO_COMMITS_NOTE', async () => {
    const logger = makeLogger()
    const resolveFailure = vi.fn().mockReturnValue(false)

    mockExecFileSequence([
      { stdout: '0\n' }, // git rev-list --count
      { stdout: '' }, // git diff HEAD
      { stdout: '' } // git status --porcelain
    ])

    await hasCommitsAheadOfMain({
      taskId: 'task-3',
      branch: 'agent/t-3-test-abcdef12',
      worktreePath: '/tmp/wt',
      agentSummary: 'I ran out of turns',
      retryCount: 0,
      repo: mockRepo,
      logger,
      onTaskTerminal: vi.fn().mockResolvedValue(undefined),
      resolveFailure
    })

    const [notesArg] = resolveFailure.mock.calls[0] as [{ notes?: string }]
    expect(notesArg.notes).toContain(NO_COMMITS_NOTE)
    expect(notesArg.notes).toContain('I ran out of turns')
  })

  it('returns true and does not log when commits exist', async () => {
    const logger = makeLogger()

    mockExecFileSequence([
      { stdout: '3\n' } // git rev-list --count (3 commits ahead)
    ])

    const result = await hasCommitsAheadOfMain({
      taskId: 'task-4',
      branch: 'agent/t-4-test-abcdef12',
      worktreePath: '/tmp/wt',
      agentSummary: null,
      retryCount: 0,
      repo: mockRepo,
      logger,
      onTaskTerminal: vi.fn().mockResolvedValue(undefined),
      resolveFailure: vi.fn().mockReturnValue(false)
    })

    expect(result).toBe(true)
    expect(logger.warn).not.toHaveBeenCalled()
  })
})
