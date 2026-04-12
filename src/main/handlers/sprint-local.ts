import { safeHandle } from '../ipc-utils'
import { getDb } from '../db'
import { readFile } from 'fs/promises'
import { createLogger } from '../logger'
import type { DialogService } from '../dialog-service'
import type { TaskTemplate, ClaimedTask } from '../../shared/types'
import type { WorkflowTemplate } from '../../shared/workflow-types'
import { DEFAULT_TASK_TEMPLATES } from '../../shared/constants'
import { getSettingJson } from '../settings'
import { TERMINAL_STATUSES } from '../../shared/task-state-machine'
import {
  buildBlockedNotes,
  computeBlockState,
  detectCycle
} from '../services/dependency-service'
import {
  generatePrompt,
  validateSpecPath,
  type GeneratePromptRequest,
  type GeneratePromptResponse
} from './sprint-spec'
import { validateTaskCreation } from '../services/task-validation'
import {
  getTask,
  updateTask,
  createTask,
  deleteTask,
  getHealthCheckTasks,
  flagStuckTasks,
  listTasks,
  listTasksRecent,
  getSuccessRateBySpecType,
  type CreateTaskInput
} from '../services/sprint-service'
import { UPDATE_ALLOWLIST } from '../data/sprint-task-repository'
import { getAgentLogInfo } from '../data/agent-queries'
import { readLog } from '../agent-history'
import { createSprintTaskRepository } from '../data/sprint-task-repository'
import { instantiateWorkflow } from '../services/workflow-engine'
import { registerSprintExportHandlers } from './sprint-export-handlers'
import { registerSprintBatchHandlers } from './sprint-batch-handlers'
import { registerSprintRetryHandler } from './sprint-retry-handler'
import { validateTaskSpec } from './sprint-validation-helpers'
import { listGroups } from '../data/task-group-queries'

const logger = createLogger('sprint-local')

export interface SprintLocalDeps {
  onStatusTerminal: (taskId: string, status: string) => void | Promise<void>
  dialog: DialogService
}

// --- Handler registration ---

export function registerSprintLocalHandlers(deps: SprintLocalDeps): void {
  safeHandle('sprint:list', () => {
    return listTasksRecent()
  })

  safeHandle('sprint:create', async (_e, task: CreateTaskInput) => {
    const validation = validateTaskCreation(task, {
      logger: { warn: (...args: unknown[]) => logger.warn(String(args[0])) },
      listTasks,
      listGroups
    })
    if (!validation.valid) {
      throw new Error(`Spec quality checks failed: ${validation.errors.join('; ')}`)
    }
    // createTask (service) handles notifySprintMutation internally
    const row = createTask(validation.task)
    if (!row) throw new Error('Failed to create task')
    return row
  })

  safeHandle('sprint:createWorkflow', async (_e, template: WorkflowTemplate) => {
    const repo = createSprintTaskRepository()
    const result = instantiateWorkflow(template, repo)

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
    // SP-6: Filter patch fields through UPDATE_ALLOWLIST
    const filteredPatch: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(patch)) {
      if (UPDATE_ALLOWLIST.has(key)) {
        filteredPatch[key] = value
      }
    }
    if (Object.keys(filteredPatch).length === 0) {
      throw new Error('No valid fields to update')
    }
    patch = filteredPatch

    // SP-1: Read task inside validation block to reduce TOCTOU window
    // If transitioning to queued, run quality checks
    if (patch.status === 'queued') {
      const task = getTask(id)
      if (!task) {
        throw new Error(`Task ${id} not found`)
      }

      // Validate spec
      const specText = (patch.spec as string) ?? task.spec ?? null
      await validateTaskSpec({
        title: task.title,
        repo: task.repo,
        spec: specText,
        context: 'queue'
      })

      // Dependency check (task-level + epic-level)
      const { shouldBlock, blockedBy } = computeBlockState(task, { logger, listTasks, listGroups })
      if (shouldBlock) {
        // Auto-block and record which dependencies are blocking, preserving user notes
        patch = {
          ...patch,
          status: 'blocked',
          notes: buildBlockedNotes(blockedBy, task.notes as string | null)
        }
      }

      // Auto-set needs_review to false when queueing
      patch.needs_review = false
    }

    // updateTask (service) handles notifySprintMutation internally
    const result = updateTask(id, patch)
    if (result && patch.status && TERMINAL_STATUSES.has(patch.status as string)) {
      deps.onStatusTerminal(id, patch.status as string)
    }
    return result
  })

  safeHandle('sprint:delete', async (_e, id: string) => {
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

  safeHandle(
    'sprint:generatePrompt',
    (_e, args: GeneratePromptRequest): GeneratePromptResponse => generatePrompt(args)
  )

  safeHandle('sprint:claimTask', async (_e, taskId: string): Promise<ClaimedTask | null> => {
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
    // Validate agentId to prevent path traversal (must be a valid UUID-like string)
    if (!agentId || typeof agentId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(agentId)) {
      throw new Error('Invalid agent ID format')
    }

    const fromByte = typeof rawFromByte === 'number' ? rawFromByte : 0
    const info = getAgentLogInfo(getDb(), agentId)
    if (!info) return { content: '', status: 'unknown', nextByte: fromByte }

    const result = await readLog(agentId, fromByte)
    return { content: result.content, status: info.status, nextByte: result.nextByte }
  })

  safeHandle(
    'sprint:validateDependencies',
    async (_e, taskId: string, proposedDeps: Array<{ id: string; type: 'hard' | 'soft' }>) => {
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
  )

  safeHandle('sprint:unblockTask', async (_e, taskId: string) => {
    const task = getTask(taskId)
    if (!task) throw new Error(`Task ${taskId} not found`)
    if (task.status !== 'blocked')
      throw new Error(`Task ${taskId} is not blocked (status: ${task.status})`)

    // Validate spec before unblocking
    await validateTaskSpec({
      title: task.title,
      repo: task.repo,
      spec: task.spec ?? null,
      context: 'unblock'
    })

    // updateTask (service) handles notifySprintMutation internally
    const updated = updateTask(taskId, { status: 'queued' })
    return updated
  })

  safeHandle('sprint:getChanges', async (_e, taskId: string) => {
    const { getTaskChanges } = await import('../data/task-changes')
    return getTaskChanges(taskId)
  })

  safeHandle('sprint:failureBreakdown', async () => {
    const { getFailureReasonBreakdown } = await import('../data/sprint-task-repository')
    return getFailureReasonBreakdown()
  })

  safeHandle('sprint:getSuccessRateBySpecType', () => {
    return getSuccessRateBySpecType()
  })

  // Register export, batch, and retry handlers
  registerSprintExportHandlers({ dialog: deps.dialog })
  registerSprintBatchHandlers({ onStatusTerminal: deps.onStatusTerminal })
  registerSprintRetryHandler()
}
