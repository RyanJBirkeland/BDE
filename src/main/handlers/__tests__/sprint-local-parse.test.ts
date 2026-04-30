/**
 * Tests for the IPC argument parsers in sprint-local.ts.
 * These run purely against the parsing logic — no Electron, no DB.
 */
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
  updateTaskFromUi: vi.fn(),
  buildClaimedTask: vi.fn(),
  forceReleaseClaim: vi.fn(),
  listTasks: vi.fn(),
  listTasksRecent: vi.fn(),
  getHealthCheckTasks: vi.fn(),
  flagStuckTasks: vi.fn(),
  getSuccessRateBySpecType: vi.fn()
}))
vi.mock('../../services/task-state-service', () => ({
  prepareUnblockTransition: vi.fn(),
  forceTerminalOverride: vi.fn()
}))
vi.mock('../../lib/validation', () => ({ isValidTaskId: vi.fn().mockReturnValue(true), isValidAgentId: vi.fn().mockReturnValue(true) }))
vi.mock('../../lib/prompt-composer', () => ({ buildAgentPrompt: vi.fn() }))
vi.mock('../../settings', () => ({ getSetting: vi.fn(), getSettingJson: vi.fn() }))
vi.mock('../../paths', () => ({
  getConfiguredRepos: vi.fn().mockReturnValue([]),
  getRepoConfig: vi.fn()
}))
vi.mock('../../services/dependency-service', () => ({ validateDependencyGraph: vi.fn() }))
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
vi.mock('../../services/task-validation', () => ({ validateTaskSpec: vi.fn() }))
vi.mock('../../db', () => ({ getDb: vi.fn() }))
vi.mock('../../data/task-changes', () => ({ getTaskChanges: vi.fn() }))
vi.mock('../../data/agent-queries', () => ({ getAgentLogInfo: vi.fn() }))
vi.mock('../../agent-history', () => ({ readLog: vi.fn() }))
vi.mock('../sprint-spec', () => ({ generatePrompt: vi.fn(), validateSpecPath: vi.fn() }))

// Sprint-local exports parseSprintCreateArgs indirectly via safeHandle — we test
// the Zod schemas directly through the schema module to keep tests focused.
import { CreateTaskInputSchema } from '../sprint-ipc-schemas'
import { parseCreateWorkflowArgs } from '../sprint-local'

// ─────────────────────────────────────────────────────────────────────────────
// parseSprintCreateArgs — exercised via CreateTaskInputSchema.parse directly
// (the function itself is private; the schema is the unit under test)
// ─────────────────────────────────────────────────────────────────────────────

describe('CreateTaskInputSchema (parseSprintCreateArgs contract)', () => {
  it('accepts a minimal valid task with title and repo', () => {
    const result = CreateTaskInputSchema.parse({ title: 'My task', repo: 'fleet' })
    expect(result.title).toBe('My task')
    expect(result.repo).toBe('fleet')
  })

  it('throws when title is missing', () => {
    expect(() => CreateTaskInputSchema.parse({ repo: 'fleet' })).toThrow()
  })

  it('throws when repo is empty string', () => {
    expect(() => CreateTaskInputSchema.parse({ title: 'T', repo: '' })).toThrow()
  })

  it('throws when depends_on contains an element with invalid type', () => {
    expect(() =>
      CreateTaskInputSchema.parse({
        title: 'T',
        repo: 'fleet',
        depends_on: [{ id: 'x', type: 'invalid' }]
      })
    ).toThrow()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// parseCreateWorkflowArgs — public export, tests the full IPC parser
// ─────────────────────────────────────────────────────────────────────────────

const validStep = { title: 'Step 1', repo: 'fleet' }

describe('parseCreateWorkflowArgs', () => {
  it('accepts a valid workflow template', () => {
    const template = { name: 'My Flow', description: 'Does things', steps: [validStep] }
    const [result] = parseCreateWorkflowArgs([template])
    expect(result.name).toBe('My Flow')
    expect(result.description).toBe('Does things')
    expect(result.steps).toHaveLength(1)
  })

  it('throws when name is missing', () => {
    expect(() =>
      parseCreateWorkflowArgs([{ description: 'd', steps: [validStep] }])
    ).toThrow()
  })

  it('throws when steps is empty (schema enforces min(1))', () => {
    expect(() =>
      parseCreateWorkflowArgs([{ name: 'n', description: 'd', steps: [] }])
    ).toThrow()
  })

  it('throws when a step is missing repo', () => {
    expect(() =>
      parseCreateWorkflowArgs([
        { name: 'n', description: 'd', steps: [{ title: 'Step' }] }
      ])
    ).toThrow()
  })
})
