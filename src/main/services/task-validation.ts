/**
 * Shared task creation validation — structural checks + dependency auto-blocking.
 *
 * Used by both IPC sprint:create handler and Queue API handleCreateTask
 * to eliminate duplicated validation logic.
 */
import { validateStructural } from '../../shared/spec-validation'
import { buildBlockedNotes, computeBlockState } from './dependency-service'
import type { CreateTaskInput } from '../data/sprint-task-repository'
import type { SprintTask, TaskDependency, TaskGroup } from '../../shared/types'

export interface TaskCreationResult {
  valid: boolean
  errors: string[]
  /** The (possibly mutated) task input — status may be changed to 'blocked' */
  task: CreateTaskInput
}

interface ValidateOptions {
  /** Logger for dependency check messages */
  logger: { warn: (...args: unknown[]) => void }
  /** Function to list tasks for dependency resolution */
  listTasks: (status?: string) => SprintTask[]
  /** Function to list task groups for epic dependency resolution */
  listGroups: () => TaskGroup[]
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

  // 2. Auto-block tasks with unsatisfied hard dependencies (task-level + epic-level)
  let task = { ...input }
  const dependsOn = task.depends_on as TaskDependency[] | undefined
  if (
    (dependsOn && dependsOn.length > 0 && (task.status === 'queued' || !task.status)) ||
    task.group_id
  ) {
    const { shouldBlock, blockedBy } = computeBlockState(
      {
        id: 'new-task',
        depends_on: dependsOn ?? null,
        group_id: task.group_id ?? null
      },
      {
        logger: {
          warn: opts.logger.warn,
          info: (..._args: unknown[]) => {},
          error: (..._args: unknown[]) => {},
          debug: (..._args: unknown[]) => {},
          event: (..._args: unknown[]) => {}
        } as import('../logger').Logger,
        listTasks: opts.listTasks,
        listGroups: opts.listGroups
      }
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
