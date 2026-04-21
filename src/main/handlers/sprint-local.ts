import { safeHandle } from '../ipc-utils'
import { isValidAgentId, isValidTaskId } from '../lib/validation'
import { getDb } from '../db'
import { readFile } from 'fs/promises'
import { createLogger } from '../logger'
import type { DialogService } from '../dialog-service'
import type { TaskTemplate, ClaimedTask } from '../../shared/types'
import type { WorkflowTemplate } from '../../shared/workflow-types'
import { DEFAULT_TASK_TEMPLATES } from '../../shared/constants'
import { getSettingJson } from '../settings'
import {
  TASK_STATUSES,
  TERMINAL_STATUSES,
  isValidTransition
} from '../../shared/task-state-machine'
import { nowIso } from '../../shared/time'
import { detectCycle } from '../services/dependency-service'
import {
  generatePrompt,
  validateSpecPath,
  type GeneratePromptRequest,
  type GeneratePromptResponse
} from './sprint-spec'
import {
  getTask,
  updateTask,
  forceUpdateTask,
  deleteTask,
  getHealthCheckTasks,
  flagStuckTasks,
  listTasks,
  listTasksRecent,
  getSuccessRateBySpecType,
  createTaskWithValidation,
  type CreateTaskInput
} from '../services/sprint-service'
import { createSprintTaskRepository } from '../data/sprint-task-repository'
import type { ISprintTaskRepository } from '../data/sprint-task-repository'
import { UPDATE_ALLOWLIST } from '../data/sprint-maintenance-facade'
import { validateAndFilterPatch } from '../lib/patch-validation'
import { getAgentLogInfo } from '../data/agent-queries'
import { readLog } from '../agent-history'
import { instantiateWorkflow } from '../services/workflow-engine'
import { prepareQueueTransition, prepareUnblockTransition } from '../services/task-state-service'

const logger = createLogger('sprint-local')

export interface SprintLocalDeps {
  onStatusTerminal: (taskId: string, status: string) => void | Promise<void>
  dialog: DialogService
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

  safeHandle('sprint:create', async (_e, task: CreateTaskInput) => {
    return createTaskWithValidation(task, { logger })
  })

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

  safeHandle('sprint:update', async (_e, id: string, patch: Record<string, unknown>) => {
    if (!isValidTaskId(id)) throw new Error('Invalid task ID format')
    // SP-6: Filter patch fields through UPDATE_ALLOWLIST
    const filteredPatch = validateAndFilterPatch(patch, UPDATE_ALLOWLIST)
    if (filteredPatch === null) {
      throw new Error('No valid fields to update')
    }
    patch = filteredPatch

    // Validate status string at the handler boundary — defense-in-depth before DB round-trips.
    if (patch.status !== undefined) {
      if (
        typeof patch.status !== 'string' ||
        !(TASK_STATUSES as readonly string[]).includes(patch.status)
      ) {
        throw new Error(
          `Invalid status "${patch.status}". Valid statuses: ${TASK_STATUSES.join(', ')}`
        )
      }
    }

    // Validate status transition at the handler boundary before touching the DB.
    // The data layer also validates, but catching it early produces a clearer error
    // and prevents unnecessary DB round-trips for invalid input.
    if (patch.status && typeof patch.status === 'string') {
      const current = getTask(id)
      if (current && !isValidTransition(current.status, patch.status)) {
        throw new Error(
          `Invalid status transition: ${current.status} → ${patch.status} for task ${id}`
        )
      }
    }

    // SP-1: Queuing business rules delegated to TaskStateService
    if (patch.status === 'queued') {
      const { patch: finalPatch } = await prepareQueueTransition(id, patch, { logger })
      patch = finalPatch
    }

    // updateTask (service) handles notifySprintMutation internally
    // Fire terminal callback regardless of updateTask's return value so that
    // dependents are unblocked even when the update is a no-op (e.g. task not found).
    const result = updateTask(id, patch)
    if (patch.status && TERMINAL_STATUSES.has(patch.status as string)) {
      deps.onStatusTerminal(id, patch.status as string)
    }
    return result
  })

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
    // Validate all dep targets exist
    for (const dep of proposedDeps) {
      const target = getTask(dep.id)
      if (!target) return { valid: false, error: `Task ${dep.id} not found` }
    }

    // Check for cycles
    const allTasks = listTasks()
    const depsMap = new Map(allTasks.map((t) => [t.id, t.depends_on]))
    const cycle = detectCycle(taskId, proposedDeps, (id) => depsMap.get(id) ?? null)
    if (cycle) return { valid: false, cycle }

    return { valid: true }
  }
  safeHandle('sprint:validateDependencies', validateDeps)

  safeHandle('sprint:unblockTask', async (_e, taskId: string) => {
    if (!isValidTaskId(taskId)) throw new Error('Invalid task ID format')
    await prepareUnblockTransition(taskId)
    return updateTask(taskId, { status: 'queued' })
  })

  safeHandle('sprint:getChanges', async (_e, taskId: string) => {
    if (!isValidTaskId(taskId)) throw new Error('Invalid task ID format')
    const { getTaskChanges } = await import('../data/task-changes')
    return getTaskChanges(taskId)
  })

  safeHandle('sprint:failureBreakdown', () => {
    return effectiveRepo.getFailureReasonBreakdown()
  })

  safeHandle('sprint:getSuccessRateBySpecType', () => {
    return getSuccessRateBySpecType()
  })

  safeHandle('sprint:forceFailTask', async (_e, args: ForceOverrideArgs) => {
    return overrideTaskStatus({ ...args, targetStatus: 'failed', deps })
  })

  safeHandle('sprint:forceDoneTask', async (_e, args: ForceOverrideArgs) => {
    return overrideTaskStatus({ ...args, targetStatus: 'done', deps })
  })
}

// --- Operator escape-hatches ---

interface ForceOverrideArgs {
  taskId: string
  reason?: string | undefined
  force?: boolean | undefined
}

interface OverrideTaskStatusArgs {
  taskId: string
  reason?: string | undefined
  force?: boolean | undefined
  targetStatus: 'failed' | 'done'
  deps: SprintLocalDeps
}

function overrideTaskStatus(args: OverrideTaskStatusArgs): { ok: true } {
  if (!isValidTaskId(args.taskId)) throw new Error('Invalid task ID format')

  const task = getTask(args.taskId)
  if (!task) throw new Error(`Task ${args.taskId} not found`)

  if (TERMINAL_STATUSES.has(task.status) && !args.force) {
    throw new Error(
      `Task ${args.taskId} is already terminal (${task.status}). Pass force: true to override.`
    )
  }

  const patch = buildOverridePatch(args.targetStatus, args.reason)
  const updated = forceUpdateTask(args.taskId, patch)
  if (!updated) throw new Error(`Failed to force ${args.targetStatus} on task ${args.taskId}`)

  args.deps.onStatusTerminal(args.taskId, args.targetStatus)
  return { ok: true }
}

function buildOverridePatch(
  targetStatus: 'failed' | 'done',
  reason: string | undefined
): Record<string, unknown> {
  const timestamp = nowIso()
  if (targetStatus === 'failed') {
    const trimmedReason = reason?.trim() || 'manual-override'
    return {
      status: 'failed',
      failure_reason: 'unknown',
      notes: `Marked failed manually by user at ${timestamp}. reason: ${trimmedReason}`
    }
  }
  return {
    status: 'done',
    completed_at: timestamp,
    failure_reason: null,
    notes: `Marked done manually by user at ${timestamp}.`
  }
}
