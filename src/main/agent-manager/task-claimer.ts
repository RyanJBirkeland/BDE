/**
 * Task claimer — maps raw DB rows to AgentRunClaim, verifies fresh status,
 * checks dependency blocking, resolves repo paths, and claims the task atomically.
 *
 * Extracted from AgentManagerImpl._validateAndClaimTask and
 * _processQueuedTask so the logic is unit-testable in isolation.
 */

import type { Logger } from '../logger'
import { logError } from '../logger'
import type { AgentManagerConfig } from './types'
import { EXECUTOR_ID, NOTES_MAX_LENGTH } from './types'
import type { IAgentTaskRepository } from '../data/sprint-task-repository'
import type { DependencyIndex } from '../services/dependency-service'
import { mapQueuedTask, checkAndBlockDeps, type MappedTask } from './task-mapper'
import type { SprintTask } from '../../shared/types/task-types'
import { setupWorktree } from './worktree'
import { nowIso } from '../../shared/time'
import type { AgentRunClaim } from './run-agent'
import { taskHasMatchingCommitOnMain } from './already-done-check'
import type { TaskStatus } from '../../shared/task-state-machine'
import type { TaskStateService } from '../services/task-state-service'
import type { SpawnRegistry } from './spawn-registry'

// ---------------------------------------------------------------------------
// Deps interface
// ---------------------------------------------------------------------------

export interface TaskClaimerDeps {
  config: AgentManagerConfig
  repo: IAgentTaskRepository
  depIndex: DependencyIndex
  logger: Logger
  onTaskTerminal: (taskId: string, status: TaskStatus) => Promise<void>
  taskStateService: TaskStateService
  resolveRepoPath: (slug: string) => string | null
  /** Called immediately after a task is successfully claimed so the renderer
   *  can update without waiting for the file-watcher debounce cycle. */
  onTaskClaimed?: (taskId: string) => void
}

// ---------------------------------------------------------------------------
// Claim helpers
// ---------------------------------------------------------------------------

/**
 * Map the raw DB row, verify the task is still queued (fresh status guard),
 * block on unsatisfied hard deps, resolve the repo path, and claim the task
 * atomically.
 *
 * Returns `{ task, repoPath }` on success or `null` to signal "skip this task".
 */
export async function validateAndClaimTask(
  rawTask: SprintTask,
  taskStatusMap: Map<string, TaskStatus>,
  deps: TaskClaimerDeps
): Promise<{ task: MappedTask; repoPath: string } | null> {
  const task = mapQueuedTask(rawTask, deps.logger)
  if (!task) return null

  if (
    rawTask.depends_on &&
    checkAndBlockDeps(
      task.id,
      rawTask.depends_on,
      taskStatusMap,
      deps.repo,
      deps.depIndex,
      deps.logger
    )
  ) {
    return null
  }

  const repoPath = deps.resolveRepoPath(task.repo)
  if (!repoPath) {
    deps.logger.warn(
      `[agent-manager] No repo path for "${task.repo}" — setting task ${task.id} to error`
    )
    try {
      await deps.repo.updateTask(task.id, {
        status: 'error',
        notes: `Repo "${task.repo}" is not configured in FLEET settings. Add it in Settings > Repos, then reset this task to queued.`,
        claimed_by: null
      })
    } catch (err) {
      deps.logger.warn(
        `[agent-manager] Failed to update task ${task.id} after repo resolution failure: ${err}`
      )
    }
    await deps
      .onTaskTerminal(task.id, 'error')
      .catch((err) => deps.logger.warn(`[agent-manager] onTerminal failed for ${task.id}: ${err}`))
    return null
  }

  if (await skipIfAlreadyOnMain(task, rawTask, repoPath, deps)) {
    return null
  }

  const claimed = (await deps.repo.claimTask(task.id, EXECUTOR_ID, deps.config.maxConcurrent)) !== null
  if (!claimed) {
    deps.logger.info(
      `[agent-manager] Task ${task.id} could not be claimed (status may have changed or WIP limit reached) — skipping`
    )
    return null
  }

  deps.onTaskClaimed?.(task.id)
  return { task, repoPath }
}

/**
 * Pre-claim guard: if a commit on origin/main already fingerprints this task,
 * the work is done. Transition to `done` via the terminal pipeline so
 * dependency resolution still fires, and skip the spawn.
 *
 * Returns true when the task should be skipped (already-done), false otherwise.
 */
async function skipIfAlreadyOnMain(
  task: MappedTask,
  rawTask: SprintTask,
  repoPath: string,
  deps: TaskClaimerDeps
): Promise<boolean> {
  const agentRunId = rawTask.agent_run_id ?? null
  const match = await taskHasMatchingCommitOnMain(
    { id: task.id, title: task.title, agent_run_id: agentRunId },
    repoPath,
    deps.logger
  )
  if (!match) return false

  const autoCompleteNote = `auto-completed: matching commit found on main at ${match.sha} (matched on ${match.matchedOn})`
  deps.logger.info(`[agent-manager] Task ${task.id} ${autoCompleteNote} — skipping spawn`)

  try {
    await deps.taskStateService.transition(task.id, 'done', {
      fields: { completed_at: nowIso(), claimed_by: null, notes: autoCompleteNote },
      caller: 'task-claimer:auto-complete'
    })
  } catch (err) {
    // Transition failed — do NOT call onTaskTerminal. The task is still in its
    // prior status in SQLite; firing dependency resolution here would unblock
    // dependents against a task that has not actually completed.
    deps.logger.warn(
      `[agent-manager] Failed to mark task ${task.id} done after already-on-main match: ${err}`
    )
    return false
  }
  deps.logger.event('task.auto-complete', { taskId: task.id, sha: match.sha, matchedOn: match.matchedOn })
  await deps
    .onTaskTerminal(task.id, 'done')
    .catch((err) => deps.logger.warn(`[agent-manager] onTerminal failed for ${task.id}: ${err}`))
  return true
}

// ---------------------------------------------------------------------------
// Worktree preparation (lives here because it is tightly coupled to claiming)
// ---------------------------------------------------------------------------

/**
 * Create or reuse the git worktree for `task`.
 * Returns the worktree descriptor on success, or `null` on failure after
 * marking the task as `error` and notifying the terminal handler.
 */
export async function prepareWorktreeForTask(
  task: MappedTask,
  repoPath: string,
  deps: TaskClaimerDeps
): Promise<{ worktreePath: string; branch: string } | null> {
  try {
    return await setupWorktree({
      repoPath,
      worktreeBase: deps.config.worktreeBase,
      taskId: task.id,
      title: task.title,
      groupId: task.group_id ?? undefined,
      logger: deps.logger,
      appendToNotes: (text) => {
        // fire-and-forget: note append is best-effort, so void the Promise
        void deps.repo.updateTask(task.id, { notes: text }).catch((err) => {
          deps.logger.warn(`[task-claimer] Failed to append fetchMain failure to notes for task ${task.id}: ${err}`)
        })
      }
    })
  } catch (err) {
    logError(deps.logger, `[agent-manager] setupWorktree failed for task ${task.id}`, err)
    const errMsg = err instanceof Error ? err.message : String(err)
    const fullNote = `Worktree setup failed: ${errMsg}`
    const notes =
      fullNote.length > NOTES_MAX_LENGTH
        ? '...' + fullNote.slice(-(NOTES_MAX_LENGTH - 3))
        : fullNote
    try {
      await deps.taskStateService.transition(task.id, 'error', {
        fields: { completed_at: nowIso(), notes, claimed_by: null },
        caller: 'worktree-setup-failure'
      })
    } catch (transitionErr) {
      // Transition rejected — release the claim so the task is not stuck as claimed.
      deps.logger.error(
        `[task-claimer] Failed to transition task ${task.id} to error after worktree failure: ${transitionErr}`
      )
      try {
        await deps.repo.updateTask(task.id, { claimed_by: null })
      } catch (releaseErr) {
        deps.logger.error(
          `[task-claimer] Failed to release claim for task ${task.id}: ${releaseErr}`
        )
      }
    }
    return null
  }
}

// ---------------------------------------------------------------------------
// Full task-processing pipeline
// ---------------------------------------------------------------------------

export interface ProcessQueuedTaskDeps extends TaskClaimerDeps {
  spawnRegistry: SpawnRegistry
  spawnAgent: (
    task: AgentRunClaim,
    worktree: { worktreePath: string; branch: string },
    repoPath: string
  ) => Promise<void>
  /**
   * Optional sink for IDs of tasks successfully claimed in this tick. Read by
   * the next drain tick's dependency refresh as a dirty-set hint.
   */
  recentlyProcessedTaskIds?: Set<string>
}

/**
 * Full pipeline for one queued task row: idempotency guard → claim →
 * worktree setup → spawn agent.
 *
 * Refreshes the task-status map after a successful claim to reduce stale-state
 * windows when processing subsequent tasks in the same drain tick.
 */
export async function processQueuedTask(
  rawTask: SprintTask,
  taskStatusMap: Map<string, TaskStatus>,
  deps: ProcessQueuedTaskDeps
): Promise<void> {
  const taskId = rawTask.id
  if (deps.spawnRegistry.isProcessing(taskId)) return
  // Guard: if an agent is already running for this task (e.g. orphan recovery
  // re-queued while the original agent's finally-block is still executing),
  // skip the spawn to prevent concurrent agents on the same worktree path.
  if (deps.spawnRegistry.hasActiveAgent(taskId)) {
    deps.logger.warn(
      `[task-claimer] task ${taskId} already has an active agent — skipping spawn to avoid worktree race`
    )
    return
  }
  deps.spawnRegistry.markProcessing(taskId)
  try {
    const claimed = await validateAndClaimTask(rawTask, taskStatusMap, deps)
    if (!claimed) return

    const { task, repoPath } = claimed
    deps.recentlyProcessedTaskIds?.add(task.id)

    // Targeted post-claim refresh: only the just-claimed task's status changed.
    // A full-catalog rescan here is wasted I/O — every other entry in the map
    // is still valid for the rest of this drain tick.
    try {
      const fresh = deps.repo.getTask(task.id)
      if (fresh) taskStatusMap.set(fresh.id, fresh.status)
    } catch {
      // non-fatal: stale map is better than aborting the drain
    }

    const wt = await prepareWorktreeForTask(task, repoPath, deps)
    if (!wt) return

    deps.logger.info(`[agent-manager] Task ${task.id} claimed — spawning agent in ${wt.worktreePath}`)
    await deps.spawnAgent(task, wt, repoPath)
  } finally {
    deps.spawnRegistry.unmarkProcessing(taskId)
  }
}
