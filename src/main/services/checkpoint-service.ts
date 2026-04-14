/**
 * Checkpoint service — creates a git commit snapshot of the current worktree
 * state without stopping the agent.
 *
 * Stages all changes, validates there is something to commit, then commits
 * with the provided message or a default label.
 */
import { execFileAsync } from '../lib/async-utils'
import { createLogger, logError } from '../logger'

const log = createLogger('checkpoint-service')

const DEFAULT_CHECKPOINT_MESSAGE = 'checkpoint: user-requested snapshot'

export interface CheckpointResult {
  ok: boolean
  committed: boolean
  error?: string
}

/**
 * Stage and commit all current changes in the given worktree.
 * Returns `committed: false` (not an error) when there is nothing new to commit.
 * Returns an actionable error message when the git index lock is held by the agent.
 */
export async function createCheckpoint(
  taskId: string,
  worktreePath: string,
  message?: string
): Promise<CheckpointResult> {
  try {
    await execFileAsync('git', ['add', '-A'], { cwd: worktreePath, encoding: 'utf-8' })

    const { stdout: diff } = await execFileAsync('git', ['diff', '--cached', '--name-only'], {
      cwd: worktreePath,
      encoding: 'utf-8'
    })

    if (!diff.trim()) {
      return { ok: true, committed: false, error: 'Nothing to commit' }
    }

    const commitMessage = (message && message.trim()) || DEFAULT_CHECKPOINT_MESSAGE
    await execFileAsync('git', ['commit', '-m', commitMessage], {
      cwd: worktreePath,
      encoding: 'utf-8'
    })

    return { ok: true, committed: true }
  } catch (err) {
    logError(log, `[checkpoint] git commit failed for ${taskId}`, err)
    const raw = err instanceof Error ? err.message : String(err)
    // Friendly message when the agent is mid-write and git is holding the index lock.
    // The user can just retry.
    const friendly = /index\.lock/i.test(raw)
      ? 'Agent is currently writing — try again in a moment'
      : raw
    return { ok: false, committed: false, error: friendly }
  }
}
