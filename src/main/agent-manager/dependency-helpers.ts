/**
 * Shared utilities for task dependency management.
 * Used by index.ts drain loop, task-handlers.ts, sprint-local.ts, and resolve-dependents.ts.
 */

import { createDependencyIndex } from './dependency-index'
import { listTasks } from '../data/sprint-queries'
import type { TaskDependency } from '../../shared/types'
import type { Logger } from './types'

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

/**
 * Check whether a task's dependencies are satisfied.
 * Creates a temporary dependency index from the current task list.
 * Returns { shouldBlock: true, blockedBy: [...] } if deps are unsatisfied.
 */
export async function checkTaskDependencies(
  taskId: string,
  deps: TaskDependency[],
  logger: Logger
): Promise<{ shouldBlock: boolean; blockedBy: string[] }> {
  try {
    const allTasks = await listTasks()
    const statusMap = new Map(allTasks.map((t) => [t.id, t.status]))
    const idx = createDependencyIndex()
    const { satisfied, blockedBy } = idx.areDependenciesSatisfied(taskId, deps, (depId: string) =>
      statusMap.get(depId)
    )
    return { shouldBlock: !satisfied && blockedBy.length > 0, blockedBy }
  } catch (err) {
    logger.warn(`[dependency-helpers] checkTaskDependencies failed for ${taskId}: ${err}`)
    return { shouldBlock: false, blockedBy: [] }
  }
}
