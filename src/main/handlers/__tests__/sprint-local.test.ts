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
}))

// Mock agent-queries
vi.mock('../../data/agent-queries', () => ({
  getAgentLogInfo: vi.fn(),
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
import { getAgentLogInfo } from '../../data/agent-queries'
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

  it('registers 11 handlers', () => {
    registerSprintLocalHandlers()
    expect(safeHandle).toHaveBeenCalledTimes(11)
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
    const input = { title: 'New task', repo: 'BDE', status: 'queued' }
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
    const { createDependencyIndex } = await import('../../agent-manager/dependency-index')
    vi.mocked(createDependencyIndex).mockReturnValue({
      areDependenciesSatisfied: vi.fn().mockReturnValue({ satisfied: true }),
    } as any)

    vi.mocked(_getTask).mockResolvedValue({
      id: '1',
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
    expect(_updateTask).toHaveBeenCalledWith('1', { status: 'queued' })
  })

  it('transitions status to blocked when dependencies are unsatisfied', async () => {
    const { createDependencyIndex } = await import('../../agent-manager/dependency-index')
    vi.mocked(createDependencyIndex).mockReturnValue({
      areDependenciesSatisfied: vi.fn().mockReturnValue({ satisfied: false }),
    } as any)

    vi.mocked(_getTask).mockResolvedValue({
      id: '1',
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

    expect(_updateTask).toHaveBeenCalledWith('1', { status: 'blocked' })
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
    vi.mocked(readFile).mockResolvedValue('log line 1\nlog line 2\n' as any)

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
    vi.mocked(readFile).mockResolvedValue('short' as any)

    const handler = captureHandler('sprint:readLog')
    const result = await handler(mockEvent, 'agent-1', 9999)

    expect(result).toEqual({ content: '', status: 'done', nextByte: 9999 })
  })

  it('returns empty content on file read error', async () => {
    vi.mocked(getAgentLogInfo).mockReturnValue({
      logPath: '/tmp/agent-1/output.log',
      status: 'failed',
    } as any)
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'))

    const handler = captureHandler('sprint:readLog')
    const result = await handler(mockEvent, 'agent-1', 0)

    expect(result).toEqual({ content: '', status: 'failed', nextByte: 0 })
  })
})
