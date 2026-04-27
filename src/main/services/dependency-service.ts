/**
 * Shared domain service for task dependency management.
 * Consolidates dependency checking, cycle detection, and status classification.
 *
 * This module owns the **blocking-policy** layer:
 *   - `checkTaskDependencies` — checks whether a single task should be blocked
 *   - `checkEpicDependencies` — checks whether epic-level deps block a task
 *   - `computeBlockState` — composes task + epic block checks
 *   - `buildBlockedNotes` / `stripBlockedNote` — auto-block note formatting
 *
 * Pure graph operations (cycle detection, reverse-index build) live in
 * `dependency-graph.ts`. Import `DependencyGraph` / `createDependencyIndex`
 * from there when you only need graph operations without blocking policy.
 */

import type { SprintTask, TaskDependency, TaskGroup, EpicDependency } from '../../shared/types'
import type { Logger } from '../logger'
import {
  TERMINAL_STATUSES,
  FAILURE_STATUSES,
  HARD_SATISFIED_STATUSES
} from '../../shared/task-state-machine'
import type { TaskStatus } from '../../shared/task-state-machine'
import { createEpicDependencyIndex } from './epic-dependency-service'
import { createDependencyIndex } from './dependency-graph'

// Re-export graph primitives so existing callers keep working without import-path changes.
export {
  DependencyGraph,
  createDependencyIndex,
  detectCycle,
  validateDependencyGraph,
} from './dependency-graph'

export type {
  DependencyIndex,
  DependencyGraphValidation,
  ValidateDependencyGraphDeps,
} from './dependency-graph'

// Re-export canonical status sets
export { TERMINAL_STATUSES, FAILURE_STATUSES, HARD_SATISFIED_STATUSES }

// ============================================================================
// Blocking-policy helpers
// ============================================================================

const BLOCK_PREFIX = '[auto-block] '

export function formatBlockedNote(blockedBy: string[]): string {
  return `${BLOCK_PREFIX}Blocked by: ${blockedBy.join(', ')}`
}

export function stripBlockedNote(notes: string | null): string {
  if (!notes) return ''
  return notes.replace(/^\[auto-block\] .*\n?/, '').trim()
}

export function buildBlockedNotes(blockedBy: string[], existingNotes?: string | null): string {
  const blockNote = formatBlockedNote(blockedBy)
  const userNotes = stripBlockedNote(existingNotes ?? null)
  return userNotes ? `${blockNote}\n${userNotes}` : blockNote
}

// ============================================================================
// Blocking-policy functions
// ============================================================================

/**
 * Check whether a task's dependencies are satisfied.
 * Creates a temporary dependency index from the current task list.
 * Returns { shouldBlock: true, blockedBy: [...] } if deps are unsatisfied.
 */
export function checkTaskDependencies(
  taskId: string,
  deps: TaskDependency[],
  logger: Logger,
  listTasks: () => SprintTask[]
): { shouldBlock: boolean; blockedBy: string[]; reason?: string } {
  try {
    const allTasks = listTasks()
    const statusMap = new Map(allTasks.map((t) => [t.id, t.status]))
    const idx = createDependencyIndex()
    const { satisfied, blockedBy } = idx.areDependenciesSatisfied(taskId, deps, (depId: string) =>
      statusMap.get(depId)
    )
    return { shouldBlock: !satisfied && blockedBy.length > 0, blockedBy }
  } catch (err) {
    logger.warn(`[dependency-service] checkTaskDependencies failed for ${taskId}: ${err}`)
    logger.event?.('dependency.check.error', { taskId, error: String(err) })
    const reason = 'dep-check-failed: ' + (err instanceof Error ? err.message : String(err))
    return { shouldBlock: true, blockedBy: [], reason }
  }
}

/**
 * Check whether an epic's dependencies are satisfied.
 * Creates a temporary epic dependency index from the current epic/task lists.
 * Returns { shouldBlock: true, blockedBy: [...] } if epic deps are unsatisfied.
 */
export function checkEpicDependencies(
  groupId: string | null | undefined,
  epicDeps: EpicDependency[],
  logger: Logger,
  listTasks: () => SprintTask[],
  listGroups: () => TaskGroup[]
): { shouldBlock: boolean; blockedBy: string[]; reason?: string } {
  // No epic deps = not blocked
  if (!epicDeps || epicDeps.length === 0) {
    return { shouldBlock: false, blockedBy: [] }
  }

  // Task not in an epic = epic deps don't apply
  if (!groupId) {
    return { shouldBlock: false, blockedBy: [] }
  }

  try {
    const allGroups = listGroups()
    const allTasks = listTasks()

    const epicStatusMap = new Map(allGroups.map((g) => [g.id, g.status]))
    const tasksByEpic = new Map<string, Array<{ status: TaskStatus }>>()
    for (const t of allTasks) {
      if (!t.group_id) continue
      const tasks = tasksByEpic.get(t.group_id) ?? []
      tasks.push({ status: t.status })
      tasksByEpic.set(t.group_id, tasks)
    }

    const idx = createEpicDependencyIndex()
    const { satisfied, blockedBy } = idx.areEpicDepsSatisfied(
      groupId,
      epicDeps,
      (id: string) => epicStatusMap.get(id),
      (id: string) => tasksByEpic.get(id)
    )

    return { shouldBlock: !satisfied && blockedBy.length > 0, blockedBy }
  } catch (err) {
    logger.warn(`[dependency-service] checkEpicDependencies failed for epic ${groupId}: ${err}`)
    logger.event?.('dependency.check.error', { groupId, error: String(err) })
    const reason = 'dep-check-failed: ' + (err instanceof Error ? err.message : String(err))
    return { shouldBlock: true, blockedBy: [], reason }
  }
}

/**
 * Compose task-level and epic-level block checks into a single result.
 * Prefixes epic-level blockers with "epic:" to distinguish them from task-level blockers.
 */
export interface ComputeBlockStateContext {
  logger: Logger
  listTasks: () => SprintTask[]
  listGroups: () => TaskGroup[]
}

export function computeBlockState(
  task: { id: string; depends_on: TaskDependency[] | null; group_id?: string | null | undefined },
  ctx: ComputeBlockStateContext
): { shouldBlock: boolean; blockedBy: string[]; reason?: string } {
  const taskDeps = task.depends_on ?? []
  const taskResult = checkTaskDependencies(task.id, taskDeps, ctx.logger, ctx.listTasks)

  // Get epic deps from the task's group (if any)
  let epicDeps: EpicDependency[] = []
  if (task.group_id) {
    const allGroups = ctx.listGroups()
    const group = allGroups.find((g) => g.id === task.group_id)
    epicDeps = group?.depends_on ?? []
  }

  const epicResult = checkEpicDependencies(
    task.group_id,
    epicDeps,
    ctx.logger,
    ctx.listTasks,
    ctx.listGroups
  )

  // Compose blockers: task-level as-is, epic-level with "epic:" prefix
  const allBlockedBy = [...taskResult.blockedBy, ...epicResult.blockedBy.map((id) => `epic:${id}`)]

  // Surface the failure reason from whichever check errored so callers can log why the task was held
  const reason = taskResult.reason ?? epicResult.reason

  return {
    shouldBlock: allBlockedBy.length > 0 || !!reason,
    blockedBy: allBlockedBy,
    ...(reason !== undefined && { reason })
  }
}
