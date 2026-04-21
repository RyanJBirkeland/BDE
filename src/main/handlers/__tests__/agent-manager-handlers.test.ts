/**
 * Agent manager handler unit tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'

vi.mock('../../ipc-utils', () => ({
  safeHandle: vi.fn()
}))

// Mock execFile so checkpoint tests can drive git outcomes deterministically.
// Note: agent-manager-handlers wraps this with promisify(), so the mock must
// be a (cmd, args, opts, cb) callback-style function.
const mockExecFile = vi.fn()
vi.mock('node:child_process', () => ({
  execFile: (
    cmd: string,
    args: readonly string[],
    opts: unknown,
    cb: (err: Error | null, result?: { stdout: string; stderr: string }) => void
  ) => mockExecFile(cmd, args, opts, cb)
}))

vi.mock('../../data/sprint-queries', () => ({
  getTask: vi.fn(),
  updateTask: vi.fn(),
  forceUpdateTask: vi.fn(),
  listTasks: vi.fn(),
  listTasksRecent: vi.fn(),
  createTask: vi.fn(),
  deleteTask: vi.fn(),
  claimTask: vi.fn(),
  releaseTask: vi.fn(),
  getQueueStats: vi.fn(),
  getDoneTodayCount: vi.fn(),
  markTaskDoneByPrNumber: vi.fn(),
  markTaskCancelledByPrNumber: vi.fn(),
  listTasksWithOpenPrs: vi.fn(),
  updateTaskMergeableState: vi.fn(),
  getHealthCheckTasks: vi.fn(),
  getQueuedTasks: vi.fn(),
  getTasksWithDependencies: vi.fn(),
  getOrphanedTasks: vi.fn(),
  clearStaleClaimedBy: vi.fn(),
  getActiveTaskCount: vi.fn(),
  getSuccessRateBySpecType: vi.fn(),
  createReviewTaskFromAdhoc: vi.fn(),
  getDailySuccessRate: vi.fn(),
  getFailureReasonBreakdown: vi.fn(),
  UPDATE_ALLOWLIST: new Set(['title', 'status'])
}))

import { registerAgentManagerHandlers } from '../agent-manager-handlers'
import { safeHandle } from '../../ipc-utils'
import { getTask } from '../../data/sprint-queries'

describe('Agent manager handlers', () => {
  const mockEvent = {} as IpcMainInvokeEvent

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('registers all 5 agent-manager channels', () => {
    registerAgentManagerHandlers(undefined)

    expect(safeHandle).toHaveBeenCalledTimes(5)
    expect(safeHandle).toHaveBeenCalledWith('agent-manager:status', expect.any(Function))
    expect(safeHandle).toHaveBeenCalledWith('agent-manager:kill', expect.any(Function))
    expect(safeHandle).toHaveBeenCalledWith('agent-manager:metrics', expect.any(Function))
    expect(safeHandle).toHaveBeenCalledWith('agent-manager:reloadConfig', expect.any(Function))
    expect(safeHandle).toHaveBeenCalledWith('agent-manager:checkpoint', expect.any(Function))
  })

  describe('handler functions', () => {
    function captureHandlers(): Record<string, any> {
      const handlers: Record<string, any> = {}
      vi.mocked(safeHandle).mockImplementation((channel, handler) => {
        handlers[channel] = handler
      })
      registerAgentManagerHandlers(undefined)
      return handlers
    }

    function captureHandlersWithAm(am: any): Record<string, any> {
      const handlers: Record<string, any> = {}
      vi.mocked(safeHandle).mockImplementation((channel, handler) => {
        handlers[channel] = handler
      })
      registerAgentManagerHandlers(am)
      return handlers
    }

    describe('agent-manager:status', () => {
      it('returns running=false when am is undefined', async () => {
        const handlers = captureHandlers()

        const result = await handlers['agent-manager:status'](mockEvent)

        expect(result).toMatchObject({
          running: false,
          shuttingDown: false,
          activeAgents: [],
          concurrency: expect.objectContaining({ maxSlots: 0, activeCount: 0 })
        })
      })

      it('returns status from AgentManager when provided', async () => {
        const mockStatus = {
          running: true,
          concurrency: { maxSlots: 3, activeCount: 1 },
          activeAgents: [{ id: 'agent-1' }]
        }
        const mockAm = {
          getStatus: vi.fn().mockReturnValue(mockStatus)
        }
        const handlers = captureHandlersWithAm(mockAm as any)

        const result = await handlers['agent-manager:status'](mockEvent)

        expect(mockAm.getStatus).toHaveBeenCalledTimes(1)
        expect(result).toBe(mockStatus)
      })
    })

    describe('agent-manager:kill', () => {
      it('returns error when am is undefined', async () => {
        const handlers = captureHandlers()

        const result = await handlers['agent-manager:kill'](mockEvent, 'task-123')

        expect(result).toEqual({ ok: false, error: 'Agent manager not available' })
      })

      it('calls killAgent and returns ok:true when agent manager is provided', async () => {
        const mockKillAgent = vi.fn()
        const mockAm = { killAgent: mockKillAgent }
        const handlers = captureHandlersWithAm(mockAm as any)

        const result = await handlers['agent-manager:kill'](mockEvent, 'task-123')

        expect(mockKillAgent).toHaveBeenCalledWith('task-123')
        expect(result).toEqual({ ok: true })
      })

      it('returns error when killAgent throws', async () => {
        const mockKillAgent = vi.fn().mockImplementation(() => {
          throw new Error('Agent not found')
        })
        const mockAm = { killAgent: mockKillAgent }
        const handlers = captureHandlersWithAm(mockAm as any)

        const result = await handlers['agent-manager:kill'](mockEvent, 'task-123')

        expect(result).toEqual({ ok: false, error: 'Agent not found' })
      })
    })
    describe('agent-manager:checkpoint', () => {
      // Tiny helper: queue an execFile result for the next call.
      function queueExec(result: { stdout: string; stderr?: string } | { error: Error }): void {
        mockExecFile.mockImplementationOnce((_cmd, _args, _opts, cb) => {
          if ('error' in result) {
            cb(result.error)
          } else {
            cb(null, { stdout: result.stdout, stderr: result.stderr ?? '' })
          }
        })
      }

      beforeEach(() => {
        mockExecFile.mockReset()
        vi.mocked(getTask).mockReset()
      })

      it('returns error when task has no worktree', async () => {
        vi.mocked(getTask).mockReturnValue({
          id: 'task-1',
          worktree_path: null
        } as never)
        const handlers = captureHandlers()

        const result = await handlers['agent-manager:checkpoint'](mockEvent, 'task-1')

        expect(result).toEqual({
          ok: false,
          committed: false,
          error: expect.stringMatching(/no worktree/i)
        })
        expect(mockExecFile).not.toHaveBeenCalled()
      })

      it('returns committed=false when nothing to commit', async () => {
        vi.mocked(getTask).mockReturnValue({
          id: 'task-1',
          worktree_path: '/tmp/wt'
        } as never)
        // git add -A
        queueExec({ stdout: '' })
        // git diff --cached --name-only → empty
        queueExec({ stdout: '' })

        const handlers = captureHandlers()
        const result = await handlers['agent-manager:checkpoint'](mockEvent, 'task-1')

        expect(result).toEqual({
          ok: true,
          committed: false,
          error: 'Nothing to commit'
        })
      })

      it('returns committed=true on successful commit', async () => {
        vi.mocked(getTask).mockReturnValue({
          id: 'task-1',
          worktree_path: '/tmp/wt'
        } as never)
        // git add -A
        queueExec({ stdout: '' })
        // git diff --cached --name-only → some file
        queueExec({ stdout: 'src/foo.ts\n' })
        // git commit
        queueExec({ stdout: '[main abc123] checkpoint' })

        const handlers = captureHandlers()
        const result = await handlers['agent-manager:checkpoint'](mockEvent, 'task-1', 'wip')

        expect(result).toEqual({ ok: true, committed: true })
        // Verify the commit message was passed through.
        const commitCall = mockExecFile.mock.calls.find((c) => c[1][0] === 'commit')
        expect(commitCall).toBeDefined()
        expect(commitCall![1]).toEqual(['commit', '-m', 'wip'])
      })

      it('returns friendly message when git reports index.lock', async () => {
        vi.mocked(getTask).mockReturnValue({
          id: 'task-1',
          worktree_path: '/tmp/wt'
        } as never)
        // git add -A fails with index.lock
        queueExec({
          error: new Error('fatal: Unable to create /tmp/wt/.git/index.lock: File exists.')
        })

        const handlers = captureHandlers()
        const result = await handlers['agent-manager:checkpoint'](mockEvent, 'task-1')

        expect(result).toEqual({
          ok: false,
          committed: false,
          error: 'Agent is currently writing — try again in a moment'
        })
      })
    })

    describe('agent-manager:kill — task ID validation', () => {
      it('rejects a path-traversal task ID', async () => {
        const handlers = captureHandlers()
        const result = await handlers['agent-manager:kill'](mockEvent, '../../etc/passwd')
        expect(result).toEqual({ ok: false, error: 'Invalid task ID format' })
      })

      it('accepts a valid ULID-style task ID', async () => {
        const mockKillAgent = vi.fn()
        const mockAm = { killAgent: mockKillAgent }
        const handlers = captureHandlersWithAm(mockAm as any)
        const result = await handlers['agent-manager:kill'](mockEvent, '01HXXXXXXXXXXXXXXXXXXXXXXX')
        expect(result).toEqual({ ok: true })
      })
    })

    describe('agent-manager:checkpoint — task ID validation', () => {
      it('rejects a path-traversal task ID', async () => {
        const handlers = captureHandlers()
        const result = await handlers['agent-manager:checkpoint'](mockEvent, '../../etc/passwd')
        expect(result).toEqual({ ok: false, committed: false, error: 'Invalid task ID format' })
      })

      it('accepts a valid ULID-style task ID', async () => {
        vi.mocked(getTask).mockReturnValue({
          id: '01HXXXXXXXXXXXXXXXXXXXXXXX',
          worktree_path: '/tmp/wt'
        } as never)
        queueExec({ stdout: '' }) // git add
        queueExec({ stdout: '' }) // git diff --cached (nothing staged)
        const handlers = captureHandlers()
        const result = await handlers['agent-manager:checkpoint'](
          mockEvent,
          '01HXXXXXXXXXXXXXXXXXXXXXXX'
        )
        expect(result.ok).toBe(true)
      })

      function queueExec(result: { stdout: string; stderr?: string } | { error: Error }): void {
        mockExecFile.mockImplementationOnce(
          (
            _cmd: string,
            _args: string[],
            _opts: unknown,
            cb: (err: Error | null, result?: { stdout: string; stderr: string }) => void
          ) => {
            if ('error' in result) cb(result.error)
            else cb(null, { stdout: result.stdout, stderr: result.stderr ?? '' })
          }
        )
      }
    })

    describe('agent-manager:metrics', () => {
      it('returns null when am is undefined', async () => {
        const handlers = captureHandlers()
        const result = await handlers['agent-manager:metrics'](mockEvent)
        expect(result).toBeNull()
      })

      it('calls getMetrics and returns snapshot when agent manager is provided', async () => {
        const mockSnapshot = {
          drainLoopCount: 5,
          agentsSpawned: 3,
          agentsCompleted: 2,
          agentsFailed: 1,
          retriesQueued: 0,
          watchdogVerdicts: {},
          lastDrainDurationMs: 42,
          uptimeMs: 1000
        }
        const mockAm = { getMetrics: vi.fn().mockReturnValue(mockSnapshot) }
        const handlers = captureHandlersWithAm(mockAm as any)
        const result = await handlers['agent-manager:metrics'](mockEvent)
        expect(mockAm.getMetrics).toHaveBeenCalledTimes(1)
        expect(result).toBe(mockSnapshot)
      })
    })
  })
})
