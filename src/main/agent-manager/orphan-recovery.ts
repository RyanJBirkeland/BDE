import type { IAgentTaskRepository } from '../data/sprint-task-repository'
import type { TaskStateService } from '../services/task-state-service'
import { EXECUTOR_ID } from './types'
import { reconcileRunningAgentRuns } from '../agent-history'

/** Maximum times a task can be recovered before we declare it permanently broken. */
export const MAX_ORPHAN_RECOVERY_COUNT = 3

/**
 * Summarises the outcome of a single orphan recovery run.
 * `recovered` = task IDs successfully re-queued.
 * `exhausted` = task IDs that reached the cap and were moved to `error`.
 */
export interface OrphanRecoveryResult {
  recovered: string[]
  exhausted: string[]
}

/**
 * True once per process lifetime: suppresses the repetitive "has PR, clearing
 * claimed_by" log after the first occurrence so it does not drown other signals.
 */
let prClearingAlreadyLogged = false

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
      if (!prClearingAlreadyLogged) {
        logger.info(
          `[agent-manager] Task ${task.id} "${task.title}" has PR ${task.pr_url} — not orphaned, clearing claimed_by`
        )
        prClearingAlreadyLogged = true
      }
      repo.updateTask(task.id, { claimed_by: null })
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
        repo.updateTask(task.id, {
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

    repo.updateTask(task.id, {
      status: 'queued',
      claimed_by: null,
      orphan_recovery_count: recoveryCount + 1,
      completed_at: null,
      failure_reason: null,
      started_at: null,
      retry_count: 0,
      fast_fail_count: 0,
      next_eligible_at: null,
      notes: `Task was re-queued by orphan recovery (attempt ${recoveryCount + 1}/${MAX_ORPHAN_RECOVERY_COUNT}). Agent process terminated without completing the task.`
    })
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
