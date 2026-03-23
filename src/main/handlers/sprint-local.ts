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
  getHealthCheckTasks as _getHealthCheckTasks,
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

export async function clearSprintTaskFk(agentRunId: string): Promise<void> {
  await _clearSprintTaskFk(agentRunId)
}

// --- Handler registration ---

export function registerSprintLocalHandlers(): void {
  safeHandle('sprint:list', async () => {
    return _listTasks()
  })

  safeHandle('sprint:create', async (_e, task: CreateTaskInput) => {
    const row = await _createTask(task)
    notifySprintMutation('created', row)
    return row
  })

  safeHandle('sprint:update', async (_e, id: string, patch: Record<string, unknown>) => {
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
