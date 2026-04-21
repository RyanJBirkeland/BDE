/**
 * Sprint local handler unit tests
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'

// Mock ipc-utils — must come before handler import
vi.mock('../../ipc-utils', () => ({
  safeHandle: vi.fn()
}))

// Mock electron (for BrowserWindow used by broadcast)
vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => [{ webContents: { send: vi.fn() } }])
  }
}))

// Mock broadcast
vi.mock('../../broadcast', () => ({
  broadcast: vi.fn(),
  broadcastCoalesced: vi.fn()
}))

// Mock webhook-service
vi.mock('../../services/webhook-service', () => ({
  createWebhookService: vi.fn(() => ({
    fireWebhook: vi.fn()
  })),
  getWebhookEventName: vi.fn((type, _task) => `sprint.task.${type}`)
}))

// Mock webhook-queries
vi.mock('../../data/webhook-queries', () => ({
  getWebhooks: vi.fn(() => [])
}))

// Mock logger
vi.mock('../../logger', () => ({
  createLogger: vi.fn(() => ({
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn()
  }))
}))

// Mock sprint-queries (data layer)
vi.mock('../../data/sprint-queries', () => ({
  UPDATE_ALLOWLIST: new Set(['title', 'status', 'prompt', 'spec', 'notes']),
  getTask: vi.fn(),
  listTasks: vi.fn(),
  listTasksRecent: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  forceUpdateTask: vi.fn(),
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
  // Additional methods needed by ISprintTaskRepository
  getQueuedTasks: vi.fn(),
  getTasksWithDependencies: vi.fn(),
  getOrphanedTasks: vi.fn(),
  clearStaleClaimedBy: vi.fn(),
  getActiveTaskCount: vi.fn(),
  getSuccessRateBySpecType: vi.fn(),
  createReviewTaskFromAdhoc: vi.fn(),
  getDailySuccessRate: vi.fn(),
  getFailureReasonBreakdown: vi.fn()
}))

// Mock sprint-spec
vi.mock('../sprint-spec', () => ({
  generatePrompt: vi.fn(),
  buildQuickSpecPrompt: vi.fn(),
  getTemplateScaffold: vi.fn()
}))

// Mock settings
vi.mock('../../settings', () => ({
  getSettingJson: vi.fn(),
  getSetting: vi.fn()
}))

// Mock db
vi.mock('../../db', () => ({
  getDb: vi.fn().mockReturnValue({})
}))

// Mock paths
vi.mock('../../paths', () => ({
  getSpecsRoot: vi.fn().mockReturnValue('/tmp/specs'),
  BDE_DIR: '/tmp/bde',
  BDE_AGENTS_INDEX: '/tmp/agents-index.json',
  BDE_AGENT_LOGS_DIR: '/tmp/agent-logs'
}))

// Mock agent-queries
vi.mock('../../data/agent-queries', () => ({
  getAgentLogInfo: vi.fn(),
  getAgentLogPath: vi.fn()
}))

// Mock agent-history (readLog uses file handles internally, mock at module level)
vi.mock('../../agent-history', () => ({
  readLog: vi.fn(),
  initAgentHistory: vi.fn()
}))

// Mock fs/promises (used in sprint:readLog)
vi.mock('fs/promises', () => ({
  readFile: vi.fn()
}))

// Mock git (getRepoPaths used by sprint:create repo-existence check)
vi.mock('../../git', () => ({
  getRepoPaths: vi.fn(() => ({ bde: '/Users/ryan/projects/BDE' }))
}))

// Mock dependency-index (used lazily inside sprint:update and sprint:validateDependencies)
vi.mock('../../services/dependency-service', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    createDependencyIndex: vi.fn().mockReturnValue({
      areDependenciesSatisfied: vi.fn().mockReturnValue({ satisfied: true })
    }),
    detectCycle: vi.fn().mockReturnValue(null)
  }
})

// Mock spec-quality factory
const mockValidateFull = vi.fn().mockResolvedValue({
  valid: true,
  issues: [],
  errors: [],
  warnings: [],
  prescriptivenessChecked: true
})
vi.mock('../../services/spec-quality/factory', () => ({
  createSpecQualityService: () => ({
    validateStructural: vi.fn().mockReturnValue({
      valid: true,
      issues: [],
      errors: [],
      warnings: [],
      prescriptivenessChecked: false
    }),
    validateFull: (...args: unknown[]) => mockValidateFull(...args)
  })
}))

import { registerSprintLocalHandlers } from '../sprint-local'
import { safeHandle } from '../../ipc-utils'
import {
  listTasks as _listTasks,
  listTasksRecent as _listTasksRecent,
  createTask as _createTask,
  updateTask as _updateTask,
  deleteTask as _deleteTask,
  getTask as _getTask,
  claimTask as _claimTask,
  getHealthCheckTasks as _getHealthCheckTasks
} from '../../data/sprint-queries'
import { broadcast } from '../../broadcast'
import { getSettingJson } from '../../settings'
import { getAgentLogInfo } from '../../data/agent-queries'
import { readLog } from '../../agent-history'
import { getRepoPaths as _getRepoPaths } from '../../git'

const mockEvent = {} as IpcMainInvokeEvent

/** Helper: capture handler registered for a given channel */
function captureHandler(channel: string): (...args: any[]) => any {
  let captured: ((...args: any[]) => any) | undefined

  vi.mocked(safeHandle).mockImplementation((ch, handler) => {
    if (ch === channel) captured = handler as (...args: any[]) => any
  })

  const mockDeps = {
    onStatusTerminal: vi.fn(),
    dialog: {
      showSaveDialog: vi.fn(),
      showOpenDialog: vi.fn()
    }
  }
  registerSprintLocalHandlers(mockDeps)

  if (!captured) throw new Error(`No handler captured for channel "${channel}"`)
  return captured
}

describe('registerSprintLocalHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('registers 17 handlers', () => {
    const mockDeps = {
      onStatusTerminal: vi.fn(),
      dialog: { showSaveDialog: vi.fn(), showOpenDialog: vi.fn() }
    }
    registerSprintLocalHandlers(mockDeps)
    expect(safeHandle).toHaveBeenCalledTimes(17)
  })

  it('registers the expected channel names', () => {
    const mockDeps = {
      onStatusTerminal: vi.fn(),
      dialog: { showSaveDialog: vi.fn(), showOpenDialog: vi.fn() }
    }
    registerSprintLocalHandlers(mockDeps)
    const channels = vi.mocked(safeHandle).mock.calls.map(([ch]) => ch)
    expect(channels).toContain('sprint:list')
    expect(channels).toContain('sprint:create')
    expect(channels).toContain('sprint:createWorkflow')
    expect(channels).toContain('sprint:update')
    expect(channels).toContain('sprint:delete')
    expect(channels).toContain('sprint:readSpecFile')
    expect(channels).toContain('sprint:generatePrompt')
    expect(channels).toContain('sprint:claimTask')
    expect(channels).toContain('sprint:healthCheck')
    expect(channels).toContain('sprint:readLog')
    expect(channels).toContain('sprint:validateDependencies')
    expect(channels).toContain('sprint:unblockTask')
    expect(channels).toContain('sprint:getChanges')
    expect(channels).toContain('sprint:failureBreakdown')
    expect(channels).toContain('sprint:getSuccessRateBySpecType')
  })
})

describe('sprint:list handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns tasks from listTasksRecent', async () => {
    const tasks = [{ id: '1', title: 'Task A', status: 'queued' }]
    vi.mocked(_listTasksRecent).mockReturnValue(tasks as any)

    const handler = captureHandler('sprint:list')
    const result = await handler(mockEvent)

    expect(_listTasksRecent).toHaveBeenCalled()
    expect(result).toEqual(tasks)
  })

  it('returns empty array when no tasks', async () => {
    vi.mocked(_listTasksRecent).mockReturnValue([])

    const handler = captureHandler('sprint:list')
    const result = await handler(mockEvent)

    expect(result).toEqual([])
  })
})

describe('sprint:create handler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('creates a task and fires mutation notification', async () => {
    const validSpec = `${'x'.repeat(60)}\n## Overview\nContext\n## Files to Change\n- src/foo.ts\n## Implementation Steps\n1. Do it\n## How to Test\nRun tests`
    const input = { title: 'New task', repo: 'bde', status: 'queued', spec: validSpec }
    const created = { id: 'abc', ...input }
    vi.mocked(_createTask).mockReturnValue(created as any)

    const handler = captureHandler('sprint:create')
    const result = await handler(mockEvent, input)
    vi.runAllTimers()

    expect(_createTask).toHaveBeenCalledWith(input)
    expect(broadcast).toHaveBeenCalledWith('sprint:externalChange')
    expect(result).toEqual(created)
  })
})

describe('sprint:update handler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('updates a task and returns the updated row', async () => {
    const updated = { id: '1', title: 'Updated', status: 'backlog' }
    vi.mocked(_getTask).mockReturnValue({
      id: '1',
      title: 'Original',
      status: 'backlog',
      depends_on: null
    } as any)
    vi.mocked(_updateTask).mockReturnValue(updated as any)

    const handler = captureHandler('sprint:update')
    const result = await handler(mockEvent, '1', { title: 'Updated' })
    vi.runAllTimers()

    expect(_updateTask).toHaveBeenCalledWith('1', { title: 'Updated' }, undefined)
    expect(broadcast).toHaveBeenCalledWith('sprint:externalChange')
    expect(result).toEqual(updated)
  })

  it('leaves status as queued when dependencies are satisfied', async () => {
    const validSpec = `${'x'.repeat(60)}\n## Problem\nBroken\n## Solution\nFix it`
    const { createDependencyIndex } = await import('../../services/dependency-service')
    vi.mocked(createDependencyIndex).mockReturnValue({
      areDependenciesSatisfied: vi.fn().mockReturnValue({ satisfied: true })
    } as any)

    vi.mocked(_getTask).mockReturnValue({
      id: '1',
      title: 'Task 1',
      repo: 'bde',
      spec: validSpec,
      status: 'backlog',
      depends_on: [{ id: 'dep1', type: 'hard' }]
    } as any)
    vi.mocked(_listTasks).mockReturnValue([
      { id: '1', status: 'backlog', depends_on: [] },
      { id: 'dep1', status: 'done', depends_on: [] }
    ] as any)
    vi.mocked(_updateTask).mockReturnValue({ id: '1', status: 'queued' } as any)

    const handler = captureHandler('sprint:update')
    await handler(mockEvent, '1', { status: 'queued' })

    // Since deps are satisfied, patch should not be changed to blocked
    expect(_updateTask).toHaveBeenCalledWith(
      '1',
      { status: 'queued', needs_review: false },
      undefined
    )
  })

  it('transitions status to blocked when dependencies are unsatisfied', async () => {
    const validSpec = `${'x'.repeat(60)}\n## Problem\nBroken\n## Solution\nFix it`
    const { createDependencyIndex } = await import('../../services/dependency-service')
    vi.mocked(createDependencyIndex).mockReturnValue({
      areDependenciesSatisfied: vi.fn().mockReturnValue({ satisfied: false, blockedBy: ['dep1'] })
    } as any)

    vi.mocked(_getTask).mockReturnValue({
      id: '1',
      title: 'Task 1',
      repo: 'bde',
      spec: validSpec,
      status: 'backlog',
      depends_on: [{ id: 'dep1', type: 'hard' }]
    } as any)
    vi.mocked(_listTasks).mockReturnValue([
      { id: '1', status: 'backlog', depends_on: [] },
      { id: 'dep1', status: 'queued', depends_on: [] }
    ] as any)
    vi.mocked(_updateTask).mockReturnValue({ id: '1', status: 'blocked' } as any)

    const handler = captureHandler('sprint:update')
    await handler(mockEvent, '1', { status: 'queued' })

    expect(_updateTask).toHaveBeenCalledWith(
      '1',
      expect.objectContaining({ status: 'blocked' }),
      undefined
    )
  })

  it('rejects an unrecognized status string before touching the DB', async () => {
    vi.mocked(_getTask).mockReturnValue({
      id: '1',
      title: 'Task 1',
      status: 'backlog',
      depends_on: null
    } as any)

    const handler = captureHandler('sprint:update')
    await expect(handler(mockEvent, '1', { status: 'banana' })).rejects.toThrow(
      'Invalid status "banana"'
    )
    expect(_updateTask).not.toHaveBeenCalled()
  })
})

describe('sprint:delete handler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('deletes the task and fires deleted mutation notification', async () => {
    const task = { id: '1', title: 'To delete', status: 'backlog' }
    vi.mocked(_getTask).mockReturnValue(task as any)
    vi.mocked(_deleteTask).mockReturnValue(undefined)

    const handler = captureHandler('sprint:delete')
    const result = await handler(mockEvent, '1')

    vi.runAllTimers()
    expect(_deleteTask).toHaveBeenCalledWith('1')
    expect(broadcast).toHaveBeenCalledWith('sprint:externalChange')
    expect(result).toEqual({ ok: true })
  })

  it('throws when task not found before delete', async () => {
    vi.mocked(_getTask).mockReturnValue(null)
    vi.mocked(_deleteTask).mockReturnValue(undefined)

    const handler = captureHandler('sprint:delete')
    await expect(handler(mockEvent, 'nonexistent')).rejects.toThrow('Task nonexistent not found')

    expect(_deleteTask).not.toHaveBeenCalled()
    expect(broadcast).not.toHaveBeenCalled()
  })
})

describe('sprint:claimTask handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null when task not found', async () => {
    vi.mocked(_getTask).mockReturnValue(null)

    const handler = captureHandler('sprint:claimTask')
    const result = await handler(mockEvent, 'nonexistent')

    expect(result).toBeNull()
  })

  it('returns task with null templatePromptPrefix when no template', async () => {
    const task = { id: '1', title: 'Task', status: 'queued', template_name: null }
    vi.mocked(_getTask).mockReturnValue(task as any)

    const handler = captureHandler('sprint:claimTask')
    const result = await handler(mockEvent, '1')

    expect(result).toMatchObject({ id: '1', templatePromptPrefix: null })
  })

  it('returns templatePromptPrefix from matching template', async () => {
    const task = { id: '1', title: 'Task', status: 'queued', template_name: 'bugfix' }
    vi.mocked(_getTask).mockReturnValue(task as any)
    vi.mocked(getSettingJson).mockReturnValue([
      { name: 'bugfix', promptPrefix: 'Fix the bug:' },
      { name: 'feature', promptPrefix: 'Add feature:' }
    ] as any)

    const handler = captureHandler('sprint:claimTask')
    const result = await handler(mockEvent, '1')

    expect(result).toMatchObject({ id: '1', templatePromptPrefix: 'Fix the bug:' })
  })

  it('returns null prefix when template_name does not match any template', async () => {
    const task = { id: '1', title: 'Task', status: 'queued', template_name: 'unknown' }
    vi.mocked(_getTask).mockReturnValue(task as any)
    vi.mocked(getSettingJson).mockReturnValue([
      { name: 'bugfix', promptPrefix: 'Fix the bug:' }
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
      status: 'active'
    } as any)
    const logContent = 'log line 1\nlog line 2\n'
    vi.mocked(readLog).mockResolvedValue({
      content: logContent,
      nextByte: logContent.length,
      totalBytes: logContent.length
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
      status: 'done'
    } as any)
    vi.mocked(readLog).mockResolvedValue({
      content: '',
      nextByte: 9999,
      totalBytes: 5
    })

    const handler = captureHandler('sprint:readLog')
    const result = await handler(mockEvent, 'agent-1', 9999)

    expect(result).toEqual({ content: '', status: 'done', nextByte: 9999 })
  })

  it('returns empty content on file read error', async () => {
    vi.mocked(getAgentLogInfo).mockReturnValue({
      logPath: '/tmp/agent-1/output.log',
      status: 'failed'
    } as any)
    vi.mocked(readLog).mockResolvedValue({
      content: '',
      nextByte: 0,
      totalBytes: 0
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
    mockValidateFull.mockResolvedValue({
      valid: true,
      issues: [],
      errors: [],
      warnings: [],
      prescriptivenessChecked: true
    })
  })

  it('succeeds for backlog task with empty spec', async () => {
    vi.mocked(_createTask).mockReturnValue({
      id: 'new-1',
      title: 'Fix',
      repo: 'bde',
      status: 'backlog'
    } as any)

    const handler = captureHandler('sprint:create')
    const result = await handler(mockEvent, { title: 'Fix', repo: 'bde' })

    expect(result.id).toBe('new-1')
  })

  it('succeeds for backlog task with title and repo', async () => {
    vi.mocked(_createTask).mockReturnValue({
      id: 'new-1',
      title: 'Fix',
      repo: 'bde',
      status: 'backlog'
    } as any)

    const handler = captureHandler('sprint:create')
    const result = await handler(mockEvent, { title: 'Fix', repo: 'bde', status: 'backlog' })

    expect(result.id).toBe('new-1')
  })

  it('rejects non-backlog task with no spec', async () => {
    const handler = captureHandler('sprint:create')

    await expect(
      handler(mockEvent, { title: 'Fix', repo: 'bde', status: 'queued' })
    ).rejects.toThrow(/spec is required/)
  })

  it('rejects task with empty title', async () => {
    const handler = captureHandler('sprint:create')

    await expect(handler(mockEvent, { title: '', repo: 'bde', spec: validSpec })).rejects.toThrow(
      /title is required/
    )
  })

  it('rejects queued task spec missing required sections', async () => {
    const specMissingRequired = `${'x'.repeat(60)}\n## Overview\nSomething\n## Implementation Steps\nDo it\n## How to Test\nRun tests`
    const handler = captureHandler('sprint:create')

    await expect(
      handler(mockEvent, { title: 'Task', repo: 'bde', status: 'queued', spec: specMissingRequired })
    ).rejects.toThrow(/Missing required section/)
  })

  it('accepts backlog task with spec missing required sections', async () => {
    const specMissingRequired = `${'x'.repeat(60)}\n## Overview\nSomething\n## Implementation Steps\nDo it\n## How to Test\nRun tests`
    vi.mocked(_createTask).mockReturnValue({
      id: 'new-1',
      title: 'Task',
      repo: 'bde',
      status: 'backlog',
      spec: specMissingRequired
    } as any)

    const handler = captureHandler('sprint:create')
    const result = await handler(mockEvent, {
      title: 'Task',
      repo: 'bde',
      status: 'backlog',
      spec: specMissingRequired
    })

    expect(result.id).toBe('new-1')
  })

  it('rejects task creation when repo is not configured in Settings', async () => {
    vi.mocked(_getRepoPaths).mockReturnValue({})

    const handler = captureHandler('sprint:create')
    await expect(
      handler(mockEvent, { title: 'Fix bug', repo: 'bde', status: 'backlog' })
    ).rejects.toThrow(/not configured/)

    expect(_createTask).not.toHaveBeenCalled()
  })

  it('allows task creation when repo is configured', async () => {
    vi.mocked(_getRepoPaths).mockReturnValue({ bde: '/Users/ryan/projects/BDE' })
    vi.mocked(_createTask).mockReturnValue({
      id: 'new-2',
      title: 'Fix bug',
      repo: 'bde',
      status: 'backlog'
    } as any)

    const handler = captureHandler('sprint:create')
    const result = await handler(mockEvent, { title: 'Fix bug', repo: 'bde', status: 'backlog' })

    expect(result.id).toBe('new-2')
    expect(_createTask).toHaveBeenCalled()
  })
})

describe('sprint:update spec validation on queue transition', () => {
  const validSpec = `${'x'.repeat(60)}\n## Problem\nBroken\n## Solution\nFix it`

  beforeEach(() => {
    vi.clearAllMocks()
    mockValidateFull.mockResolvedValue({
      valid: true,
      issues: [],
      errors: [],
      warnings: [],
      prescriptivenessChecked: true
    })
  })

  it('throws when transitioning to queued with bad spec', async () => {
    vi.mocked(_getTask).mockReturnValue({
      id: 'abc',
      title: 'Test',
      repo: 'bde',
      spec: 'too short',
      status: 'backlog'
    } as any)

    const handler = captureHandler('sprint:update')
    await expect(handler(mockEvent, 'abc', { status: 'queued' })).rejects.toThrow(
      /spec quality checks failed/
    )
  })

  it('succeeds when transitioning to queued with valid spec and semantic pass', async () => {
    vi.mocked(_getTask).mockReturnValue({
      id: 'abc',
      title: 'Test',
      repo: 'bde',
      spec: validSpec,
      status: 'backlog'
    } as any)
    vi.mocked(_updateTask).mockReturnValue({ id: 'abc', status: 'queued' } as any)

    const handler = captureHandler('sprint:update')
    const result = await handler(mockEvent, 'abc', { status: 'queued' })
    expect(result).toEqual({ id: 'abc', status: 'queued' })
  })

  it('does NOT trigger spec validation for non-queued transitions, but DOES check state machine', async () => {
    // active → done is a valid transition — should succeed without spec validation
    vi.mocked(_getTask).mockReturnValue({
      id: 'abc',
      title: 'Test',
      repo: 'bde',
      spec: 'too short',
      status: 'active'
    } as any)
    vi.mocked(_updateTask).mockReturnValue({ id: 'abc', status: 'done' } as any)

    const handler = captureHandler('sprint:update')
    await handler(mockEvent, 'abc', { status: 'done' })

    // State machine check IS called (getTask called for transition validation)
    expect(_getTask).toHaveBeenCalled()
    // But spec quality validation is NOT called for non-queued transitions
    expect(mockValidateFull).not.toHaveBeenCalled()
  })

  it('throws when semantic check fails', async () => {
    vi.mocked(_getTask).mockReturnValue({
      id: 'abc',
      title: 'Test',
      repo: 'bde',
      spec: validSpec,
      status: 'backlog'
    } as any)
    mockValidateFull.mockResolvedValue({
      valid: false,
      issues: [
        { code: 'STEP_REQUIRES_DESIGN_DECISION', severity: 'error', message: 'clarity: Too vague' }
      ],
      errors: [
        { code: 'STEP_REQUIRES_DESIGN_DECISION', severity: 'error', message: 'clarity: Too vague' }
      ],
      warnings: [],
      prescriptivenessChecked: true
    })

    const handler = captureHandler('sprint:update')
    await expect(handler(mockEvent, 'abc', { status: 'queued' })).rejects.toThrow(
      /semantic checks failed/
    )
  })
})

describe('task ID format validation', () => {
  const INVALID_IDS = [
    '../../etc/passwd',
    '../secret',
    'id with spaces',
    'id;rm -rf /',
    'id\x00null',
    '',
    'a'.repeat(65),
  ]
  const VALID_ID = '01HXXXXXXXXXXXXXXXXXXXXXXX'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each(INVALID_IDS)('sprint:update rejects invalid task ID "%s"', async (badId) => {
    const handler = captureHandler('sprint:update')
    await expect(handler(mockEvent, badId, { title: 'x' })).rejects.toThrow('Invalid task ID format')
  })

  it('sprint:update accepts a valid task ID', async () => {
    vi.mocked(_getTask).mockReturnValue({ id: VALID_ID, title: 'T', status: 'backlog', depends_on: null } as any)
    vi.mocked(_updateTask).mockReturnValue({ id: VALID_ID, title: 'Updated', status: 'backlog' } as any)
    const handler = captureHandler('sprint:update')
    await expect(handler(mockEvent, VALID_ID, { title: 'Updated' })).resolves.not.toThrow()
  })

  it.each(INVALID_IDS)('sprint:delete rejects invalid task ID "%s"', async (badId) => {
    const handler = captureHandler('sprint:delete')
    await expect(handler(mockEvent, badId)).rejects.toThrow('Invalid task ID format')
  })

  it('sprint:delete accepts a valid task ID', async () => {
    vi.mocked(_getTask).mockReturnValue({ id: VALID_ID, title: 'T', status: 'backlog', depends_on: null } as any)
    vi.mocked(_deleteTask).mockReturnValue(undefined as any)
    const handler = captureHandler('sprint:delete')
    await expect(handler(mockEvent, VALID_ID)).resolves.not.toThrow()
  })

  it.each(INVALID_IDS)('sprint:claimTask rejects invalid task ID "%s"', async (badId) => {
    const handler = captureHandler('sprint:claimTask')
    await expect(handler(mockEvent, badId)).rejects.toThrow('Invalid task ID format')
  })

  it('sprint:claimTask accepts a valid task ID', async () => {
    vi.mocked(_getTask).mockReturnValue({ id: VALID_ID, title: 'T', status: 'queued', depends_on: null } as any)
    const handler = captureHandler('sprint:claimTask')
    await expect(handler(mockEvent, VALID_ID)).resolves.not.toThrow()
  })

  it.each(INVALID_IDS)('sprint:getChanges rejects invalid task ID "%s"', async (badId) => {
    const handler = captureHandler('sprint:getChanges')
    await expect(handler(mockEvent, badId)).rejects.toThrow('Invalid task ID format')
  })
})
