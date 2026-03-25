import { getOrphanedTasks, updateTask } from '../data/sprint-queries'
import { EXECUTOR_ID } from './types'

export async function recoverOrphans(
  isAgentActive: (taskId: string) => boolean,
  logger: { info: (msg: string) => void; warn: (msg: string) => void },
): Promise<number> {
  const orphans = await getOrphanedTasks(EXECUTOR_ID)
  let recovered = 0

  for (const task of orphans) {
    if (isAgentActive(task.id)) continue // still running

    logger.warn(`[agent-manager] Orphaned task ${task.id} "${task.title}" — re-queuing`)

    // Re-queue: clear claimed_by so drain loop or external runner can pick it up
    await updateTask(task.id, {
      status: 'queued',
      claimed_by: null,
    })
    recovered++
  }

  // Also clean up stale agent_runs records (SDK agents have pid=null)
  try {
    const { finalizeStaleAgentRuns } = await import('../agent-history')
    const cleaned = finalizeStaleAgentRuns()
    if (cleaned > 0) logger.info(`[agent-manager] Finalized ${cleaned} stale agent_runs records`)
  } catch { /* best-effort */ }

  return recovered
}
