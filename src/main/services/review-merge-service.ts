/**
 * Review merge service — handles local merge operations for code review.
 *
 * Provides rebase, merge strategies, conflict handling, and cleanup.
 */
import { execFile } from 'child_process'
import { promisify } from 'util'
import { createLogger } from '../logger'
import { getErrorMessage } from '../../shared/errors'
import { runPostMergeDedup } from './post-merge-dedup'

const execFileAsync = promisify(execFile)
const logger = createLogger('review-merge-service')

export interface MergeOptions {
  worktreePath: string
  branch: string
  repoPath: string
  strategy: 'merge' | 'squash' | 'rebase'
  taskId: string
  taskTitle: string
  env: NodeJS.ProcessEnv
}

export interface MergeResult {
  success: boolean
  error?: string
  conflicts?: string[]
}

/**
 * Rebase agent branch onto origin/main.
 */
export async function rebaseOntoMain(
  worktreePath: string,
  env: NodeJS.ProcessEnv
): Promise<{ success: boolean; error?: string }> {
  try {
    logger.info(`[rebaseOntoMain] Fetching origin/main`)
    await execFileAsync('git', ['fetch', 'origin', 'main'], { cwd: worktreePath, env })

    logger.info(`[rebaseOntoMain] Rebasing onto origin/main`)
    await execFileAsync('git', ['rebase', 'origin/main'], { cwd: worktreePath, env })

    return { success: true }
  } catch (err: unknown) {
    const errMsg = getErrorMessage(err)
    logger.error(`[rebaseOntoMain] Rebase failed: ${errMsg}`)

    // Abort the rebase
    try {
      await execFileAsync('git', ['rebase', '--abort'], { cwd: worktreePath, env })
    } catch {
      /* best-effort abort */
    }

    return { success: false, error: errMsg }
  }
}

/**
 * Execute merge strategy (without rebase — caller handles that).
 */
export async function executeMergeStrategy(
  branch: string,
  repoPath: string,
  strategy: 'merge' | 'squash' | 'rebase',
  taskId: string,
  taskTitle: string,
  env: NodeJS.ProcessEnv
): Promise<MergeResult> {
  try {
    if (strategy === 'squash') {
      await execFileAsync('git', ['merge', '--squash', branch], { cwd: repoPath, env })
      try {
        await execFileAsync('git', ['commit', '-m', `${taskTitle} (#${taskId})`], {
          cwd: repoPath,
          env
        })
      } catch (commitErr: unknown) {
        logger.error(`[executeMergeStrategy] Squash commit failed, unstaging`)
        try {
          await execFileAsync('git', ['reset', 'HEAD'], { cwd: repoPath, env })
        } catch {
          logger.warn(`[executeMergeStrategy] git reset HEAD failed — manual cleanup required`)
        }
        throw commitErr
      }
    } else if (strategy === 'rebase') {
      await execFileAsync('git', ['rebase', 'HEAD', branch], { cwd: repoPath, env })
      await execFileAsync('git', ['merge', '--ff-only', branch], { cwd: repoPath, env })
    } else {
      await execFileAsync(
        'git',
        ['merge', '--no-ff', branch, '-m', `Merge: ${taskTitle} (#${taskId})`],
        { cwd: repoPath, env }
      )
    }
    return { success: true }
  } catch (err: unknown) {
    const errMsg = getErrorMessage(err)

    // Abort the failed merge/rebase
    try {
      if (strategy === 'rebase') {
        await execFileAsync('git', ['rebase', '--abort'], { cwd: repoPath, env })
      } else {
        await execFileAsync('git', ['merge', '--abort'], { cwd: repoPath, env })
      }
    } catch {
      /* abort is best-effort */
    }

    // Extract conflict file names
    const conflicts: string[] = []
    try {
      const { stdout: conflictOut } = await execFileAsync(
        'git',
        ['diff', '--name-only', '--diff-filter=U'],
        { cwd: repoPath, env }
      )
      conflicts.push(...conflictOut.trim().split('\n').filter(Boolean))
    } catch {
      /* best-effort */
    }

    return { success: false, conflicts, error: errMsg }
  }
}

/**
 * Merge agent branch into main repo using specified strategy.
 */
export async function mergeAgentBranch(options: MergeOptions): Promise<MergeResult> {
  const { worktreePath, branch, repoPath, strategy, taskId, taskTitle, env } = options

  // Verify clean working tree
  try {
    const { stdout: statusOut } = await execFileAsync('git', ['status', '--porcelain'], {
      cwd: repoPath,
      env
    })
    if (statusOut.trim()) {
      return {
        success: false,
        error: 'Working tree has uncommitted changes. Commit or stash them before merging.'
      }
    }
  } catch (err: unknown) {
    return { success: false, error: getErrorMessage(err) }
  }

  // Rebase agent branch onto origin/main
  const rebaseResult = await rebaseOntoMain(worktreePath, env)
  if (!rebaseResult.success) {
    return { success: false, error: `Rebase failed: ${rebaseResult.error}` }
  }

  // Execute merge
  const mergeResult = await executeMergeStrategy(branch, repoPath, strategy, taskId, taskTitle, env)
  if (!mergeResult.success) {
    return mergeResult
  }

  // Post-merge CSS dedup
  try {
    const dedupReport = await runPostMergeDedup(repoPath)
    if (dedupReport?.warnings.length) {
      logger.info(`[mergeAgentBranch] CSS dedup warnings: ${dedupReport.warnings.length}`)
    }
    return { success: true }
  } catch (err) {
    logger.warn(`[mergeAgentBranch] Post-merge dedup failed (non-fatal): ${err}`)
    return { success: true }
  }
}

/**
 * Clean up worktree and branch after merge/PR.
 */
export async function cleanupWorktree(
  worktreePath: string,
  branch: string,
  repoPath: string,
  env: NodeJS.ProcessEnv
): Promise<void> {
  try {
    await execFileAsync('git', ['worktree', 'remove', worktreePath, '--force'], {
      cwd: repoPath,
      env
    })
  } catch {
    /* best-effort cleanup */
  }

  try {
    await execFileAsync('git', ['branch', '-D', branch], { cwd: repoPath, env })
  } catch {
    /* best-effort cleanup */
  }
}
