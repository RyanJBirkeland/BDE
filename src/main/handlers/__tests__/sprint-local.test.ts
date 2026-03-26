/**
 * Sprint local handler unit tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'

// Mock ipc-utils — must come before handler import
vi.mock('../../ipc-utils', () => ({
  safeHandle: vi.fn(),
}))

// Mock sprint-queries (Supabase data layer)
vi.mock('../../data/sprint-queries', () => ({
  UPDATE_ALLOWLIST: new Set(['title', 'status', 'prompt', 'spec', 'notes']),
  getTask: vi.fn(),
  listTasks: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  deleteTask: vi.fn(),
  claimTask: vi.fn(),
  releaseTask: vi.fn(),
  getQueueStats: vi.fn(),
  getDoneTodayCount: vi.fn(),
  markTaskDoneByPrNumber: vi.fn(),
  markTaskCancelledByPrNumber: vi.fn(),
  listTasksWithOpenPrs: vi.fn(),
  updateTaskMergeableState: vi.fn(),
  clearSprintTaskFk: vi.fn(),
  getHealthCheckTasks: vi.fn(),
}))

// Mock sprint-listeners (SSE broadcaster)
vi.mock('../sprint-listeners', () => ({
  notifySprintMutation: vi.fn(),
  onSprintMutation: vi.fn(),
  sseBroadcaster: { broadcast: vi.fn() },
}))

// Mock sprint-spec
vi.mock('../sprint-spec', () => ({
  generatePrompt: vi.fn(),
  buildQuickSpecPrompt: vi.fn(),
  getTemplateScaffold: vi.fn(),
}))

// Mock settings
vi.mock('../../settings', () => ({
  getSettingJson: vi.fn(),
  getSetting: vi.fn(),
}))

// Mock db
vi.mock('../../db', () => ({
  getDb: vi.fn().mockReturnValue({}),
}))

// Mock paths
vi.mock('../../paths', () => ({
  getSpecsRoot: vi.fn().mockReturnValue('/tmp/specs'),
  BDE_DIR: '/tmp/bde',
  BDE_AGENTS_INDEX: '/tmp/agents-index.json',
  BDE_AGENT_LOGS_DIR: '/tmp/agent-logs',
}))

// Mock agent-queries
vi.mock('../../data/agent-queries', () => ({
  getAgentLogInfo: vi.fn(),
  getAgentLogPath: vi.fn(),
}))

// Mock agent-history (readLog uses file handles internally, mock at module level)
vi.mock('../../agent-history', () => ({
  readLog: vi.fn(),
  initAgentHistory: vi.fn(),
}))

// Mock fs/promises (used in sprint:readLog)
vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
}))

// Mock dependency-index (used lazily inside sprint:update and sprint:validateDependencies)
vi.mock('../../agent-manager/dependency-index', () => ({
  createDependencyIndex: vi.fn().mockReturnValue({
    areDependenciesSatisfied: vi.fn().mockReturnValue({ satisfied: true }),
  }),
  detectCycle: vi.fn().mockReturnValue(null),
}))

// Mock queue-api/router (needed by sprint-listeners)
vi.mock('../../queue-api/router', () => ({
  sseBroadcaster: { broadcast: vi.fn() },
}))

// Mock spec-semantic-check
const mockCheckSpecSemantic = vi.fn().mockResolvedValue({
  passed: true,
  hasFails: false,
  hasWarns: false,
  results: {},
  failMessages: [],
  warnMessages: [],
})
vi.mock('../../spec-semantic-check', () => ({
  checkSpecSemantic: (...args: unknown[]) => mockCheckSpecSemantic(...args),
}))

import { registerSprintLocalHandlers } from '../sprint-local'
import { safeHandle } from '../../ipc-utils'
import {
  listTasks as _listTasks,
  createTask as _createTask,
  updateTask as _updateTask,
  deleteTask as _deleteTask,
  getTask as _getTask,
  claimTask as _claimTask,
  getHealthCheckTasks as _getHealthCheckTasks,
} from '../../data/sprint-queries'
import { notifySprintMutation } from '../sprint-listeners'
import { getSettingJson } from '../../settings'
import { getAgentLogInfo, getAgentLogPath } from '../../data/agent-queries'
import { readLog } from '../../agent-history'
import { readFile } from 'fs/promises'

const mockEvent = {} as IpcMainInvokeEvent

/** Helper: capture handler registered for a given channel */
function captureHandler(channel: string): (...args: any[]) => any {
  let captured: ((...args: any[]) => any) | undefined

  vi.mocked(safeHandle).mockImplementation((ch, handler) => {
    if (ch === channel) captured = handler as (...args: any[]) => any
  })

  registerSprintLocalHandlers()

  if (!captured) throw new Error(`No handler captured for channel "${channel}"`)
  return captured
}

describe('registerSprintLocalHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('registers 13 handlers', () => {
    registerSprintLocalHandlers()
    expect(safeHandle).toHaveBeenCalledTimes(13)
  })

  it('registers the expected channel names', () => {
    registerSprintLocalHandlers()
    const channels = vi.mocked(safeHandle).mock.calls.map(([ch]) => ch)
    expect(channels).toContain('sprint:list')
    expect(channels).toContain('sprint:create')
    expect(channels).toContain('sprint:update')
    expect(channels).toContain('sprint:delete')
    expect(channels).toContain('sprint:claimTask')
    expect(channels).toContain('sprint:healthCheck')
    expect(channels).toContain('sprint:readLog')
    expect(channels).toContain('sprint:validateDependencies')
    expect(channels).toContain('sprint:unblockTask')
    expect(channels).toContain('sprint:getChanges')
    expect(channels).toContain('sprint:batchUpdate')
  })
})

describe('sprint:list handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns tasks from listTasks', async () => {
    const tasks = [{ id: '1', title: 'Task A', status: 'queued' }]
    vi.mocked(_listTasks).mockResolvedValue(tasks as any)

    const handler = captureHandler('sprint:list')
    const result = await handler(mockEvent)

    expect(_listTasks).toHaveBeenCalled()
    expect(result).toEqual(tasks)
  })

  it('returns empty array when no tasks', async () => {
    vi.mocked(_listTasks).mockResolvedValue([])

    const handler = captureHandler('sprint:list')
    const result = await handler(mockEvent)

    expect(result).toEqual([])
  })
})

describe('sprint:create handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates a task and fires mutation notification', async () => {
    const validSpec = `${'x'.repeat(60)}\n## Problem\nBroken\n## Solution\nFix it`
    const input = { title: 'New task', repo: 'BDE', status: 'queued', spec: validSpec }
    const created = { id: 'abc', ...input }
    vi.mocked(_createTask).mockResolvedValue(created as any)

    const handler = captureHandler('sprint:create')
    const result = await handler(mockEvent, input)

    expect(_createTask).toHaveBeenCalledWith(input)
    expect(notifySprintMutation).toHaveBeenCalledWith('created', created)
    expect(result).toEqual(created)
  })
})

describe('sprint:update handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('updates a task and returns the updated row', async () => {
    const updated = { id: '1', title: 'Updated', status: 'backlog' }
    vi.mocked(_getTask).mockResolvedValue({ id: '1', title: 'Original', status: 'backlog', depends_on: null } as any)
    vi.mocked(_updateTask).mockResolvedValue(updated as any)

    const handler = captureHandler('sprint:update')
    const result = await handler(mockEvent, '1', { title: 'Updated' })

    expect(_updateTask).toHaveBeenCalledWith('1', { title: 'Updated' })
    expect(notifySprintMutation).toHaveBeenCalledWith('updated', updated)
    expect(result).toEqual(updated)
  })

  it('leaves status as queued when dependencies are satisfied', async () => {
    const validSpec = `${'x'.repeat(60)}\n## Problem\nBroken\n## Solution\nFix it`
    const { createDependencyIndex } = await import('../../agent-manager/dependency-index')
    vi.mocked(createDependencyIndex).mockReturnValue({
      areDependenciesSatisfied: vi.fn().mockReturnValue({ satisfied: true }),
    } as any)

    vi.mocked(_getTask).mockResolvedValue({
      id: '1',
      title: 'Task 1',
      repo: 'bde',
      spec: validSpec,
      status: 'backlog',
      depends_on: [{ id: 'dep1', type: 'hard' }],
    } as any)
    vi.mocked(_listTasks).mockResolvedValue([
      { id: '1', status: 'backlog', depends_on: [] },
      { id: 'dep1', status: 'done', depends_on: [] },
    ] as any)
    vi.mocked(_updateTask).mockResolvedValue({ id: '1', status: 'queued' } as any)

    const handler = captureHandler('sprint:update')
    await handler(mockEvent, '1', { status: 'queued' })

    // Since deps are satisfied, patch should not be changed to blocked
    expect(_updateTask).toHaveBeenCalledWith('1', { status: 'queued', needs_review: false })
  })

  it('transitions status to blocked when dependencies are unsatisfied', async () => {
    const validSpec = `${'x'.repeat(60)}\n## Problem\nBroken\n## Solution\nFix it`
    const { createDependencyIndex } = await import('../../agent-manager/dependency-index')
    vi.mocked(createDependencyIndex).mockReturnValue({
      areDependenciesSatisfied: vi.fn().mockReturnValue({ satisfied: false, blockedBy: ['dep1'] }),
    } as any)

    vi.mocked(_getTask).mockResolvedValue({
      id: '1',
      title: 'Task 1',
      repo: 'bde',
      spec: validSpec,
      status: 'backlog',
      depends_on: [{ id: 'dep1', type: 'hard' }],
    } as any)
    vi.mocked(_listTasks).mockResolvedValue([
      { id: '1', status: 'backlog', depends_on: [] },
      { id: 'dep1', status: 'queued', depends_on: [] },
    ] as any)
    vi.mocked(_updateTask).mockResolvedValue({ id: '1', status: 'blocked' } as any)

    const handler = captureHandler('sprint:update')
    await handler(mockEvent, '1', { status: 'queued' })

    expect(_updateTask).toHaveBeenCalledWith('1', expect.objectContaining({ status: 'blocked' }))
  })
})

describe('sprint:delete handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('deletes the task and fires deleted mutation notification', async () => {
    const task = { id: '1', title: 'To delete', status: 'backlog' }
    vi.mocked(_getTask).mockResolvedValue(task as any)
    vi.mocked(_deleteTask).mockResolvedValue(undefined)

    const handler = captureHandler('sprint:delete')
    const result = await handler(mockEvent, '1')

    expect(_deleteTask).toHaveBeenCalledWith('1')
    expect(notifySprintMutation).toHaveBeenCalledWith('deleted', task)
    expect(result).toEqual({ ok: true })
  })

  it('still returns ok when task not found before delete', async () => {
    vi.mocked(_getTask).mockResolvedValue(null)
    vi.mocked(_deleteTask).mockResolvedValue(undefined)

    const handler = captureHandler('sprint:delete')
    const result = await handler(mockEvent, 'nonexistent')

    expect(_deleteTask).toHaveBeenCalledWith('nonexistent')
    expect(notifySprintMutation).not.toHaveBeenCalled()
    expect(result).toEqual({ ok: true })
  })
})

describe('sprint:claimTask handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null when task not found', async () => {
    vi.mocked(_getTask).mockResolvedValue(null)

    const handler = captureHandler('sprint:claimTask')
    const result = await handler(mockEvent, 'nonexistent')

    expect(result).toBeNull()
  })

  it('returns task with null templatePromptPrefix when no template', async () => {
    const task = { id: '1', title: 'Task', status: 'queued', template_name: null }
    vi.mocked(_getTask).mockResolvedValue(task as any)

    const handler = captureHandler('sprint:claimTask')
    const result = await handler(mockEvent, '1')

    expect(result).toMatchObject({ id: '1', templatePromptPrefix: null })
  })

  it('returns templatePromptPrefix from matching template', async () => {
    const task = { id: '1', title: 'Task', status: 'queued', template_name: 'bugfix' }
    vi.mocked(_getTask).mockResolvedValue(task as any)
    vi.mocked(getSettingJson).mockReturnValue([
      { name: 'bugfix', promptPrefix: 'Fix the bug:' },
      { name: 'feature', promptPrefix: 'Add feature:' },
    ] as any)

    const handler = captureHandler('sprint:claimTask')
    const result = await handler(mockEvent, '1')

    expect(result).toMatchObject({ id: '1', templatePromptPrefix: 'Fix the bug:' })
  })

  it('returns null prefix when template_name does not match any template', async () => {
    const task = { id: '1', title: 'Task', status: 'queued', template_name: 'unknown' }
    vi.mocked(_getTask).mockResolvedValue(task as any)
    vi.mocked(getSettingJson).mockReturnValue([
      { name: 'bugfix', promptPrefix: 'Fix the bug:' },
    ] as any)

    const handler = captureHandler('sprint:claimTask')
    const result = await handler(mockEvent, '1')

    expect(result).toMatchObject({ id: '1', templatePromptPrefix: null })
  })
})

describe('sprint:healthCheck handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns results from getHealthCheckTasks', async () => {
    const tasks = [{ id: '1', status: 'failed' }]
    vi.mocked(_getHealthCheckTasks).mockResolvedValue(tasks as any)

    const handler = captureHandler('sprint:healthCheck')
    const result = await handler(mockEvent)

    expect(_getHealthCheckTasks).toHaveBeenCalled()
    expect(result).toEqual(tasks)
  })
})

describe('sprint:readLog handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns unknown status when agent not found', async () => {
    vi.mocked(getAgentLogInfo).mockReturnValue(null)

    const handler = captureHandler('sprint:readLog')
    const result = await handler(mockEvent, 'agent-1')

    expect(result).toEqual({ content: '', status: 'unknown', nextByte: 0 })
  })

  it('returns log content from file when agent exists', async () => {
    vi.mocked(getAgentLogInfo).mockReturnValue({
      logPath: '/tmp/agent-1/output.log',
      status: 'active',
    } as any)
    const logContent = 'log line 1\nlog line 2\n'
    vi.mocked(readLog).mockResolvedValue({
      content: logContent,
      nextByte: logContent.length,
      totalBytes: logContent.length,
    })

    const handler = captureHandler('sprint:readLog')
    const result = await handler(mockEvent, 'agent-1', 0)

    expect(result.content).toBe('log line 1\nlog line 2\n')
    expect(result.status).toBe('active')
    expect(result.nextByte).toBeGreaterThan(0)
  })

  it('returns empty content when fromByte >= log length', async () => {
    vi.mocked(getAgentLogInfo).mockReturnValue({
      logPath: '/tmp/agent-1/output.log',
      status: 'done',
    } as any)
    vi.mocked(readLog).mockResolvedValue({
      content: '',
      nextByte: 9999,
      totalBytes: 5,
    })

    const handler = captureHandler('sprint:readLog')
    const result = await handler(mockEvent, 'agent-1', 9999)

    expect(result).toEqual({ content: '', status: 'done', nextByte: 9999 })
  })

  it('returns empty content on file read error', async () => {
    vi.mocked(getAgentLogInfo).mockReturnValue({
      logPath: '/tmp/agent-1/output.log',
      status: 'failed',
    } as any)
    vi.mocked(readLog).mockResolvedValue({
      content: '',
      nextByte: 0,
      totalBytes: 0,
    })

    const handler = captureHandler('sprint:readLog')
    const result = await handler(mockEvent, 'agent-1', 0)

    expect(result).toEqual({ content: '', status: 'failed', nextByte: 0 })
  })
})

// -------------------------------------------------------------------------
// Spec quality guardrail tests
// -------------------------------------------------------------------------

describe('sprint:create spec validation', () => {
  const validSpec = `${'x'.repeat(60)}\n## Problem\nBroken\n## Solution\nFix it`

  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckSpecSemantic.mockResolvedValue({
      passed: true, hasFails: false, hasWarns: false,
      results: {}, failMessages: [], warnMessages: [],
    })
  })

  it('succeeds for backlog task with empty spec', async () => {
    vi.mocked(_createTask).mockResolvedValue({ id: 'new-1', title: 'Fix', repo: 'bde', status: 'backlog' } as any)

    const handler = captureHandler('sprint:create')
    const result = await handler(mockEvent, { title: 'Fix', repo: 'bde' })

    expect(result.id).toBe('new-1')
  })

  it('succeeds for backlog task with title and repo', async () => {
    vi.mocked(_createTask).mockResolvedValue({ id: 'new-1', title: 'Fix', repo: 'bde', status: 'backlog' } as any)

    const handler = captureHandler('sprint:create')
    const result = await handler(mockEvent, { title: 'Fix', repo: 'bde', status: 'backlog' })

    expect(result.id).toBe('new-1')
  })

  it('rejects non-backlog task with no spec', async () => {
    const handler = captureHandler('sprint:create')

    await expect(handler(mockEvent, { title: 'Fix', repo: 'bde', status: 'queued' }))
      .rejects.toThrow(/spec is required/)
  })

  it('rejects task with empty title', async () => {
    const handler = captureHandler('sprint:create')

    await expect(handler(mockEvent, { title: '', repo: 'bde', spec: validSpec }))
      .rejects.toThrow(/title is required/)
  })
})

describe('sprint:update spec validation on queue transition', () => {
  const validSpec = `${'x'.repeat(60)}\n## Problem\nBroken\n## Solution\nFix it`

  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckSpecSemantic.mockResolvedValue({
      passed: true, hasFails: false, hasWarns: false,
      results: {}, failMessages: [], warnMessages: [],
    })
  })

  it('throws when transitioning to queued with bad spec', async () => {
    vi.mocked(_getTask).mockResolvedValue({
      id: 'abc', title: 'Test', repo: 'bde', spec: 'too short', status: 'backlog',
    } as any)

    const handler = captureHandler('sprint:update')
    await expect(handler(mockEvent, 'abc', { status: 'queued' }))
      .rejects.toThrow(/spec quality checks failed/)
  })

  it('succeeds when transitioning to queued with valid spec and semantic pass', async () => {
    vi.mocked(_getTask).mockResolvedValue({
      id: 'abc', title: 'Test', repo: 'bde', spec: validSpec, status: 'backlog',
    } as any)
    vi.mocked(_updateTask).mockResolvedValue({ id: 'abc', status: 'queued' } as any)

    const handler = captureHandler('sprint:update')
    const result = await handler(mockEvent, 'abc', { status: 'queued' })
    expect(result).toEqual({ id: 'abc', status: 'queued' })
  })

  it('does NOT trigger validation for non-queued transitions', async () => {
    vi.mocked(_updateTask).mockResolvedValue({ id: 'abc', status: 'done' } as any)

    const handler = captureHandler('sprint:update')
    await handler(mockEvent, 'abc', { status: 'done' })

    expect(_getTask).not.toHaveBeenCalled()
    expect(mockCheckSpecSemantic).not.toHaveBeenCalled()
  })

  it('throws when semantic check fails', async () => {
    vi.mocked(_getTask).mockResolvedValue({
      id: 'abc', title: 'Test', repo: 'bde', spec: validSpec, status: 'backlog',
    } as any)
    mockCheckSpecSemantic.mockResolvedValue({
      passed: false, hasFails: true, hasWarns: false,
      results: {}, failMessages: ['clarity: Too vague'], warnMessages: [],
    })

    const handler = captureHandler('sprint:update')
    await expect(handler(mockEvent, 'abc', { status: 'queued' }))
      .rejects.toThrow(/semantic checks failed/)
  })
})
