import { safeHandle } from '../ipc-utils'
import { getDb } from '../db'
import { readFile, writeFile } from 'fs/promises'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { createLogger } from '../logger'
import { dialog } from 'electron'

const execFileAsync = promisify(execFile)
import type { TaskTemplate, ClaimedTask } from '../../shared/types'
import type { WorkflowTemplate } from '../../shared/workflow-types'
import { validateStructural } from '../../shared/spec-validation'
import { DEFAULT_TASK_TEMPLATES } from '../../shared/constants'
import { getSettingJson } from '../settings'
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
  getTask,
  updateTask,
  createTask,
  deleteTask,
  getHealthCheckTasks,
  listTasks,
  listTasksRecent,
  claimTask,
  releaseTask,
  getQueueStats,
  getDoneTodayCount,
  markTaskDoneByPrNumber,
  markTaskCancelledByPrNumber,
  listTasksWithOpenPrs,
  updateTaskMergeableState,
  UPDATE_ALLOWLIST,
  getSuccessRateBySpecType
} from '../services/sprint-service'
import type { CreateTaskInput, QueueStats } from '../services/sprint-service'
import { getAgentLogInfo } from '../data/agent-queries'
import { readLog } from '../agent-history'
import { createSprintTaskRepository } from '../data/sprint-task-repository'
import { instantiateWorkflow } from '../services/workflow-engine'

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
    return listTasksRecent()
  })

  safeHandle('sprint:create', async (_e, task: CreateTaskInput) => {
    const validation = validateTaskCreation(task, {
      logger: { warn: (...args: unknown[]) => logger.warn(String(args[0])) },
      listTasks
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
        const { shouldBlock, blockedBy } = checkTaskDependencies(id, taskDeps, logger, listTasks)
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

    // updateTask (service) handles notifySprintMutation internally
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
      const db = getDb()
      const allTasks = listTasks()
      const oneHourAgo = Date.now() - 3600000
      const tasksToUpdate = allTasks.filter(
        (task) =>
          ['error', 'failed'].includes(task.status) &&
          !task.needs_review &&
          new Date(task.updated_at).getTime() < oneHourAgo
      )

      // Use transaction to ensure all-or-nothing update
      if (tasksToUpdate.length > 0) {
        db.transaction(() => {
          for (const task of tasksToUpdate) {
            updateTask(task.id, { needs_review: true })
          }
        })()
      }
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

    // Validate spec before unblocking (same checks as sprint:update when transitioning to queued)
    const structural = validateStructural({
      title: task.title,
      repo: task.repo,
      spec: task.spec ?? null
    })
    if (!structural.valid) {
      throw new Error(
        `Cannot unblock task — spec quality checks failed: ${structural.errors.join('; ')}`
      )
    }

    // Semantic check if spec exists
    if (task.spec) {
      const { checkSpecSemantic } = await import('../spec-semantic-check')
      const semantic = await checkSpecSemantic({
        title: task.title,
        repo: task.repo,
        spec: task.spec
      })
      if (!semantic.passed) {
        throw new Error(
          `Cannot unblock task — semantic checks failed: ${semantic.failMessages.join('; ')}`
        )
      }
    }

    // updateTask (service) handles notifySprintMutation internally
    const updated = updateTask(taskId, { status: 'queued' })
    return updated
  })

  safeHandle('sprint:getChanges', async (_e, taskId: string) => {
    const { getTaskChanges } = await import('../data/task-changes')
    return getTaskChanges(taskId)
  })

  safeHandle('sprint:exportTaskHistory', async (_e, taskId: string) => {
    const { dialog } = await import('electron')
    const { getTaskChanges } = await import('../data/task-changes')
    const { writeFile } = await import('fs/promises')

    // Get task to use title in filename suggestion
    const task = getTask(taskId)
    if (!task) throw new Error(`Task ${taskId} not found`)

    // Get task change history
    const changes = getTaskChanges(taskId)

    // Show save dialog
    const result = await dialog.showSaveDialog({
      title: 'Export Task History',
      defaultPath: `task-history-${task.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })

    if (result.canceled || !result.filePath) {
      return { success: false }
    }

    // Prepare export data
    const exportData = {
      task: {
        id: task.id,
        title: task.title,
        status: task.status,
        created_at: task.created_at,
        updated_at: task.updated_at
      },
      changes,
      exportedAt: new Date().toISOString()
    }

    // Write to file
    await writeFile(result.filePath, JSON.stringify(exportData, null, 2), 'utf-8')

    return { success: true, path: result.filePath }
  })

  safeHandle('sprint:retry', async (_e, taskId: string) => {
    const task = getTask(taskId)
    if (!task) throw new Error(`Task ${taskId} not found`)
    if (task.status !== 'failed' && task.status !== 'error') {
      throw new Error(`Cannot retry task with status ${task.status}`)
    }

    // Resolve repo name to local path via repos setting
    const repos = getSettingJson<Array<{ name: string; localPath: string }>>('repos')
    const repoConfig = repos?.find((r) => r.name === task.repo)
    const repoPath = repoConfig?.localPath

    if (repoPath) {
      // Clean up stale worktree/branch if they exist (best-effort)
      const slug = task.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .slice(0, 40)
      try {
        await execFileAsync('git', ['worktree', 'prune'], { cwd: repoPath })
        const { stdout: branches } = await execFileAsync(
          'git',
          ['branch', '--list', `agent/${slug}*`],
          { cwd: repoPath }
        )
        for (const branch of branches
          .split('\n')
          .map((b) => b.trim())
          .filter(Boolean)) {
          await execFileAsync('git', ['branch', '-D', branch], { cwd: repoPath }).catch(() => {})
        }
      } catch {
        /* cleanup is best-effort */
      }
    }

    // Reset task fields — updateTask (service) handles notifySprintMutation internally
    const updated = updateTask(taskId, {
      status: 'queued',
      claimed_by: null,
      notes: null,
      started_at: null,
      completed_at: null,
      fast_fail_count: 0,
      agent_run_id: null
    })
    if (!updated) throw new Error(`Failed to update task ${taskId}`)
    return updated
  })

  safeHandle(
    'sprint:batchUpdate',
    async (
      _e,
      operations: Array<{ op: 'update' | 'delete'; id: string; patch?: Record<string, unknown> }>
    ) => {
      const { GENERAL_PATCH_FIELDS } = await import('../../shared/types')
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

            // If transitioning to queued, validate spec quality
            if (filtered.status === 'queued') {
              const task = getTask(id)
              if (task) {
                const structural = validateStructural({
                  title: task.title,
                  repo: task.repo,
                  spec: (filtered.spec as string) ?? task.spec ?? null
                })
                if (!structural.valid) {
                  results.push({
                    id,
                    op: 'update',
                    ok: false,
                    error: `Spec quality checks failed: ${structural.errors.join('; ')}`
                  })
                  continue
                }

                const specText = (filtered.spec as string) ?? task.spec
                if (specText) {
                  const { checkSpecSemantic } = await import('../spec-semantic-check')
                  const semantic = await checkSpecSemantic({
                    title: task.title,
                    repo: task.repo,
                    spec: specText
                  })
                  if (!semantic.passed) {
                    results.push({
                      id,
                      op: 'update',
                      ok: false,
                      error: `Semantic checks failed: ${semantic.failMessages.join('; ')}`
                    })
                    continue
                  }
                }
              }
            }

            // updateTask (service) handles notifySprintMutation internally
            const updated = updateTask(id, filtered)
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
            // deleteTask (service) handles notifySprintMutation internally
            deleteTask(id)
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

  safeHandle(
    'sprint:batchImport',
    async (
      _e,
      tasks: Array<{
        title: string
        repo: string
        prompt?: string
        spec?: string
        status?: string
        dependsOnIndices?: number[]
        depType?: 'hard' | 'soft'
        playgroundEnabled?: boolean
        model?: string
        tags?: string[]
        priority?: number
        templateName?: string
      }>
    ) => {
      const { batchImportTasks } = await import('../services/batch-import')
      const { createSprintTaskRepository } = await import('../data/sprint-task-repository')
      const repo = createSprintTaskRepository()
      return batchImportTasks(tasks, repo)
    }
  )

  safeHandle(
    'sprint:exportTasks',
    async (_e, format: 'json' | 'csv'): Promise<{ filePath: string | null; canceled: boolean }> => {
      const tasks = listTasks()

      // Show save dialog
      const result = await dialog.showSaveDialog({
        title: 'Export Sprint Tasks',
        defaultPath: `sprint-tasks-${new Date().toISOString().split('T')[0]}.${format}`,
        filters: [
          format === 'json'
            ? { name: 'JSON Files', extensions: ['json'] }
            : { name: 'CSV Files', extensions: ['csv'] }
        ]
      })

      if (result.canceled || !result.filePath) {
        return { filePath: null, canceled: true }
      }

      // Generate export content
      let content: string
      if (format === 'json') {
        content = JSON.stringify(tasks, null, 2)
      } else {
        // CSV format
        const headers = [
          'id',
          'title',
          'repo',
          'status',
          'priority',
          'created_at',
          'updated_at',
          'started_at',
          'completed_at',
          'claimed_by',
          'spec',
          'prompt',
          'notes',
          'pr_url',
          'pr_number',
          'pr_status',
          'template_name',
          'playground_enabled',
          'depends_on',
          'tags'
        ]
        const csvRows = [headers.join(',')]

        for (const task of tasks) {
          const row = headers.map((header) => {
            let value = task[header as keyof typeof task]

            // Handle complex types
            if (header === 'depends_on' && Array.isArray(value)) {
              value = JSON.stringify(value)
            } else if (header === 'tags' && Array.isArray(value)) {
              value = JSON.stringify(value)
            } else if (value === null || value === undefined) {
              value = ''
            } else if (typeof value === 'boolean') {
              value = value ? 'true' : 'false'
            }

            // Escape CSV special characters
            const stringValue = String(value)
            if (
              stringValue.includes(',') ||
              stringValue.includes('"') ||
              stringValue.includes('\n')
            ) {
              return `"${stringValue.replace(/"/g, '""')}"`
            }
            return stringValue
          })
          csvRows.push(row.join(','))
        }
        content = csvRows.join('\n')
      }

      // Write to file
      await writeFile(result.filePath, content, 'utf-8')
      logger.info(`[sprint:exportTasks] Exported ${tasks.length} tasks to ${result.filePath}`)

      return { filePath: result.filePath, canceled: false }
    }
  )

  safeHandle('sprint:failureBreakdown', async () => {
    const { getFailureReasonBreakdown } = await import('../data/sprint-queries')
    return getFailureReasonBreakdown()
  })

  safeHandle('sprint:getSuccessRateBySpecType', () => {
    return getSuccessRateBySpecType()
  })
}
