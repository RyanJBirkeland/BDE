/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, existsSync: vi.fn() }
})
vi.mock('../../logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })
}))
vi.mock('../../env-utils', () => ({
  buildAgentEnv: vi.fn(() => ({ PATH: '/usr/bin' }))
}))
vi.mock('../../lib/async-utils', () => ({
  execFileAsync: vi.fn()
}))
vi.mock('../../agent-history', () => ({
  getAgentMeta: vi.fn(),
  setAgentSprintTaskId: vi.fn()
}))
vi.mock('../sprint-service', () => ({
  createReviewTaskFromAdhoc: vi.fn()
}))

import { existsSync } from 'node:fs'
import { execFileAsync } from '../../lib/async-utils'
import { getAgentMeta, setAgentSprintTaskId } from '../../agent-history'
import { createReviewTaskFromAdhoc } from '../sprint-service'
import { promoteAdhocToTask } from '../adhoc-promotion-service'
import type { AgentMeta } from '../../../shared/types'

const mockExistsSync = vi.mocked(existsSync)
const mockExecFileAsync = vi.mocked(execFileAsync)
const mockGetAgentMeta = vi.mocked(getAgentMeta)
const mockCreateReviewTask = vi.mocked(createReviewTaskFromAdhoc)
const mockSetAgentSprintTaskId = vi.mocked(setAgentSprintTaskId)

function makeAgent(overrides: Partial<AgentMeta> = {}): AgentMeta {
  return {
    id: 'agent-1',
    task: 'Implement feature X',
    status: 'done',
    worktreePath: '/tmp/worktree',
    branch: 'adhoc/feature-x',
    repo: 'fleet',
    logPath: '/tmp/agent.log',
    sprintTaskId: null,
    agentType: 'adhoc',
    createdAt: '2026-04-22T00:00:00Z',
    updatedAt: '2026-04-22T00:00:00Z',
    sessionId: null,
    ...overrides
  } as AgentMeta
}

beforeEach(() => {
  vi.clearAllMocks()
  mockExistsSync.mockReturnValue(true)
  mockExecFileAsync.mockResolvedValue({ stdout: '2\n', stderr: '' })
  mockGetAgentMeta.mockResolvedValue(makeAgent())
  mockCreateReviewTask.mockReturnValue({ id: 'task-abc' } as ReturnType<
    typeof createReviewTaskFromAdhoc
  >)
})

describe('promoteAdhocToTask', () => {
  describe('agent not found', () => {
    it('returns error when agent does not exist', async () => {
      mockGetAgentMeta.mockResolvedValue(null)

      const result = await promoteAdhocToTask('missing-agent')

      expect(result).toEqual({ ok: false, error: 'Agent missing-agent not found' })
    })
  })

  describe('idempotency', () => {
    it('returns existing taskId without creating a new task when already promoted', async () => {
      mockGetAgentMeta.mockResolvedValue(makeAgent({ sprintTaskId: 'existing-task-id' }))

      const result = await promoteAdhocToTask('agent-1')

      expect(result).toEqual({ ok: true, taskId: 'existing-task-id' })
      expect(mockCreateReviewTask).not.toHaveBeenCalled()
    })
  })

  describe('precondition checks', () => {
    it('returns error when agent has no worktree path', async () => {
      mockGetAgentMeta.mockResolvedValue(makeAgent({ worktreePath: undefined }))

      const result = await promoteAdhocToTask('agent-1')

      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/no worktree/)
    })

    it('returns error when worktree path does not exist on disk', async () => {
      mockExistsSync.mockReturnValue(false)

      const result = await promoteAdhocToTask('agent-1')

      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/no longer exists/)
    })

    it('returns error when agent has no branch recorded', async () => {
      mockGetAgentMeta.mockResolvedValue(makeAgent({ branch: undefined }))

      const result = await promoteAdhocToTask('agent-1')

      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/no branch/)
    })

    it('returns error when agent has no commits beyond main', async () => {
      mockExecFileAsync.mockResolvedValue({ stdout: '0\n', stderr: '' })

      const result = await promoteAdhocToTask('agent-1')

      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/not committed any work/)
    })
  })

  describe('successful promotion', () => {
    it('creates a review task and returns its id', async () => {
      const result = await promoteAdhocToTask('agent-1')

      expect(mockCreateReviewTask).toHaveBeenCalledWith(
        expect.objectContaining({ branch: 'adhoc/feature-x', repo: 'fleet' })
      )
      expect(result).toEqual({ ok: true, taskId: 'task-abc' })
    })

    it('accepts trigger option without affecting the result shape', async () => {
      const result = await promoteAdhocToTask('agent-1', { trigger: 'tool' })

      expect(result).toEqual({ ok: true, taskId: 'task-abc' })
    })

    it('returns error when createReviewTaskFromAdhoc returns null', async () => {
      mockCreateReviewTask.mockReturnValue(null)

      const result = await promoteAdhocToTask('agent-1')

      expect(result).toEqual({ ok: false, error: 'Failed to create review task — see logs' })
    })
  })

  describe('sprintTaskId writeback', () => {
    it('writes taskId back to agent_runs after a successful fresh promotion', async () => {
      const result = await promoteAdhocToTask('agent-1')

      expect(result).toEqual({ ok: true, taskId: 'task-abc' })
      expect(mockSetAgentSprintTaskId).toHaveBeenCalledWith('agent-1', 'task-abc')
    })

    it('does not write taskId on the idempotency short-circuit path', async () => {
      mockGetAgentMeta.mockResolvedValue(makeAgent({ sprintTaskId: 'existing-task-id' }))

      await promoteAdhocToTask('agent-1')

      expect(mockSetAgentSprintTaskId).not.toHaveBeenCalled()
    })

    it('does not write taskId when createReviewTaskFromAdhoc fails', async () => {
      mockCreateReviewTask.mockReturnValue(null)

      await promoteAdhocToTask('agent-1')

      expect(mockSetAgentSprintTaskId).not.toHaveBeenCalled()
    })
  })

  describe('autoCommitIfDirty', () => {
    it('runs git add -A and git commit when no commits, dirty tree, and autoCommitIfDirty is true', async () => {
      mockExecFileAsync
        .mockResolvedValueOnce({ stdout: '0\n', stderr: '' })
        .mockResolvedValueOnce({ stdout: 'M src/foo.ts\n', stderr: '' })
        .mockResolvedValueOnce({ stdout: '', stderr: '' })
        .mockResolvedValueOnce({ stdout: '[adhoc 1234abc] chore: capture\n', stderr: '' })
        .mockResolvedValueOnce({ stdout: '1\n', stderr: '' })

      const result = await promoteAdhocToTask('agent-1', { autoCommitIfDirty: true })

      const calls = mockExecFileAsync.mock.calls
      expect(calls[1][1]).toEqual(['status', '--porcelain'])
      expect(calls[2][1]).toEqual(['add', '-A'])
      expect(calls[3][1]).toContain('commit')
      expect(calls[3][1]).toContain('-m')
      expect(result).toEqual({ ok: true, taskId: 'task-abc' })
    })

    it('returns error when no commits, clean tree, and autoCommitIfDirty is true', async () => {
      mockExecFileAsync
        .mockResolvedValueOnce({ stdout: '0\n', stderr: '' })
        .mockResolvedValueOnce({ stdout: '', stderr: '' })

      const result = await promoteAdhocToTask('agent-1', { autoCommitIfDirty: true })

      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/nothing to promote/i)
      expect(mockCreateReviewTask).not.toHaveBeenCalled()
    })

    it('skips auto-commit path when commits already exist even if autoCommitIfDirty is true', async () => {
      const callsBefore = mockExecFileAsync.mock.calls.length

      const result = await promoteAdhocToTask('agent-1', { autoCommitIfDirty: true })

      const newCalls = mockExecFileAsync.mock.calls.slice(callsBefore)
      expect(newCalls).toHaveLength(1)
      expect(newCalls[0][1]).toEqual(expect.arrayContaining(['rev-list']))
      expect(result).toEqual({ ok: true, taskId: 'task-abc' })
    })
  })
})
