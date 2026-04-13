/**
 * Task mapping utilities for the agent manager drain loop.
 *
 * Extracted from AgentManagerImpl to isolate task validation and
 * dependency-check logic into pure, testable functions.
 */

import type { Logger } from '../logger'
import type { ISprintTaskRepository } from '../data/sprint-task-repository'
import type { DependencyIndex } from '../services/dependency-service'
import { formatBlockedNote } from '../services/dependency-service'

// ---------------------------------------------------------------------------
// MappedTask type
// ---------------------------------------------------------------------------

export type MappedTask = {
  id: string
  title: string
  prompt: string | null
  spec: string | null
  repo: string
  retry_count: number
  fast_fail_count: number
  notes: string | null
  playground_enabled: boolean
  max_runtime_ms: number | null
  max_cost_usd: number | null
  model: string | null
  group_id: string | null
}

// ---------------------------------------------------------------------------
// mapQueuedTask
// ---------------------------------------------------------------------------

/**
 * Map Queue API camelCase response to local task shape.
 * Ensures retry_count and fast_fail_count default to 0, prompt and spec default to null.
 * Returns null (with logged warning) if required fields are missing.
 */
export function mapQueuedTask(raw: Record<string, unknown>, logger: Logger): MappedTask | null {
  // Validate required fields
  if (!raw.id || typeof raw.id !== 'string') {
    logger.warn(`[agent-manager] Task missing or invalid 'id' field: ${JSON.stringify(raw)}`)
    return null
  }
  if (!raw.title || typeof raw.title !== 'string') {
    logger.warn(`[agent-manager] Task ${raw.id} missing or invalid 'title' field`)
    return null
  }
  if (!raw.repo || typeof raw.repo !== 'string') {
    logger.warn(`[agent-manager] Task ${raw.id} missing or invalid 'repo' field`)
    return null
  }

  return {
    id: raw.id,
    title: raw.title,
    prompt: (raw.prompt as string) ?? null,
    spec: (raw.spec as string) ?? null,
    repo: raw.repo,
    retry_count: Number(raw.retry_count) || 0,
    fast_fail_count: Number(raw.fast_fail_count) || 0,
    notes: (raw.notes as string) ?? null,
    playground_enabled: Boolean(raw.playground_enabled),
    max_runtime_ms: Number(raw.max_runtime_ms) || null,
    max_cost_usd: Number(raw.max_cost_usd) || null,
    model: (raw.model as string) ?? null,
    group_id: (raw.group_id as string) ?? null
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
  repo: ISprintTaskRepository,
  depIndex: DependencyIndex,
  logger: Logger
): boolean {
  try {
    const deps = typeof rawDeps === 'string' ? JSON.parse(rawDeps) : rawDeps
    if (Array.isArray(deps) && deps.length > 0) {
      const { satisfied, blockedBy } = depIndex.areDependenciesSatisfied(
        taskId,
        deps,
        (depId: string) => taskStatusMap.get(depId)
      )
      if (!satisfied) {
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
    }
  } catch (err) {
    // If dep parsing fails, set task to error instead of silently proceeding
    logger.error(`[agent-manager] Task ${taskId} has malformed depends_on data: ${err}`)
    try {
      repo.updateTask(taskId, {
        status: 'error',
        notes: 'Malformed depends_on field - cannot validate dependencies',
        claimed_by: null
      })
    } catch (updateErr) {
      logger.warn(
        `[agent-manager] Failed to update task ${taskId} after dep parse error: ${updateErr}`
      )
    }
    return true // Block the task
  }
  return false
}
