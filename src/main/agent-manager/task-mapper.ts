/**
 * Task mapping utilities for the agent manager drain loop.
 *
 * Extracted from AgentManagerImpl to isolate task validation and
 * dependency-check logic into pure, testable functions.
 */

import type { Logger } from '../logger'
import type { IAgentTaskRepository } from '../data/sprint-task-repository'
import type { DependencyIndex } from '../services/dependency-service'
import { formatBlockedNote } from '../services/dependency-service'
import type { SprintTask } from '../../shared/types/task-types'
import { sanitizeDependsOn } from '../../shared/sanitize-depends-on'

// ---------------------------------------------------------------------------
// MappedTask type
// ---------------------------------------------------------------------------

export type MappedTask = {
  id: string
  title: string
  prompt: string | null
  spec: string | null
  spec_type: string | null
  repo: string
  retry_count: number
  fast_fail_count: number
  notes: string | null
  playground_enabled: boolean
  max_runtime_ms: number | null
  max_cost_usd: number | null
  model: string | null
  group_id: string | null
  revision_feedback: { timestamp: string; feedback: string; attempt: number }[] | null
}

// ---------------------------------------------------------------------------
// mapQueuedTask
// ---------------------------------------------------------------------------

/**
 * Project a typed SprintTask into the narrower MappedTask shape used by the
 * drain loop. The defensive null-returns guard against rows that slipped
 * past SQLite constraints via direct-SQL insertion.
 */
export function mapQueuedTask(task: SprintTask, logger: Logger): MappedTask | null {
  if (!task.id) {
    logger.warn(`[agent-manager] Task missing 'id' field: ${JSON.stringify(task)}`)
    return null
  }
  if (!task.title) {
    logger.warn(`[agent-manager] Task ${task.id} missing 'title' field`)
    return null
  }
  if (!task.repo) {
    logger.warn(`[agent-manager] Task ${task.id} missing 'repo' field`)
    return null
  }

  return {
    id: task.id,
    title: task.title,
    prompt: task.prompt ?? null,
    spec: task.spec ?? null,
    spec_type: task.spec_type ?? null,
    repo: task.repo,
    retry_count: task.retry_count ?? 0,
    fast_fail_count: task.fast_fail_count ?? 0,
    notes: task.notes ?? null,
    playground_enabled: task.playground_enabled ?? false,
    max_runtime_ms: task.max_runtime_ms ?? null,
    max_cost_usd: task.max_cost_usd ?? null,
    model: task.model ?? null,
    group_id: task.group_id ?? null,
    revision_feedback: task.revision_feedback ?? null
  }
}

// ---------------------------------------------------------------------------
// checkAndBlockDeps
// ---------------------------------------------------------------------------

/**
 * Defense-in-depth: check dependencies before claiming.
 * Tasks created via direct API may be 'queued' with unsatisfied deps.
 * Returns true if the task was blocked (caller should return early), false to continue.
 */
export function checkAndBlockDeps(
  taskId: string,
  rawDeps: unknown,
  taskStatusMap: Map<string, string>,
  repo: IAgentTaskRepository,
  depIndex: DependencyIndex,
  logger: Logger
): boolean {
  const deps = sanitizeDependsOn(rawDeps)
  if (!deps) return false

  const { satisfied, blockedBy } = depIndex.areDependenciesSatisfied(
    taskId,
    deps,
    (depId: string) => taskStatusMap.get(depId)
  )
  if (satisfied) return false

  logger.info(
    `[agent-manager] Task ${taskId} has unsatisfied deps [${blockedBy.join(', ')}] — auto-blocking`
  )
  try {
    repo.updateTask(taskId, {
      status: 'blocked',
      notes: formatBlockedNote(blockedBy)
    })
  } catch {
    /* best-effort */
  }
  return true
}
