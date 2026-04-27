import { describe, it, expect, vi } from 'vitest'

vi.mock('../../ipc-utils', () => ({ safeHandle: vi.fn() }))
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: vi.fn(() => []) }
}))
vi.mock('../../broadcast', () => ({ broadcast: vi.fn(), broadcastCoalesced: vi.fn() }))
vi.mock('../../logger', () => ({
  createLogger: vi.fn(() => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() }))
}))
vi.mock('../../data/sprint-queries', () => ({
  UPDATE_ALLOWLIST: new Set(['title', 'status']),
  listTasksRecent: vi.fn(),
  getTask: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  deleteTask: vi.fn(),
  getQueueStats: vi.fn(),
  getSuccessRateBySpecType: vi.fn(),
  getTasksWithDependencies: vi.fn(),
  getFailureBreakdown: vi.fn(),
  getSprintById: vi.fn(),
  setSprintQueriesLogger: vi.fn()
}))
vi.mock('../../data/sprint-task-repository', () => ({
  createSprintTaskRepository: vi.fn(() => ({
    getTask: vi.fn(),
    updateTask: vi.fn(),
    listTasksRecent: vi.fn()
  }))
}))
vi.mock('../../services/workflow-engine', () => ({ instantiateWorkflow: vi.fn() }))
vi.mock('../../services/sprint-service', () => ({
  createTask: vi.fn(),
  updateTask: vi.fn(),
  getTask: vi.fn(),
  deleteTask: vi.fn(),
  createTaskWithValidation: vi.fn(),
  updateTaskFromUi: vi.fn()
}))
vi.mock('../../services/task-state-service', () => ({}))
vi.mock('../../lib/validation', () => ({ isValidTaskId: vi.fn().mockReturnValue(true) }))
vi.mock('../../lib/prompt-composer', () => ({ buildAgentPrompt: vi.fn() }))
vi.mock('../../settings', () => ({ getSetting: vi.fn(), getSettingJson: vi.fn() }))
vi.mock('../../paths', () => ({
  getConfiguredRepos: vi.fn().mockReturnValue([]),
  getRepoConfig: vi.fn()
}))
vi.mock('../../services/dependency-service', () => ({}))
vi.mock('../../services/epic-dependency-service', () => ({}))
vi.mock('../../data/task-group-queries', () => ({}))
vi.mock('../../lib/resolve-dependents', () => ({ resolveDependents: vi.fn() }))
vi.mock('../../services/spec-quality/factory', () => ({ createSpecQualityService: vi.fn() }))
vi.mock('../../../shared/types', () => ({ GENERAL_PATCH_FIELDS: new Set() }))
vi.mock('../../lib/patch-validation', () => ({ validateAndFilterPatch: vi.fn() }))
vi.mock('../../services/sprint-retry-handler', () => ({ handleSprintRetry: vi.fn() }))
vi.mock('../../data/sprint-planning-queries', () => ({
  createSprint: vi.fn(),
  getSprint: vi.fn(),
  getAllSprints: vi.fn(),
  updateSprint: vi.fn(),
  deleteSprint: vi.fn()
}))
vi.mock('../../services/force-override-service', () => ({ forceTerminalOverride: vi.fn() }))
vi.mock('../../services/task-validation', () => ({ validateTaskSpec: vi.fn() }))

import { parseCreateWorkflowArgs } from '../sprint-local'

describe('parseCreateWorkflowArgs', () => {
  it('accepts a valid template with name and tasks array', () => {
    const template = { name: 'My Workflow', tasks: [{ title: 'Task 1' }] }
    const [result] = parseCreateWorkflowArgs([template])
    expect(result).toBe(template)
  })

  it('throws when argument is not an object', () => {
    expect(() => parseCreateWorkflowArgs([null])).toThrow('plain object')
    expect(() => parseCreateWorkflowArgs(['string'])).toThrow('plain object')
    expect(() => parseCreateWorkflowArgs([42])).toThrow('plain object')
  })

  it('throws when name is missing', () => {
    expect(() => parseCreateWorkflowArgs([{ tasks: [] }])).toThrow('name')
  })

  it('throws when name is empty string', () => {
    expect(() => parseCreateWorkflowArgs([{ name: '', tasks: [] }])).toThrow('name')
  })

  it('throws when name is whitespace-only', () => {
    expect(() => parseCreateWorkflowArgs([{ name: '   ', tasks: [] }])).toThrow('name')
  })

  it('throws when tasks is not an array', () => {
    expect(() => parseCreateWorkflowArgs([{ name: 'My Flow', tasks: 'not-array' }])).toThrow('tasks')
    expect(() => parseCreateWorkflowArgs([{ name: 'My Flow', tasks: null }])).toThrow('tasks')
  })

  it('accepts empty tasks array', () => {
    expect(() => parseCreateWorkflowArgs([{ name: 'Empty Flow', tasks: [] }])).not.toThrow()
  })
})
