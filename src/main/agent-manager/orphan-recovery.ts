import type { ISprintTaskRepository } from '../data/sprint-task-repository'
import { EXECUTOR_ID } from './types'

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
    if (task.pr_url) {
      logger.info(
        `[agent-manager] Task ${task.id} "${task.title}" has PR ${task.pr_url} — not orphaned, clearing claimed_by`
      )
      repo.updateTask(task.id, { claimed_by: null })
      continue
    }

    logger.warn(`[agent-manager] Orphaned task ${task.id} "${task.title}" — re-queuing`)

    // Re-queue: clear claimed_by so drain loop or external runner can pick it up
    repo.updateTask(task.id, {
      status: 'queued',
      claimed_by: null
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
