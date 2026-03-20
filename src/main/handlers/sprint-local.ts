import { safeHandle } from '../ipc-utils'
import { getDb } from '../db'
import { getSpecsRoot } from '../paths'
import { readFile } from 'fs/promises'
import { resolve } from 'path'
import type { SprintTask, TaskTemplate, ClaimedTask } from '../../shared/types'
import { DEFAULT_TASK_TEMPLATES } from '../../shared/constants'
import { getSettingJson } from '../settings'
import { notifySprintMutation } from './sprint-listeners'
import {
  generatePrompt,
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
  clearSprintTaskFk as _clearSprintTaskFk,
  UPDATE_ALLOWLIST,
} from '../data/sprint-queries'
import type { CreateTaskInput, QueueStats } from '../data/sprint-queries'

export { UPDATE_ALLOWLIST }
export type { CreateTaskInput, QueueStats }

// Re-export listener and spec APIs so existing deep imports keep working
export { onSprintMutation } from './sprint-listeners'
export { buildQuickSpecPrompt, getTemplateScaffold } from './sprint-spec'

function validateSpecPath(relativePath: string): string {
  const specsRoot = getSpecsRoot()
  if (!specsRoot) {
    throw new Error('Cannot resolve spec path: BDE repo not configured')
  }
  const resolved = resolve(specsRoot, relativePath)
  if (!resolved.startsWith(specsRoot + '/') && resolved !== specsRoot) {
    throw new Error(`Path traversal blocked: "${relativePath}" resolves outside ${specsRoot}`)
  }
  return resolved
}

// --- Thin wrappers that delegate to data layer with getDb() ---

export function getTask(id: string): SprintTask | null {
  return _getTask(getDb(), id)
}

export function listTasks(status?: string): SprintTask[] {
  return _listTasks(getDb(), status)
}

export function claimTask(id: string, claimedBy: string): SprintTask | null {
  const result = _claimTask(getDb(), id, claimedBy)
  if (result) notifySprintMutation('updated', result)
  return result
}

export function updateTask(id: string, patch: Record<string, unknown>): SprintTask | null {
  const result = _updateTask(getDb(), id, patch)
  if (result) notifySprintMutation('updated', result)
  return result
}

export function releaseTask(id: string): SprintTask | null {
  const result = _releaseTask(getDb(), id)
  if (result) notifySprintMutation('updated', result)
  return result
}

export function getQueueStats(): QueueStats {
  return _getQueueStats(getDb())
}

export function getDoneTodayCount(): number {
  return _getDoneTodayCount(getDb())
}

export function markTaskDoneByPrNumber(prNumber: number): void {
  _markTaskDoneByPrNumber(getDb(), prNumber)
}

export function markTaskCancelledByPrNumber(prNumber: number): void {
  _markTaskCancelledByPrNumber(getDb(), prNumber)
}

export function listTasksWithOpenPrs(): SprintTask[] {
  return _listTasksWithOpenPrs(getDb())
}

export function updateTaskMergeableState(prNumber: number, mergeableState: string | null): void {
  _updateTaskMergeableState(getDb(), prNumber, mergeableState)
}

export function clearSprintTaskFk(agentRunId: string): void {
  _clearSprintTaskFk(getDb(), agentRunId)
}

// --- Handler registration ---

export function registerSprintLocalHandlers(): void {
  safeHandle('sprint:list', () => {
    return _listTasks(getDb())
  })

  safeHandle('sprint:create', (_e, task: CreateTaskInput) => {
    const row = _createTask(getDb(), task)
    notifySprintMutation('created', row)
    return row
  })

  safeHandle('sprint:update', (_e, id: string, patch: Record<string, unknown>) => {
    return updateTask(id, patch)
  })

  safeHandle('sprint:delete', (_e, id: string) => {
    const task = getTask(id)
    _deleteTask(getDb(), id)
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
      return generatePrompt(args)
    }
  )

  safeHandle('sprint:claimTask', (_e, taskId: string): ClaimedTask | null => {
    const task = _getTask(getDb(), taskId)
    if (!task) return null

    let templatePromptPrefix: string | null = null
    if (task.template_name) {
      const templates = getSettingJson<TaskTemplate[]>('task.templates') ?? [...DEFAULT_TASK_TEMPLATES]
      const match = templates.find((t) => t.name === task.template_name)
      templatePromptPrefix = match?.promptPrefix ?? null
    }

    return { ...task, templatePromptPrefix }
  })

  safeHandle('sprint:healthCheck', () => {
    // Returns tasks stuck in 'active' for >1 hour with no recent agent activity
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    return getDb()
      .prepare(
        `SELECT * FROM sprint_tasks
         WHERE status = 'active' AND started_at < ?`
      )
      .all(oneHourAgo) as SprintTask[]
  })

  safeHandle('sprint:readLog', async (_e, agentId: string, rawFromByte?: number) => {
    const fromByte = typeof rawFromByte === 'number' ? rawFromByte : 0
    const agent = getDb()
      .prepare('SELECT log_path, status FROM agent_runs WHERE id = ?')
      .get(agentId) as { log_path: string | null; status: string } | undefined

    if (!agent?.log_path) return { content: '', status: 'unknown', nextByte: fromByte }

    try {
      const fullContent = await readFile(agent.log_path, 'utf-8')
      const bytes = Buffer.from(fullContent, 'utf-8')
      if (fromByte >= bytes.length) {
        return { content: '', status: agent.status, nextByte: fromByte }
      }
      const slice = bytes.subarray(fromByte).toString('utf-8')
      return { content: slice, status: agent.status, nextByte: bytes.length }
    } catch {
      return { content: '', status: agent.status, nextByte: fromByte }
    }
  })
}
