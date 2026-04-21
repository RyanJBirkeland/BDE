/**
 * Task retry handler for sprint tasks.
 * Extracted from sprint-local.ts to reduce function size and improve cohesion.
 */

import { execFileAsync } from '../lib/async-utils'
import { safeHandle } from '../ipc-utils'
import { isValidTaskId } from '../lib/validation'
import { getTask, resetTaskForRetry, updateTask } from '../services/sprint-service'
import { getSettingJson } from '../settings'
import { getErrorMessage } from '../../shared/errors'
import { createLogger } from '../logger'

const logger = createLogger('sprint-retry-handler')

export function registerSprintRetryHandler(): void {
  safeHandle('sprint:retry', async (_e, taskId: string) => {
    if (!isValidTaskId(taskId)) throw new Error('Invalid task ID format')
    const task = getTask(taskId)
    if (!task) throw new Error(`Task ${taskId} not found`)
    if (task.status !== 'failed' && task.status !== 'error' && task.status !== 'cancelled') {
      throw new Error(`Cannot retry task with status ${task.status}`)
    }

    // Resolve repo name to local path via repos setting
    const repos = getSettingJson<Array<{ name: string; localPath: string }>>('repos')
    const repoConfig = repos?.find((r) => r.name === task.repo)
    const repoPath = repoConfig?.localPath

    if (repoPath) {
      // Clean up stale worktree/branch if they exist (best-effort)
      const slug = task.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .slice(0, 40)
      try {
        await execFileAsync('git', ['worktree', 'prune'], { cwd: repoPath })
        const { stdout: branches } = await execFileAsync(
          'git',
          ['branch', '--list', `agent/${slug}*`],
          { cwd: repoPath }
        )
        for (const branch of branches
          .split('\n')
          .map((b) => b.trim())
          .filter(Boolean)) {
          await execFileAsync('git', ['branch', '-D', branch], { cwd: repoPath }).catch((err) => {
            logger.warn(`Failed to delete branch ${branch}: ${getErrorMessage(err)}`)
          })
        }
      } catch {
        /* cleanup is best-effort */
      }
    }

    // Clear stale terminal-state fields (completed_at, failure_reason,
    // retry_count, fast_fail_count, next_eligible_at, claimed_by, started_at)
    // before the status transition so the re-queued row looks fresh.
    resetTaskForRetry(taskId)

    // Separately clear operator notes and agent_run_id, then transition to
    // queued. Keeping the status change as the final update makes the audit
    // trail read "task moved to queued" rather than "task reset + moved".
    const updated = updateTask(taskId, {
      status: 'queued',
      notes: null,
      agent_run_id: null
    })
    if (!updated) throw new Error(`Failed to update task ${taskId}`)
    return updated
  })
}
