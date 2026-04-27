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
  notifySprintMutation: vi.fn(),
  forceReleaseClaim: vi.fn()
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
import { forceReleaseClaim } from '../../services/sprint-service'

function extractHandler(channel: string): (...args: unknown[]) => Promise<unknown> {
  const call = vi.mocked(safeHandle).mock.calls.find(([ch]) => ch === channel)
  if (!call) throw new Error(`Handler for ${channel} not registered`)
  return call[1] as (...args: unknown[]) => Promise<unknown>
}

function registerWithDeps(extra: Record<string, unknown> = {}) {
  const taskStateService = { transition: vi.fn().mockResolvedValue(undefined) }
  registerSprintLocalHandlers({
    onStatusTerminal: vi.fn(),
    dialog: { showSaveDialog: vi.fn(), showOpenDialog: vi.fn() },
    taskStateService: taskStateService as never,
    ...extra
  })
  return { taskStateService }
}

describe('sprint:forceReleaseClaim handler — thin delegation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('delegates to forceReleaseClaim with the task ID and deps', async () => {
    const releasedTask = { id: 't1', status: 'queued' }
    vi.mocked(forceReleaseClaim).mockResolvedValue(releasedTask as never)
    registerWithDeps()

    const handler = extractHandler('sprint:forceReleaseClaim')
    const result = await handler(null, 't1')

    expect(forceReleaseClaim).toHaveBeenCalledWith('t1', expect.objectContaining({
      taskStateService: expect.any(Object)
    }))
    expect(result).toBe(releasedTask)
  })

  it('passes cancelAgent through to forceReleaseClaim', async () => {
    const cancelAgent = vi.fn()
    vi.mocked(forceReleaseClaim).mockResolvedValue({ id: 't1', status: 'queued' } as never)
    registerWithDeps({ cancelAgent })

    const handler = extractHandler('sprint:forceReleaseClaim')
    await handler(null, 't1')

    expect(forceReleaseClaim).toHaveBeenCalledWith('t1', expect.objectContaining({ cancelAgent }))
  })

  it('rejects invalid task ID before calling forceReleaseClaim', async () => {
    registerWithDeps()
    const handler = extractHandler('sprint:forceReleaseClaim')
    await expect(handler(null, '../../etc/passwd')).rejects.toThrow('Invalid task ID format')
    expect(forceReleaseClaim).not.toHaveBeenCalled()
  })

  it('throws when task is not active', async () => {
    vi.mocked(forceReleaseClaim).mockRejectedValue(new Error('Cannot force-release a task with status queued — only active tasks can be released'))
    registerWithDeps()

    const handler = extractHandler('sprint:forceReleaseClaim')
    await expect(handler(null, 't1')).rejects.toThrow('only active tasks can be released')
  })
})
