/**
 * Verifies that git operations in the completion path propagate timeout errors
 * rather than hanging indefinitely when a git subprocess stalls.
 *
 * The test mocks execFileAsync to simulate a timeout (ETIMEDOUT) and asserts
 * that the error surfaces through the completion path rather than being swallowed.
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

vi.mock('../../data/sprint-queries', () => ({
  updateTask: vi.fn(),
  forceUpdateTask: vi.fn()
}))

vi.mock('../../env-utils', () => ({
  buildAgentEnv: vi.fn().mockReturnValue({})
}))

import { execFile } from 'node:child_process'
import { updateTask } from '../../data/sprint-queries'
import { resolveSuccess } from '../completion'
import type { IAgentTaskRepository } from '../../data/sprint-task-repository'

const execFileMock = vi.mocked(execFile)
const updateTaskMock = vi.mocked(updateTask)

function getCustomMock(): ReturnType<typeof vi.fn> {
  return (execFileMock as unknown as Record<symbol, ReturnType<typeof vi.fn>>)[promisify.custom]
}

const noopLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), event: vi.fn() }

const stubTask = {
  id: 'task-timeout',
  title: 'Timeout test task',
  repo: 'bde',
  prompt: null,
  priority: 1,
  status: 'queued' as const,
  notes: null,
  spec: null,
  spec_type: 'feature',
  retry_count: 0,
  fast_fail_count: 0,
  agent_run_id: null,
  pr_number: null,
  pr_status: null as null,
  pr_url: null,
  claimed_by: null,
  started_at: null,
  completed_at: null,
  template_name: null,
  depends_on: null,
  updated_at: '2026-01-01T00:00:00.000Z',
  created_at: '2026-01-01T00:00:00.000Z'
}

const TERMINAL_STATUSES = new Set(['done', 'cancelled', 'failed', 'error'])

const mockOnTaskTerminal = vi.fn().mockResolvedValue(undefined)

const mockTaskStateService = {
  transition: vi.fn(async (taskId: string, status: string, ctx?: { fields?: Record<string, unknown> }) => {
    updateTaskMock(taskId, { status, ...(ctx?.fields ?? {}) })
    if (TERMINAL_STATUSES.has(status)) {
      await mockOnTaskTerminal(taskId, status)
    }
  })
}

const mockRepo: IAgentTaskRepository = {
  getTask: vi.fn().mockReturnValue(stubTask),
  updateTask: (...args: [string, Record<string, unknown>]) => (updateTask as any)(...args),
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

const opts = {
  taskId: 'task-timeout',
  worktreePath: '/tmp/worktrees/task-timeout',
  title: 'Timeout test task',
  ghRepo: 'owner/repo',
  onTaskTerminal: mockOnTaskTerminal,
  retryCount: 0,
  repo: mockRepo,
  unitOfWork: { runInTransaction: (fn: () => void) => fn() },
  taskStateService: mockTaskStateService as unknown as import('../../../services/task-state-service').TaskStateService
}

beforeEach(() => {
  getCustomMock().mockReset()
  updateTaskMock.mockReset()
  updateTaskMock.mockReturnValue(null)
  vi.mocked(mockRepo.getTask).mockReturnValue(stubTask)
  mockOnTaskTerminal.mockReset()
  mockOnTaskTerminal.mockResolvedValue(undefined)
  mockTaskStateService.transition.mockReset()
  mockTaskStateService.transition.mockImplementation(
    async (taskId: string, status: string, ctx?: { fields?: Record<string, unknown> }) => {
      updateTaskMock(taskId, { status, ...(ctx?.fields ?? {}) })
      if (TERMINAL_STATUSES.has(status)) {
        await mockOnTaskTerminal(taskId, status)
      }
    }
  )
})

describe('git timeout propagation', () => {
  it('surfaces a timeout error from git branch detection through the completion path', async () => {
    const timeoutError = Object.assign(new Error('Command timed out'), { code: 'ETIMEDOUT', killed: true })

    // The first git call (rev-parse --abbrev-ref HEAD) times out
    getCustomMock().mockRejectedValueOnce(timeoutError)

    await resolveSuccess(opts, noopLogger)

    // The timeout error propagates: task transitions to error status
    expect(updateTaskMock).toHaveBeenCalledWith(
      'task-timeout',
      expect.objectContaining({ status: 'error' })
    )
    expect(mockOnTaskTerminal).toHaveBeenCalledWith('task-timeout', 'error')
  })
})
