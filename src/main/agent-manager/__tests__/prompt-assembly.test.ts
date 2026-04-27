import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DEFAULT_CONFIG } from '../types'
import { PipelineAbortError } from '../pipeline-abort-error'

vi.mock('../../lib/prompt-composer', () => ({
  buildAgentPrompt: vi.fn((input) => `prompt:${input.taskContent}:${input.branch}`)
}))

vi.mock('../worktree', () => ({
  cleanupWorktree: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    mkdirSync: vi.fn(),
    readFileSync: vi.fn().mockImplementation(() => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    })
  }
})

vi.mock('../../paths', () => ({
  BDE_TASK_MEMORY_DIR: '/home/.bde/memory/tasks'
}))

import {
  validateTaskForRun,
  assembleRunContext,
  fetchUpstreamContext,
  readPriorScratchpad
} from '../prompt-assembly'
import type { RunAgentDeps, AgentRunClaim } from '../run-agent'
import type { IAgentTaskRepository } from '../../data/sprint-task-repository'
import { mkdirSync, readFileSync } from 'node:fs'
import { buildAgentPrompt } from '../../lib/prompt-composer'

const mockRepo: IAgentTaskRepository = {
  getTask: vi.fn(),
  updateTask: vi.fn(),
  getQueuedTasks: vi.fn(),
  getTasksWithDependencies: vi.fn().mockReturnValue([]),
  getOrphanedTasks: vi.fn(),
  clearStaleClaimedBy: vi.fn(),
  getActiveTaskCount: vi.fn(),
  claimTask: vi.fn(),
  getGroup: vi.fn().mockReturnValue(null),
  getGroupTasks: vi.fn().mockReturnValue([]),
  getGroupsWithDependencies: vi.fn().mockReturnValue([])
}

function makeTask(overrides: Partial<AgentRunClaim> = {}): AgentRunClaim {
  return {
    id: 'task-1',
    title: 'Test task',
    prompt: 'Do something',
    spec: null,
    repo: 'bde',
    retry_count: 0,
    fast_fail_count: 0,
    ...overrides
  }
}

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}

function makeDeps(overrides: Partial<RunAgentDeps> = {}): RunAgentDeps {
  return {
    activeAgents: new Map(),
    defaultModel: DEFAULT_CONFIG.defaultModel,
    logger: makeLogger(),
    onTaskTerminal: vi.fn().mockResolvedValue(undefined),
    repo: mockRepo,
    unitOfWork: { runInTransaction: (fn) => fn() },
    metrics: { increment: vi.fn(), recordWatchdogVerdict: vi.fn(), setLastDrainDuration: vi.fn(), recordAgentDuration: vi.fn(), snapshot: vi.fn().mockReturnValue({}), reset: vi.fn() },
    ...overrides
  }
}

const worktree = { worktreePath: '/tmp/wt', branch: 'agent/test-1' }
const repoPath = '/repo'

describe('validateTaskForRun', () => {
  beforeEach(() => vi.clearAllMocks())

  it('does not throw when task has prompt', async () => {
    await expect(
      validateTaskForRun(makeTask({ prompt: 'Do it' }), worktree, repoPath, makeDeps())
    ).resolves.toBeUndefined()
  })

  it('does not throw when task has spec', async () => {
    await expect(
      validateTaskForRun(
        makeTask({ prompt: null, spec: '## Spec\nDo it' }),
        worktree,
        repoPath,
        makeDeps()
      )
    ).resolves.toBeUndefined()
  })

  it('does not throw when task has only title', async () => {
    await expect(
      validateTaskForRun(
        makeTask({ prompt: null, spec: null, title: 'Title only' }),
        worktree,
        repoPath,
        makeDeps()
      )
    ).resolves.toBeUndefined()
  })

  it('throws PipelineAbortError and marks error when task has no content', async () => {
    const deps = makeDeps()
    const task = makeTask({ prompt: null, spec: null, title: '' })
    await expect(validateTaskForRun(task, worktree, repoPath, deps)).rejects.toThrow(
      PipelineAbortError
    )
    await expect(validateTaskForRun(task, worktree, repoPath, deps)).rejects.toThrow(
      'Task has no content'
    )
    expect(mockRepo.updateTask).toHaveBeenCalledWith(
      'task-1',
      expect.objectContaining({ status: 'error' })
    )
    expect(deps.onTaskTerminal).toHaveBeenCalledWith('task-1', 'error')
  })

  it('logs error when task has no content', async () => {
    const deps = makeDeps()
    const task = makeTask({ prompt: '  ', spec: '  ', title: '  ' })
    await expect(validateTaskForRun(task, worktree, repoPath, deps)).rejects.toThrow()
    expect(deps.logger.error).toHaveBeenCalledWith(
      expect.stringContaining('has no prompt/spec/title')
    )
  })
})

describe('fetchUpstreamContext', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns empty array when deps is null', () => {
    const logger = makeLogger()
    expect(fetchUpstreamContext(null, mockRepo, logger)).toEqual([])
  })

  it('returns empty array when deps is empty', () => {
    const logger = makeLogger()
    expect(fetchUpstreamContext([], mockRepo, logger)).toEqual([])
  })

  it('returns spec for done upstream tasks', () => {
    const logger = makeLogger()
    vi.mocked(mockRepo.getTask).mockReturnValue({
      id: 'upstream-1',
      status: 'done',
      spec: '## Spec\nDetails',
      prompt: null,
      title: 'Upstream',
      partial_diff: null
    } as Parameters<typeof mockRepo.getTask>[0] extends string
      ? ReturnType<typeof mockRepo.getTask>
      : never)
    const result = fetchUpstreamContext([{ id: 'upstream-1', type: 'hard' }], mockRepo, logger)
    expect(result).toHaveLength(1)
    expect(result[0].spec).toBe('## Spec\nDetails')
  })

  it('skips non-done upstream tasks', () => {
    const logger = makeLogger()
    vi.mocked(mockRepo.getTask).mockReturnValue({
      id: 'upstream-1',
      status: 'active',
      spec: '## Spec',
      prompt: null,
      title: 'Upstream'
    } as Parameters<typeof mockRepo.getTask>[0] extends string
      ? ReturnType<typeof mockRepo.getTask>
      : never)
    const result = fetchUpstreamContext([{ id: 'upstream-1', type: 'hard' }], mockRepo, logger)
    expect(result).toHaveLength(0)
  })

  it('logs warning on error fetching upstream task', () => {
    const logger = makeLogger()
    vi.mocked(mockRepo.getTask).mockImplementation(() => {
      throw new Error('DB error')
    })
    const result = fetchUpstreamContext([{ id: 'upstream-1', type: 'hard' }], mockRepo, logger)
    expect(result).toHaveLength(0)
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to fetch upstream task')
    )
  })
})

describe('readPriorScratchpad', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns empty string when progress.md does not exist', () => {
    vi.mocked(readFileSync).mockImplementation(() => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    })
    expect(readPriorScratchpad('task-1')).toBe('')
  })

  it('returns content when progress.md exists', () => {
    vi.mocked(readFileSync).mockReturnValue('Prior progress content')
    expect(readPriorScratchpad('task-1')).toBe('Prior progress content')
  })

  it('calls mkdirSync to ensure directory exists', () => {
    readPriorScratchpad('task-abc')
    expect(mkdirSync).toHaveBeenCalledWith(expect.stringContaining('task-abc'), { recursive: true })
  })
})

describe('assembleRunContext', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls buildAgentPrompt with pipeline type', async () => {
    vi.mocked(readFileSync).mockImplementation(() => {
      throw new Error('ENOENT')
    })
    const deps = makeDeps()
    await assembleRunContext(makeTask(), worktree, deps)
    expect(buildAgentPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ agentType: 'pipeline' })
    )
  })

  it('includes branch in prompt', async () => {
    vi.mocked(readFileSync).mockImplementation(() => {
      throw new Error('ENOENT')
    })
    const deps = makeDeps()
    const result = await assembleRunContext(makeTask(), worktree, deps)
    expect(result).toContain('agent/test-1')
  })

  it('uses task prompt as taskContent', async () => {
    vi.mocked(readFileSync).mockImplementation(() => {
      throw new Error('ENOENT')
    })
    const deps = makeDeps()
    const result = await assembleRunContext(makeTask({ prompt: 'My task prompt' }), worktree, deps)
    expect(result).toContain('My task prompt')
  })
})
