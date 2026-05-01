import type { IAgentTaskRepository } from '../data/sprint-task-repository'
import type { TaskStateService } from '../services/task-state-service'
import { EXECUTOR_ID } from './types'
import { reconcileRunningAgentRuns } from '../agent-history'

/** Maximum times a task can be recovered before we declare it permanently broken. */
export const MAX_ORPHAN_RECOVERY_COUNT = 3

/**
 * Grace period before the drain loop can re-claim an orphan-recovered task.
 * Gives the original agent's finally-block (worktree cleanup) time to finish
 * before a new agent tries to set up the same worktree path.
 */
const ORPHAN_REQUEUE_GRACE_MS = 30_000

/**
 * Summarises the outcome of a single orphan recovery run.
 * `recovered` = task IDs successfully re-queued.
 * `exhausted` = task IDs that reached the cap and were moved to `error`.
 */
export interface OrphanRecoveryResult {
  recovered: string[]
  exhausted: string[]
}

export async function recoverOrphans(
  isAgentActive: (taskId: string) => boolean,
  repo: IAgentTaskRepository,
  logger: { info: (msg: string) => void; warn: (msg: string) => void },
  taskStateService?: TaskStateService
): Promise<OrphanRecoveryResult> {
  const orphans = repo.getOrphanedTasks(EXECUTOR_ID)
  const recovered: string[] = []
  const exhausted: string[] = []

  for (const task of orphans) {
    if (isAgentActive(task.id)) continue

    if (task.pr_url || task.pr_status === 'branch_only') {
      logger.info(
        `[agent-manager] Task ${task.id} "${task.title}" has PR ${task.pr_url} — not orphaned, clearing claimed_by`
      )
      await repo.updateTask(task.id, { claimed_by: null })
      continue
    }

    const recoveryCount = task.orphan_recovery_count ?? 0

    if (recoveryCount >= MAX_ORPHAN_RECOVERY_COUNT) {
      logger.warn(
        `[agent-manager] Task ${task.id} "${task.title}" exhausted orphan recovery cap ` +
          `(count=${recoveryCount}, priorStatus=${task.status}, retryCount=${task.retry_count ?? 0}, startedAt=${task.started_at ?? 'null'}) — marking error`
      )
      if (taskStateService) {
        try {
          await taskStateService.transition(task.id, 'error', {
            fields: {
              claimed_by: null,
              failure_reason: 'exhausted: orphan recovery cap reached'
            },
            caller: 'orphan-recovery'
          })
        } catch (err) {
          logger.warn(
            `[agent-manager] TaskStateService.transition failed for exhausted orphan ${task.id}: ${err}`
          )
        }
      } else {
        // Legacy fallback for callers (older tests) that have not yet been
        // migrated to inject TaskStateService.
        const exhaustedReason = 'exhausted: orphan recovery cap reached'
        await repo.updateTask(task.id, {
          status: 'error',
          claimed_by: null,
          failure_reason: exhaustedReason
        })
      }
      exhausted.push(task.id)
      continue
    }

    logger.warn(
      `[agent-manager] Orphaned task ${task.id} "${task.title}" — re-queuing ` +
        `(count=${recoveryCount + 1}/${MAX_ORPHAN_RECOVERY_COUNT}, priorStatus=${task.status}, retryCount=${task.retry_count ?? 0}, startedAt=${task.started_at ?? 'null'})`
    )

    const requeueFields = {
      claimed_by: null,
      orphan_recovery_count: recoveryCount + 1,
      completed_at: null,
      failure_reason: null,
      started_at: null,
      retry_count: 0,
      fast_fail_count: 0,
      next_eligible_at: new Date(Date.now() + ORPHAN_REQUEUE_GRACE_MS).toISOString(),
      notes: `Task was re-queued by orphan recovery (attempt ${recoveryCount + 1}/${MAX_ORPHAN_RECOVERY_COUNT}). Agent process terminated without completing the task.`
    }

    if (taskStateService) {
      try {
        await taskStateService.transition(task.id, 'queued', {
          fields: requeueFields,
          caller: 'orphan-recovery:requeue'
        })
      } catch (err) {
        logger.warn(
          `[agent-manager] TaskStateService.transition failed for orphan requeue ${task.id}: ${err}`
        )
      }
    } else {
      await repo.updateTask(task.id, { status: 'queued', ...requeueFields })
    }
    recovered.push(task.id)
  }

  try {
    const cleaned = reconcileRunningAgentRuns(isAgentActive)
    if (cleaned > 0) logger.info(`[agent-manager] Reconciled ${cleaned} stale agent_runs records`)
  } catch {
    /* best-effort */
  }

  return { recovered, exhausted }
}
