import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.mock calls are hoisted — they intercept imports inside the module under test.
// Do NOT mock the module under test itself; just mock its dependencies.
vi.mock('../lib/resolve-dependents', () => ({
  resolveDependents: vi.fn()
}))

vi.mock('../settings', () => ({
  getSetting: vi.fn().mockReturnValue(false)
}))

vi.mock('../logger', () => ({
  createLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    event: vi.fn()
  })
}))

import { handleTaskTerminal } from '../agent-manager/terminal-handler'
import { resolveDependents } from '../lib/resolve-dependents'
import type { TerminalHandlerDeps } from '../agent-manager/terminal-handler'
import type { IAgentTaskRepository } from '../data/sprint-task-repository'
import type { DependencyIndex } from '../services/dependency-service'
import type { EpicDependencyIndex } from '../services/epic-dependency-service'
import type { MetricsCollector } from '../agent-manager/metrics'
import type { AgentManagerConfig } from '../agent-manager/types'

function makeRepo(overrides: Partial<IAgentTaskRepository> = {}): IAgentTaskRepository {
  return {
    getTask: vi.fn().mockReturnValue(null),
    updateTask: vi.fn().mockResolvedValue(null),
    claimTask: vi.fn().mockResolvedValue(null),
    getQueuedTasks: vi.fn().mockReturnValue([]),
    getTasksWithDependencies: vi.fn().mockReturnValue([]),
    getGroup: vi.fn().mockReturnValue(null),
    getGroupTasks: vi.fn().mockReturnValue([]),
    ...overrides
  } as unknown as IAgentTaskRepository
}

function makeDeps(repo: IAgentTaskRepository): TerminalHandlerDeps {
  return {
    metrics: { increment: vi.fn(), setLastDrainDuration: vi.fn() } as unknown as MetricsCollector,
    depIndex: {
      rebuild: vi.fn(),
      getBlockedBy: vi.fn().mockReturnValue([])
    } as unknown as DependencyIndex,
    epicIndex: {} as unknown as EpicDependencyIndex,
    repo,
    unitOfWork: { runInTransaction: (fn) => fn() },
    config: {} as AgentManagerConfig,
    terminalCalled: new Map(),
    logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), event: vi.fn() } as any
  }
}

describe('handleTaskTerminal — dep resolution failure', () => {
  beforeEach(() => {
    vi.mocked(resolveDependents).mockReset()
  })

  it('updates task notes when resolveDependents throws', async () => {
    const repo = makeRepo()
    vi.mocked(resolveDependents).mockImplementation(() => {
      throw new Error('DB locked')
    })

    await handleTaskTerminal('task-1', 'done', async () => {}, makeDeps(repo))

    expect(repo.updateTask).toHaveBeenCalledWith(
      'task-1',
      expect.objectContaining({
        notes: expect.stringContaining('DB locked')
      })
    )
  })

  it('does not throw when repo.updateTask also fails', async () => {
    const repo = makeRepo({
      updateTask: vi.fn().mockRejectedValue(new Error('write failed'))
    })
    vi.mocked(resolveDependents).mockImplementation(() => {
      throw new Error('dep error')
    })

    // Should not throw — double catch
    await expect(
      handleTaskTerminal('task-1', 'done', async () => {}, makeDeps(repo))
    ).resolves.toBeUndefined()
  })
})
