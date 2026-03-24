import { safeHandle } from '../ipc-utils'
import { getDb } from '../db'
import { readFile } from 'fs/promises'
import type { SprintTask, TaskTemplate, ClaimedTask } from '../../shared/types'
import { validateStructural } from '../../shared/spec-validation'
import { DEFAULT_TASK_TEMPLATES } from '../../shared/constants'
import { getSettingJson } from '../settings'
import { notifySprintMutation } from './sprint-listeners'
import {
  generatePrompt,
  validateSpecPath,
  type GeneratePromptRequest,
  type GeneratePromptResponse,
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
  UPDATE_ALLOWLIST,
} from '../data/sprint-queries'
import type { CreateTaskInput, QueueStats } from '../data/sprint-queries'
import { getAgentLogInfo } from '../data/agent-queries'
import { readLog } from '../agent-history'

export { UPDATE_ALLOWLIST }
export type { CreateTaskInput, QueueStats }

// Re-export listener and spec APIs so existing deep imports keep working
export { onSprintMutation } from './sprint-listeners'
export { buildQuickSpecPrompt, getTemplateScaffold } from './sprint-spec'

// --- Thin async wrappers that delegate to data layer (Supabase) ---

export async function getTask(id: string): Promise<SprintTask | null> {
  return _getTask(id)
}

export async function listTasks(status?: string): Promise<SprintTask[]> {
  return _listTasks(status)
}

export async function claimTask(id: string, claimedBy: string): Promise<SprintTask | null> {
  const result = await _claimTask(id, claimedBy)
  if (result) notifySprintMutation('updated', result)
  return result
}

export async function updateTask(id: string, patch: Record<string, unknown>): Promise<SprintTask | null> {
  const result = await _updateTask(id, patch)
  if (result) notifySprintMutation('updated', result)
  return result
}

export async function releaseTask(id: string): Promise<SprintTask | null> {
  const result = await _releaseTask(id)
  if (result) notifySprintMutation('updated', result)
  return result
}

export async function getQueueStats(): Promise<QueueStats> {
  return _getQueueStats()
}

export async function getDoneTodayCount(): Promise<number> {
  return _getDoneTodayCount()
}

export async function markTaskDoneByPrNumber(prNumber: number): Promise<string[]> {
  return _markTaskDoneByPrNumber(prNumber)
}

export async function markTaskCancelledByPrNumber(prNumber: number): Promise<string[]> {
  return _markTaskCancelledByPrNumber(prNumber)
}

export async function listTasksWithOpenPrs(): Promise<SprintTask[]> {
  return _listTasksWithOpenPrs()
}

export async function updateTaskMergeableState(prNumber: number, mergeableState: string | null): Promise<void> {
  await _updateTaskMergeableState(prNumber, mergeableState)
}

// --- Handler registration ---

export function registerSprintLocalHandlers(): void {
  safeHandle('sprint:list', async () => {
    return _listTasks()
  })

  safeHandle('sprint:create', async (_e, task: CreateTaskInput) => {
    // Structural validation — relaxed for backlog (only title + repo required)
    const structural = validateStructural({
      title: task.title,
      repo: task.repo,
      spec: task.spec ?? null,
      status: task.status ?? 'backlog',
    })
    if (!structural.valid) {
      throw new Error(`Spec quality checks failed: ${structural.errors.join('; ')}`)
    }

    // Check if task has dependencies and should be auto-blocked
    if (task.depends_on && task.depends_on.length > 0 && (task.status === 'queued' || !task.status)) {
      const { createDependencyIndex } = await import('../agent-manager/dependency-index')
      const idx = createDependencyIndex()
      const allTasks = await _listTasks()
      const statusMap = new Map(allTasks.map((t) => [t.id, t.status]))
      const { satisfied, blockedBy } = idx.areDependenciesSatisfied(
        'new-task',
        task.depends_on,
        (depId) => statusMap.get(depId),
      )
      if (!satisfied && blockedBy.length > 0) {
        task = {
          ...task,
          status: 'blocked',
          notes: `[auto-block] Blocked by: ${blockedBy.join(', ')}${task.notes ? `\n${task.notes}` : ''}`
        }
      }
    }
    const row = await _createTask(task)
    notifySprintMutation('created', row)
    return row
  })

  safeHandle('sprint:update', async (_e, id: string, patch: Record<string, unknown>) => {
    const task = patch.status === 'queued' ? await _getTask(id) : null

    // If transitioning to queued, run quality checks
    if (patch.status === 'queued' && task) {
      // Structural check
      const structural = validateStructural({
        title: task.title,
        repo: task.repo,
        spec: (patch.spec as string) ?? task.spec ?? null,
      })
      if (!structural.valid) {
        throw new Error(`Cannot queue task — spec quality checks failed: ${structural.errors.join('; ')}`)
      }

      // Semantic check
      const specText = (patch.spec as string) ?? task.spec
      if (specText) {
        const { checkSpecSemantic } = await import('../spec-semantic-check')
        const semantic = await checkSpecSemantic({
          title: task.title,
          repo: task.repo,
          spec: specText,
        })
        if (!semantic.passed) {
          throw new Error(`Cannot queue task — semantic checks failed: ${semantic.failMessages.join('; ')}`)
        }
      }

      // Dependency check (existing logic)
      const taskDeps = task.depends_on
      if (taskDeps && taskDeps.length > 0) {
        const { createDependencyIndex } = await import(
          '../agent-manager/dependency-index'
        )
        const idx = createDependencyIndex()
        const allTasks = await _listTasks()
        const statusMap = new Map(allTasks.map((t) => [t.id, t.status]))
        const { satisfied, blockedBy } = idx.areDependenciesSatisfied(
          id,
          taskDeps,
          (depId) => statusMap.get(depId),
        )
        if (!satisfied && blockedBy.length > 0) {
          // Auto-block and record which dependencies are blocking, preserving user notes
          const existingNotes = (task.notes || '').replace(/^\[auto-block\] .*\n?/, '').trim()
          const blockNote = `[auto-block] Blocked by: ${blockedBy.join(', ')}`
          patch = {
            ...patch,
            status: 'blocked',
            notes: existingNotes ? `${blockNote}\n${existingNotes}` : blockNote
          }
        }
      }
    }

    return updateTask(id, patch)
  })

  safeHandle('sprint:delete', async (_e, id: string) => {
    const task = await getTask(id)
    await _deleteTask(id)
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
    const task = await _getTask(taskId)
    if (!task) return null

    let templatePromptPrefix: string | null = null
    if (task.template_name) {
      const templates = getSettingJson<TaskTemplate[]>('task.templates') ?? [...DEFAULT_TASK_TEMPLATES]
      const match = templates.find((t) => t.name === task.template_name)
      templatePromptPrefix = match?.promptPrefix ?? null
    }

    return { ...task, templatePromptPrefix }
  })

  safeHandle('sprint:healthCheck', async () => {
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
    async (
      _e,
      taskId: string,
      proposedDeps: Array<{ id: string; type: 'hard' | 'soft' }>,
    ) => {
      const { detectCycle } = await import(
        '../agent-manager/dependency-index'
      )

      // Validate all dep targets exist
      for (const dep of proposedDeps) {
        const target = await _getTask(dep.id)
        if (!target) return { valid: false, error: `Task ${dep.id} not found` }
      }

      // Check for cycles
      const allTasks = await _listTasks()
      const depsMap = new Map(
        allTasks.map((t) => [
          t.id,
          t.depends_on,
        ]),
      )
      const cycle = detectCycle(
        taskId,
        proposedDeps,
        (id) => depsMap.get(id) ?? null,
      )
      if (cycle) return { valid: false, cycle }

      return { valid: true }
    },
  )

  safeHandle('sprint:unblockTask', async (_e, taskId: string) => {
    const task = await _getTask(taskId)
    if (!task) throw new Error(`Task ${taskId} not found`)
    if (task.status !== 'blocked')
      throw new Error(`Task ${taskId} is not blocked (status: ${task.status})`)
    const updated = await _updateTask(taskId, { status: 'queued' })
    if (updated) notifySprintMutation('updated', updated)
    return updated
  })
}
