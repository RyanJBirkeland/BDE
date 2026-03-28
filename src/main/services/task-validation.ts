/**
 * Shared task creation validation — structural checks + dependency auto-blocking.
 *
 * Used by both IPC sprint:create handler and Queue API handleCreateTask
 * to eliminate duplicated validation logic.
 */
import { validateStructural } from '../../shared/spec-validation'
import { buildBlockedNotes, checkTaskDependencies } from '../agent-manager/dependency-helpers'
import type { CreateTaskInput } from '../data/sprint-queries'
import { listTasks as queryListTasks } from '../data/sprint-queries'
import type { SprintTask, TaskDependency } from '../../shared/types'

export interface TaskCreationResult {
  valid: boolean
  errors: string[]
  /** The (possibly mutated) task input — status may be changed to 'blocked' */
  task: CreateTaskInput
}

interface ValidateOptions {
  /** Logger for dependency check messages */
  logger: { warn: (...args: unknown[]) => void }
  /** Override for listing tasks (useful for testing) */
  listTasks?: (status?: string) => SprintTask[]
}

/**
 * Validate a task for creation: structural spec checks + dependency auto-blocking.
 *
 * Returns { valid, errors, task } where `task` may have its status mutated
 * to 'blocked' if unsatisfied hard dependencies are detected.
 */
export function validateTaskCreation(
  input: CreateTaskInput,
  opts: ValidateOptions
): TaskCreationResult {
  const listTasks = opts.listTasks ?? queryListTasks

  // 1. Structural validation — relaxed for backlog (only title + repo required)
  const structural = validateStructural({
    title: input.title,
    repo: input.repo,
    spec: input.spec ?? null,
    status: input.status ?? 'backlog'
  })
  if (!structural.valid) {
    return { valid: false, errors: structural.errors, task: input }
  }

  // 2. Auto-block tasks with unsatisfied hard dependencies
  let task = { ...input }
  const dependsOn = task.depends_on as TaskDependency[] | undefined
  if (
    dependsOn &&
    dependsOn.length > 0 &&
    (task.status === 'queued' || !task.status)
  ) {
    const { shouldBlock, blockedBy } = checkTaskDependencies(
      'new-task',
      dependsOn,
      opts.logger,
      listTasks
    )
    if (shouldBlock) {
      task = {
        ...task,
        status: 'blocked',
        notes: buildBlockedNotes(blockedBy, task.notes as string | null)
      }
    }
  }

  return { valid: true, errors: [], task }
}
