import { safeHandle } from '../ipc-utils'
import { getDb } from '../db'
import { readFile } from 'fs/promises'
import { createLogger } from '../logger'
import type { SprintTask, TaskTemplate, ClaimedTask } from '../../shared/types'
import { validateStructural } from '../../shared/spec-validation'
import { DEFAULT_TASK_TEMPLATES } from '../../shared/constants'
import { getSettingJson } from '../settings'
import { notifySprintMutation } from './sprint-listeners'
import { buildBlockedNotes, checkTaskDependencies } from '../agent-manager/dependency-helpers'
import { detectCycle } from '../agent-manager/dependency-index'
import {
  generatePrompt,
  validateSpecPath,
  type GeneratePromptRequest,
  type GeneratePromptResponse
} from './sprint-spec'
import {
  getTask as _getTask,
  listTasks as _listTasks,
  createTask as _createTask,
  updateTask as _updateTask,
  deleteTask as _deleteTask,
  claimTask as _claimTask,
  releaseTask as _releaseTask,
  getQueueStats as _getQueueStats,
  getDoneTodayCount as _getDoneTodayCount,
  markTaskDoneByPrNumber as _markTaskDoneByPrNumber,
  markTaskCancelledByPrNumber as _markTaskCancelledByPrNumber,
  listTasksWithOpenPrs as _listTasksWithOpenPrs,
  updateTaskMergeableState as _updateTaskMergeableState,
  getHealthCheckTasks as _getHealthCheckTasks,
  UPDATE_ALLOWLIST
} from '../data/sprint-queries'
import type { CreateTaskInput, QueueStats } from '../data/sprint-queries'
import { getAgentLogInfo } from '../data/agent-queries'
import { readLog } from '../agent-history'

const logger = createLogger('sprint-local')

export { UPDATE_ALLOWLIST }
export type { CreateTaskInput, QueueStats }

// Re-export listener and spec APIs so existing deep imports keep working
export { onSprintMutation } from './sprint-listeners'
export { buildQuickSpecPrompt, getTemplateScaffold } from './sprint-spec'

// --- Thin wrappers that delegate to data layer (SQLite) ---

export function getTask(id: string): SprintTask | null {
  return _getTask(id)
}

export function listTasks(status?: string): SprintTask[] {
  return _listTasks(status)
}

export function claimTask(id: string, claimedBy: string): SprintTask | null {
  const result = _claimTask(id, claimedBy)
  if (result) notifySprintMutation('updated', result)
  return result
}

export function updateTask(
  id: string,
  patch: Record<string, unknown>
): SprintTask | null {
  const result = _updateTask(id, patch)
  if (result) notifySprintMutation('updated', result)
  return result
}

export function releaseTask(id: string, claimedBy: string): SprintTask | null {
  const result = _releaseTask(id, claimedBy)
  if (result) notifySprintMutation('updated', result)
  return result
}

export function getQueueStats(): QueueStats {
  return _getQueueStats()
}

export function getDoneTodayCount(): number {
  return _getDoneTodayCount()
}

export function markTaskDoneByPrNumber(prNumber: number): string[] {
  return _markTaskDoneByPrNumber(prNumber)
}

export function markTaskCancelledByPrNumber(prNumber: number): string[] {
  return _markTaskCancelledByPrNumber(prNumber)
}

export function listTasksWithOpenPrs(): SprintTask[] {
  return _listTasksWithOpenPrs()
}

export function updateTaskMergeableState(
  prNumber: number,
  mergeableState: string | null
): void {
  _updateTaskMergeableState(prNumber, mergeableState)
}

// --- Terminal status resolution ---

const TERMINAL_STATUSES = new Set(['done', 'failed', 'error', 'cancelled'])
let _onStatusTerminal: ((taskId: string, status: string) => void) | null = null

export function setOnStatusTerminal(fn: (taskId: string, status: string) => void): void {
  _onStatusTerminal = fn
}

// --- Handler registration ---

export function registerSprintLocalHandlers(): void {
  safeHandle('sprint:list', () => {
    return _listTasks()
  })

  safeHandle('sprint:create', async (_e, task: CreateTaskInput) => {
    // Structural validation — relaxed for backlog (only title + repo required)
    const structural = validateStructural({
      title: task.title,
      repo: task.repo,
      spec: task.spec ?? null,
      status: task.status ?? 'backlog'
    })
    if (!structural.valid) {
      throw new Error(`Spec quality checks failed: ${structural.errors.join('; ')}`)
    }

    // Check if task has dependencies and should be auto-blocked
    if (
      task.depends_on &&
      task.depends_on.length > 0 &&
      (task.status === 'queued' || !task.status)
    ) {
      const { shouldBlock, blockedBy } = checkTaskDependencies(
        'new-task',
        task.depends_on,
        logger,
        _listTasks
      )
      if (shouldBlock) {
        task = {
          ...task,
          status: 'blocked',
          notes: buildBlockedNotes(blockedBy, task.notes as string | null)
        }
      }
    }
    const row = _createTask(task)
    if (!row) throw new Error('Failed to create task')
    notifySprintMutation('created', row)
    return row
  })

  safeHandle('sprint:update', async (_e, id: string, patch: Record<string, unknown>) => {
    const task = patch.status === 'queued' ? _getTask(id) : null

    // If transitioning to queued, run quality checks
    if (patch.status === 'queued' && task) {
      // Structural check
      const structural = validateStructural({
        title: task.title,
        repo: task.repo,
        spec: (patch.spec as string) ?? task.spec ?? null
      })
      if (!structural.valid) {
        throw new Error(
          `Cannot queue task — spec quality checks failed: ${structural.errors.join('; ')}`
        )
      }

      // Semantic check
      const specText = (patch.spec as string) ?? task.spec
      if (specText) {
        const { checkSpecSemantic } = await import('../spec-semantic-check')
        const semantic = await checkSpecSemantic({
          title: task.title,
          repo: task.repo,
          spec: specText
        })
        if (!semantic.passed) {
          throw new Error(
            `Cannot queue task — semantic checks failed: ${semantic.failMessages.join('; ')}`
          )
        }
      }

      // Dependency check (existing logic)
      const taskDeps = task.depends_on
      if (taskDeps && taskDeps.length > 0) {
        const { shouldBlock, blockedBy } = checkTaskDependencies(id, taskDeps, logger, _listTasks)
        if (shouldBlock) {
          // Auto-block and record which dependencies are blocking, preserving user notes
          patch = {
            ...patch,
            status: 'blocked',
            notes: buildBlockedNotes(blockedBy, task.notes as string | null)
          }
        }
      }
    }

    if (patch.status === 'queued') {
      patch.needs_review = false
    }
    const result = updateTask(id, patch)
    if (result && patch.status && TERMINAL_STATUSES.has(patch.status as string)) {
      _onStatusTerminal?.(id, patch.status as string)
    }
    return result
  })

  safeHandle('sprint:delete', async (_e, id: string) => {
    const task = getTask(id)
    _deleteTask(id)
    if (task) {
      notifySprintMutation('deleted', task)
    }
    return { ok: true }
  })

  safeHandle('sprint:readSpecFile', async (_e, filePath: string) => {
    const safePath = validateSpecPath(filePath)
    return readFile(safePath, 'utf-8')
  })

  safeHandle(
    'sprint:generatePrompt',
    async (_e, args: GeneratePromptRequest): Promise<GeneratePromptResponse> => {
      const result = await generatePrompt(args)
      if (result.spec) {
        await updateTask(args.taskId, { spec: result.spec, prompt: result.prompt })
      }
      return result
    }
  )

  safeHandle('sprint:claimTask', async (_e, taskId: string): Promise<ClaimedTask | null> => {
    const task = _getTask(taskId)
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
      const allTasks = _listTasks()
      const oneHourAgo = Date.now() - 3600000
      for (const task of allTasks) {
        if (['error', 'failed'].includes(task.status) && !task.needs_review) {
          const updatedAt = new Date(task.updated_at).getTime()
          if (updatedAt < oneHourAgo) {
            _updateTask(task.id, { needs_review: true })
          }
        }
      }
    } catch (err) {
      console.warn('[sprint:healthCheck] Failed to flag stuck tasks:', err)
    }
    return _getHealthCheckTasks()
  })

  safeHandle('sprint:readLog', async (_e, agentId: string, rawFromByte?: number) => {
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
        const target = _getTask(dep.id)
        if (!target) return { valid: false, error: `Task ${dep.id} not found` }
      }

      // Check for cycles
      const allTasks = _listTasks()
      const depsMap = new Map(allTasks.map((t) => [t.id, t.depends_on]))
      const cycle = detectCycle(taskId, proposedDeps, (id) => depsMap.get(id) ?? null)
      if (cycle) return { valid: false, cycle }

      return { valid: true }
    }
  )

  safeHandle('sprint:unblockTask', async (_e, taskId: string) => {
    const task = _getTask(taskId)
    if (!task) throw new Error(`Task ${taskId} not found`)
    if (task.status !== 'blocked')
      throw new Error(`Task ${taskId} is not blocked (status: ${task.status})`)
    const updated = _updateTask(taskId, { status: 'queued' })
    if (updated) notifySprintMutation('updated', updated)
    return updated
  })

  safeHandle('sprint:getChanges', async (_e, taskId: string) => {
    const { getTaskChanges } = await import('../data/task-changes')
    return getTaskChanges(taskId)
  })

  safeHandle(
    'sprint:batchUpdate',
    async (
      _e,
      operations: Array<{ op: 'update' | 'delete'; id: string; patch?: Record<string, unknown> }>
    ) => {
      const { GENERAL_PATCH_FIELDS } = await import('../../shared/queue-api-contract')
      const results: Array<{ id: string; op: 'update' | 'delete'; ok: boolean; error?: string }> =
        []

      for (const rawOp of operations) {
        const { id, op, patch } = rawOp
        if (!id || !op) {
          results.push({
            id: id ?? 'unknown',
            op: op as 'update' | 'delete',
            ok: false,
            error: 'id and op are required'
          })
          continue
        }
        try {
          if (op === 'update') {
            if (!patch || typeof patch !== 'object') {
              results.push({
                id,
                op: 'update',
                ok: false,
                error: 'patch object required for update'
              })
              continue
            }
            const filtered: Record<string, unknown> = {}
            for (const [k, v] of Object.entries(patch)) {
              if (GENERAL_PATCH_FIELDS.has(k)) filtered[k] = v
            }
            if (Object.keys(filtered).length === 0) {
              results.push({ id, op: 'update', ok: false, error: 'No valid fields to update' })
              continue
            }
            const updated = updateTask(id, filtered)
            if (updated) notifySprintMutation('updated', updated)
            results.push({
              id,
              op: 'update',
              ok: !!updated,
              error: updated ? undefined : 'Task not found'
            })
          } else if (op === 'delete') {
            const task = getTask(id)
            _deleteTask(id)
            if (task) notifySprintMutation('deleted', task)
            results.push({ id, op: 'delete', ok: true })
          } else {
            results.push({ id, op, ok: false, error: `Unknown operation: ${op}` })
          }
        } catch (err) {
          results.push({ id, op, ok: false, error: String(err) })
        }
      }

      return { results }
    }
  )
}
