import type { ISprintTaskRepository } from '../data/sprint-task-repository'
import { EXECUTOR_ID, MAX_RETRIES } from './types'

export async function recoverOrphans(
  isAgentActive: (taskId: string) => boolean,
  repo: ISprintTaskRepository,
  logger: { info: (msg: string) => void; warn: (msg: string) => void }
): Promise<number> {
  const orphans = repo.getOrphanedTasks(EXECUTOR_ID)
  let recovered = 0

  for (const task of orphans) {
    if (isAgentActive(task.id)) continue // still running

    // Skip tasks that already have a PR — they completed successfully and are
    // waiting for SprintPrPoller to mark them done on merge.
    if (task.pr_url || task.pr_status === 'branch_only') {
      logger.info(
        `[agent-manager] Task ${task.id} "${task.title}" has PR ${task.pr_url} — not orphaned, clearing claimed_by`
      )
      repo.updateTask(task.id, { claimed_by: null })
      continue
    }

    logger.warn(`[agent-manager] Orphaned task ${task.id} "${task.title}" — re-queuing`)

    // Increment retry_count and check against MAX_RETRIES
    const retryCount = (task.retry_count ?? 0) + 1
    if (retryCount >= MAX_RETRIES) {
      logger.warn(`[agent-manager] Task ${task.id} exceeded max retries (${MAX_RETRIES}) via orphan recovery — marking as error`)
      repo.updateTask(task.id, {
        status: 'error',
        claimed_by: null,
        notes: `Exceeded max retries (${MAX_RETRIES}) via orphan recovery. The agent process terminated without completing the task.`,
        needs_review: true
      })
      continue
    }

    // Re-queue: clear claimed_by so drain loop or external runner can pick it up
    repo.updateTask(task.id, {
      status: 'queued',
      claimed_by: null,
      retry_count: retryCount,
      notes: `Task was re-queued by orphan recovery (retry ${retryCount}/${MAX_RETRIES}). Agent process terminated without completing the task.`
    })
    recovered++
  }

  // Also clean up stale agent_runs records (SDK agents have pid=null)
  try {
    const { finalizeStaleAgentRuns } = await import('../agent-history')
    const cleaned = finalizeStaleAgentRuns()
    if (cleaned > 0) logger.info(`[agent-manager] Finalized ${cleaned} stale agent_runs records`)
  } catch {
    /* best-effort */
  }

  return recovered
}
