import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../ipc-utils', () => ({
  safeHandle: vi.fn()
}))
vi.mock('../../logger', () => ({
  createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }))
}))
vi.mock('../../services/sprint-service', () => ({
  getTask: vi.fn(),
  resetTaskForRetry: vi.fn(),
  notifySprintMutation: vi.fn()
}))
vi.mock('../../services/spec-quality/factory', () => ({
  createSpecQualityService: vi.fn()
}))
vi.mock('../../data/sprint-queries', () => ({
  UPDATE_ALLOWLIST: new Set(['title']),
  getTask: vi.fn(),
  updateTask: vi.fn(),
  listTasksRecent: vi.fn().mockReturnValue([])
}))
vi.mock('../../data/task-group-queries', () => ({
  listGroups: vi.fn().mockReturnValue([])
}))
vi.mock('../../paths', () => ({
  getSpecsRoot: vi.fn().mockReturnValue('/tmp/specs'),
  getRepoPaths: vi.fn().mockReturnValue({ bde: '/tmp/bde' }),
  getRepoPath: vi.fn().mockReturnValue('/tmp/bde')
}))
vi.mock('../../broadcast', () => ({ broadcast: vi.fn(), broadcastCoalesced: vi.fn() }))
vi.mock('../../services/webhook-service', () => ({
  createWebhookService: vi.fn(() => ({ fireWebhook: vi.fn() })),
  getWebhookEventName: vi.fn()
}))
vi.mock('../../data/webhook-queries', () => ({ getWebhooks: vi.fn(() => []) }))
vi.mock('../../settings', () => ({ getSettingJson: vi.fn(), getSetting: vi.fn() }))
vi.mock('../../db', () => ({ getDb: vi.fn().mockReturnValue({}) }))
vi.mock('../../data/agent-queries', () => ({ getAgentLogInfo: vi.fn() }))
vi.mock('../../agent-history', () => ({ readLog: vi.fn(), initAgentHistory: vi.fn() }))
vi.mock('fs/promises', () => ({ readFile: vi.fn() }))
vi.mock('../../git', () => ({ getRepoPaths: vi.fn().mockReturnValue({ bde: '/tmp/bde' }) }))
vi.mock('../../services/dependency-service', async (orig) => {
  const actual = await orig()
  return {
    ...actual,
    createDependencyIndex: vi.fn().mockReturnValue({
      areDependenciesSatisfied: vi.fn().mockReturnValue({ satisfied: true })
    }),
    detectCycle: vi.fn().mockReturnValue(null)
  }
})
vi.mock('../sprint-spec', () => ({
  generatePrompt: vi.fn(),
  validateSpecPath: vi.fn()
}))
vi.mock('../../services/workflow-engine', () => ({
  instantiateWorkflow: vi.fn()
}))
vi.mock('../../data/task-changes', () => ({
  getTaskChanges: vi.fn().mockReturnValue([])
}))
vi.mock('../../data/sprint-task-repository', () => ({
  createSprintTaskRepository: vi.fn()
}))

import { registerSprintLocalHandlers } from '../sprint-local'
import { safeHandle } from '../../ipc-utils'
import { getTask, resetTaskForRetry } from '../../services/sprint-service'

const ACTIVE_TASK = { id: 't1', status: 'active', title: 'Test', repo: 'bde' }

function extractHandler(channel: string): (...args: unknown[]) => Promise<unknown> {
  const call = vi.mocked(safeHandle).mock.calls.find(([ch]) => ch === channel)
  if (!call) throw new Error(`Handler for ${channel} not registered`)
  return call[1] as (...args: unknown[]) => Promise<unknown>
}

describe('sprint:forceReleaseClaim — T-10 agent abort', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls cancelAgent before re-queuing when agent manager is present', async () => {
    vi.mocked(getTask)
      .mockReturnValueOnce(ACTIVE_TASK as never)
      .mockReturnValueOnce({ ...ACTIVE_TASK, status: 'queued' } as never)

    const cancelAgent = vi.fn().mockResolvedValue(undefined)
    const taskStateService = { transition: vi.fn().mockResolvedValue(undefined) }

    registerSprintLocalHandlers({
      onStatusTerminal: vi.fn(),
      dialog: { showSaveDialog: vi.fn(), showOpenDialog: vi.fn() },
      taskStateService: taskStateService as never,
      cancelAgent
    })

    const handler = extractHandler('sprint:forceReleaseClaim')
    await handler(null, 't1')

    expect(cancelAgent).toHaveBeenCalledWith('t1')
    expect(cancelAgent.mock.invocationCallOrder[0]).toBeLessThan(
      (resetTaskForRetry as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]
    )
  })

  it('proceeds without abort when cancelAgent is not provided', async () => {
    vi.mocked(getTask)
      .mockReturnValueOnce(ACTIVE_TASK as never)
      .mockReturnValueOnce({ ...ACTIVE_TASK, status: 'queued' } as never)

    const taskStateService = { transition: vi.fn().mockResolvedValue(undefined) }

    registerSprintLocalHandlers({
      onStatusTerminal: vi.fn(),
      dialog: { showSaveDialog: vi.fn(), showOpenDialog: vi.fn() },
      taskStateService: taskStateService as never
    })

    const handler = extractHandler('sprint:forceReleaseClaim')
    await expect(handler(null, 't1')).resolves.toBeDefined()
    expect(taskStateService.transition).toHaveBeenCalledWith('t1', 'queued', expect.anything())
  })

  it('throws when task is not active', async () => {
    vi.mocked(getTask).mockReturnValue({ ...ACTIVE_TASK, status: 'queued' } as never)

    const taskStateService = { transition: vi.fn() }
    registerSprintLocalHandlers({
      onStatusTerminal: vi.fn(),
      dialog: { showSaveDialog: vi.fn(), showOpenDialog: vi.fn() },
      taskStateService: taskStateService as never
    })

    const handler = extractHandler('sprint:forceReleaseClaim')
    await expect(handler(null, 't1')).rejects.toThrow('only active tasks can be released')
  })

  it('transition routes to queued with cleared fields', async () => {
    vi.mocked(getTask)
      .mockReturnValueOnce(ACTIVE_TASK as never)
      .mockReturnValueOnce({ ...ACTIVE_TASK, status: 'queued' } as never)

    const taskStateService = { transition: vi.fn().mockResolvedValue(undefined) }

    registerSprintLocalHandlers({
      onStatusTerminal: vi.fn(),
      dialog: { showSaveDialog: vi.fn(), showOpenDialog: vi.fn() },
      taskStateService: taskStateService as never
    })

    const handler = extractHandler('sprint:forceReleaseClaim')
    await handler(null, 't1')

    expect(taskStateService.transition).toHaveBeenCalledWith(
      't1',
      'queued',
      expect.objectContaining({
        fields: { notes: null, agent_run_id: null },
        caller: 'sprint:forceReleaseClaim'
      })
    )
  })
})
