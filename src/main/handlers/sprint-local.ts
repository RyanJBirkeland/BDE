import { safeHandle } from '../ipc-utils'
import { getDb } from '../db'
import { readFile } from 'fs/promises'
import { createLogger } from '../logger'
import type { TaskTemplate, ClaimedTask } from '../../shared/types'
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
import { validateTaskCreation } from '../services/task-validation'
import {
  getTask as _getTask,
  listTasks as _listTasks,
  createTask as _createTask,
  updateTask as _updateTask,
  deleteTask as _deleteTask,
  getHealthCheckTasks as _getHealthCheckTasks
} from '../data/sprint-queries'
import {
  getTask,
  updateTask,
  listTasks,
  claimTask,
  releaseTask,
  getQueueStats,
  getDoneTodayCount,
  markTaskDoneByPrNumber,
  markTaskCancelledByPrNumber,
  listTasksWithOpenPrs,
  updateTaskMergeableState,
  UPDATE_ALLOWLIST
} from '../services/sprint-service'
import type { CreateTaskInput, QueueStats } from '../services/sprint-service'
import { getAgentLogInfo } from '../data/agent-queries'
import { readLog } from '../agent-history'

const logger = createLogger('sprint-local')

// Re-export service-layer wrappers so existing deep imports keep working
export {
  getTask,
  listTasks,
  claimTask,
  updateTask,
  releaseTask,
  getQueueStats,
  getDoneTodayCount,
  markTaskDoneByPrNumber,
  markTaskCancelledByPrNumber,
  listTasksWithOpenPrs,
  updateTaskMergeableState,
  UPDATE_ALLOWLIST
}
export type { CreateTaskInput, QueueStats }

// Re-export listener and spec APIs so existing deep imports keep working
export { onSprintMutation } from './sprint-listeners'
export { buildQuickSpecPrompt, getTemplateScaffold } from './sprint-spec'

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
    const validation = validateTaskCreation(task, {
      logger: { warn: (...args: unknown[]) => logger.warn(String(args[0])) },
      listTasks: _listTasks
    })
    if (!validation.valid) {
      throw new Error(`Spec quality checks failed: ${validation.errors.join('; ')}`)
    }
    const row = _createTask(validation.task)
    if (!row) throw new Error('Failed to create task')
    notifySprintMutation('created', row)
    return row
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
      const task = _getTask(id)
      if (!task) {
        throw new Error(`Task ${id} not found`)
      }

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

      // Auto-set needs_review to false when queueing
      patch.needs_review = false
    }

    const result = updateTask(id, patch)
    // SP-2: Throw error if _onStatusTerminal is not set when reaching terminal status
    if (result && patch.status && TERMINAL_STATUSES.has(patch.status as string)) {
      if (!_onStatusTerminal) {
        logger.error(
          `[sprint:update] Task ${id} reached terminal status "${patch.status}" but _onStatusTerminal is not set — dependency resolution will not fire`
        )
      } else {
        _onStatusTerminal(id, patch.status as string)
      }
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
    (_e, args: GeneratePromptRequest): GeneratePromptResponse => generatePrompt(args)
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
            // SP-4: Call onStatusTerminal for terminal status changes in batch updates
            if (
              updated &&
              filtered.status &&
              typeof filtered.status === 'string' &&
              TERMINAL_STATUSES.has(filtered.status)
            ) {
              if (!_onStatusTerminal) {
                logger.warn(
                  `[sprint:batchUpdate] Task ${id} reached terminal status "${filtered.status}" but _onStatusTerminal is not set`
                )
              } else {
                _onStatusTerminal(id, filtered.status)
              }
            }
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
