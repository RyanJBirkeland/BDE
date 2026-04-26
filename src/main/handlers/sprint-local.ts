import { safeHandle } from '../ipc-utils'
import { isValidAgentId, isValidTaskId } from '../lib/validation'
import { getDb } from '../db'
import { getTaskChanges } from '../data/task-changes'
import { readFile } from 'fs/promises'
import { createLogger } from '../logger'
import type { DialogService } from '../dialog-service'
import type { TaskTemplate, ClaimedTask } from '../../shared/types'
import type { WorkflowTemplate } from '../../shared/workflow-types'
import { DEFAULT_TASK_TEMPLATES } from '../../shared/constants'
import { getSettingJson } from '../settings'
import type { TaskStatus } from '../../shared/task-state-machine'
import { validateDependencyGraph } from '../services/dependency-service'
import {
  generatePrompt,
  validateSpecPath,
  type GeneratePromptRequest,
  type GeneratePromptResponse
} from './sprint-spec'
import {
  getTask,
  updateTask,
  deleteTask,
  getHealthCheckTasks,
  flagStuckTasks,
  listTasks,
  listTasksRecent,
  getSuccessRateBySpecType,
  createTaskWithValidation,
  updateTaskFromUi,
  resetTaskForRetry,
  notifySprintMutation,
  type CreateTaskInput
} from '../services/sprint-service'
import { createSprintTaskRepository } from '../data/sprint-task-repository'
import type { ISprintTaskRepository } from '../data/sprint-task-repository'
import { getAgentLogInfo } from '../data/agent-queries'
import { readLog } from '../agent-history'
import { instantiateWorkflow } from '../services/workflow-engine'
import {
  prepareUnblockTransition,
  forceTerminalOverride,
  type TaskStateService
} from '../services/task-state-service'

const logger = createLogger('sprint-local')

/**
 * Runtime shape guard for `sprint:update` IPC arguments.
 * Static types narrow the channel; this catches malformed payloads at the wire
 * boundary before any allow-list filtering or DB lookups run.
 */
function parseSprintUpdateArgs(args: unknown[]): [string, Record<string, unknown>] {
  if (args.length !== 2) {
    throw new Error(`expected [id, patch]; got ${args.length} args`)
  }
  const [id, patch] = args
  if (typeof id !== 'string') {
    throw new Error(`id must be a string; got ${typeof id}`)
  }
  if (!isPlainObject(patch)) {
    throw new Error(`patch must be a plain object; got ${describeValue(patch)}`)
  }
  return [id, patch]
}

function parseSprintCreateArgs(args: unknown[]): [CreateTaskInput] {
  if (args.length !== 1) {
    throw new Error(`expected [task]; got ${args.length} args`)
  }
  const [task] = args
  if (!isPlainObject(task)) {
    throw new Error(`task must be a plain object; got ${describeValue(task)}`)
  }
  if (typeof task.title !== 'string' || task.title.trim() === '') {
    throw new Error('task.title must be a non-empty string')
  }
  if (typeof task.repo !== 'string' || task.repo.trim() === '') {
    throw new Error('task.repo must be a non-empty string')
  }
  return [task as unknown as CreateTaskInput]
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  )
}

function describeValue(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

export interface SprintLocalDeps {
  onStatusTerminal: (taskId: string, status: TaskStatus) => void | Promise<void>
  dialog: DialogService
  taskStateService: TaskStateService
}

// --- Handler registration ---

export function registerSprintLocalHandlers(
  deps: SprintLocalDeps,
  repo?: ISprintTaskRepository
): void {
  const effectiveRepo = repo ?? createSprintTaskRepository()
  safeHandle('sprint:list', () => {
    return listTasksRecent()
  })

  safeHandle('sprint:create',
    async (_e, task: CreateTaskInput) => createTaskWithValidation(task, { logger }),
    parseSprintCreateArgs
  )

  safeHandle('sprint:createWorkflow', async (_e, template: WorkflowTemplate) => {
    const result = instantiateWorkflow(template, effectiveRepo)

    if (result.errors.length > 0) {
      logger.warn(
        `[sprint:createWorkflow] Workflow "${template.name}" had errors: ${result.errors.join('; ')}`
      )
    }

    return {
      tasks: result.tasks,
      errors: result.errors,
      success: result.errors.length === 0
    }
  })

  const sprintUpdateHandler = async (
    _e: Electron.IpcMainInvokeEvent,
    id: string,
    patch: Record<string, unknown>
  ): Promise<ReturnType<typeof updateTask>> =>
    updateTaskFromUi(id, patch, { logger, taskStateService: deps.taskStateService })
  safeHandle('sprint:update', sprintUpdateHandler, parseSprintUpdateArgs)

  safeHandle('sprint:delete', async (_e, id: string) => {
    if (!isValidTaskId(id)) throw new Error('Invalid task ID format')
    const task = getTask(id)
    if (!task) {
      throw new Error(`Task ${id} not found`)
    }
    // Prevent deletion of active tasks
    if (task.status === 'active') {
      throw new Error(`Cannot delete active task ${id} — stop the agent first`)
    }
    // deleteTask (service) handles notifySprintMutation internally
    deleteTask(id)
    return { ok: true }
  })

  safeHandle('sprint:readSpecFile', async (_e, filePath: string) => {
    const safePath = validateSpecPath(filePath)
    return readFile(safePath, 'utf-8')
  })

  const generatePromptHandler = (
    _e: Electron.IpcMainInvokeEvent,
    args: GeneratePromptRequest
  ): GeneratePromptResponse => generatePrompt(args)
  safeHandle('sprint:generatePrompt', generatePromptHandler)

  safeHandle('sprint:claimTask', async (_e, taskId: string): Promise<ClaimedTask | null> => {
    if (!isValidTaskId(taskId)) throw new Error('Invalid task ID format')
    const task = getTask(taskId)
    if (!task) return null

    let templatePromptPrefix: string | null = null
    if (task.template_name) {
      const templates = getSettingJson<TaskTemplate[]>('task.templates') ?? [
        ...DEFAULT_TASK_TEMPLATES
      ]
      const match = templates.find((t) => t.name === task.template_name)
      templatePromptPrefix = match?.promptPrefix ?? null
    }

    return { ...task, templatePromptPrefix }
  })

  safeHandle('sprint:healthCheck', async () => {
    try {
      flagStuckTasks()
    } catch (err) {
      logger.warn(`[sprint:healthCheck] Failed to flag stuck tasks: ${err}`)
    }
    return getHealthCheckTasks()
  })

  safeHandle('sprint:readLog', async (_e, agentId: string, rawFromByte?: number) => {
    if (!isValidAgentId(agentId)) throw new Error('Invalid agent ID format')

    const fromByte = typeof rawFromByte === 'number' ? rawFromByte : 0
    const info = getAgentLogInfo(getDb(), agentId)
    if (!info) return { content: '', status: 'unknown', nextByte: fromByte }

    const result = await readLog(agentId, fromByte)
    return { content: result.content, status: info.status, nextByte: result.nextByte }
  })

  type ProposedDeps = Array<{ id: string; type: 'hard' | 'soft' }>
  type ValidateDepsResult =
    | { valid: true }
    | { valid: false; error: string }
    | { valid: false; cycle: string[] }
  const validateDeps = async (
    _e: Electron.IpcMainInvokeEvent,
    taskId: string,
    proposedDeps: ProposedDeps
  ): Promise<ValidateDepsResult> => {
    if (!isValidTaskId(taskId)) throw new Error('Invalid task ID format')
    return validateDependencyGraph(taskId, proposedDeps, { getTask, listTasks })
  }
  safeHandle('sprint:validateDependencies', validateDeps)

  safeHandle('sprint:unblockTask', async (_e, taskId: string) => {
    if (!isValidTaskId(taskId)) throw new Error('Invalid task ID format')
    await prepareUnblockTransition(taskId)
    await deps.taskStateService.transition(taskId, 'queued', { caller: 'sprint:unblockTask' })
    return getTask(taskId)
  })

  safeHandle('sprint:getChanges', async (_e, taskId: string) => {
    if (!isValidTaskId(taskId)) throw new Error('Invalid task ID format')
    return getTaskChanges(taskId)
  })

  safeHandle('sprint:failureBreakdown', () => {
    return effectiveRepo.getFailureReasonBreakdown()
  })

  safeHandle('sprint:getSuccessRateBySpecType', () => {
    return getSuccessRateBySpecType()
  })

  safeHandle('sprint:forceFailTask', async (_e, args: ForceOverrideArgs) => {
    if (!isValidTaskId(args.taskId)) throw new Error('Invalid task ID format')
    return forceTerminalOverride({ ...args, targetStatus: 'failed' }, deps)
  })

  safeHandle('sprint:forceDoneTask', async (_e, args: ForceOverrideArgs) => {
    if (!isValidTaskId(args.taskId)) throw new Error('Invalid task ID format')
    return forceTerminalOverride({ ...args, targetStatus: 'done' }, deps)
  })

  safeHandle('sprint:forceReleaseClaim', async (_e, taskId: string) => {
    if (!isValidTaskId(taskId)) throw new Error('Invalid task ID format')
    const task = getTask(taskId)
    if (!task) throw new Error(`Task ${taskId} not found`)
    if (task.status !== 'active') {
      throw new Error(`Cannot force-release a task with status ${task.status} — only active tasks can be released`)
    }
    // TODO(audit T-10): also abort the running agent before re-queue. Out of scope for EP-1
    // (which only routes the status write through TaskStateService). The agent process can
    // continue running against the now-queued task until it terminates naturally.
    resetTaskForRetry(taskId)
    await deps.taskStateService.transition(taskId, 'queued', {
      fields: { notes: null, agent_run_id: null },
      caller: 'sprint:forceReleaseClaim'
    })
    const released = getTask(taskId)
    if (!released) throw new Error(`Failed to release task ${taskId}`)
    notifySprintMutation('updated', released)
    return released
  })
}

interface ForceOverrideArgs {
  taskId: string
  reason?: string | undefined
  force?: boolean | undefined
}
