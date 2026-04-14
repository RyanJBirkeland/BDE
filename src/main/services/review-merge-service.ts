/**
 * Review merge service — handles local merge operations for code review.
 *
 * Provides rebase, merge strategies, conflict handling, and cleanup.
 */
import { execFileAsync } from '../lib/async-utils'
import { createLogger } from '../logger'
import { getErrorMessage } from '../../shared/errors'
import { runPostMergeDedup } from '../lib/post-merge-dedup'
import { rebaseOntoMain } from '../lib/git-operations'

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
 * Extract conflict file paths from git diff.
 * Returns empty array on failure (with optional warning log).
 */
export async function extractConflictFiles(
  cwd: string,
  env: NodeJS.ProcessEnv,
  loggerInstance?: ReturnType<typeof createLogger>
): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync('git', ['diff', '--name-only', '--diff-filter=U'], {
      cwd,
      env
    })
    return stdout.trim().split('\n').filter(Boolean)
  } catch (err: unknown) {
    loggerInstance?.warn(`Failed to extract conflict files: ${getErrorMessage(err)}`)
    return []
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
      // Idempotent retry: if every commit on the branch already has a
      // patch-equivalent on HEAD, the squash was done in a prior attempt
      // (e.g., push failed afterwards, commit is sitting on local main).
      // Skip merge --squash / commit and let the caller push the existing
      // commit. `git cherry HEAD branch` prefixes applied commits with `-`
      // and unapplied ones with `+`; if there are no `+` lines, we're done.
      const { stdout: cherryOut } = await execFileAsync('git', ['cherry', 'HEAD', branch], {
        cwd: repoPath,
        env
      })
      const hasNewCommits = cherryOut.split('\n').some((line) => line.trim().startsWith('+'))
      if (!hasNewCommits) {
        logger.info(
          `[executeMergeStrategy] Branch ${branch} is already patch-merged into HEAD — skipping squash`
        )
        return { success: true }
      }

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
    const conflicts = await extractConflictFiles(repoPath, env, logger)

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
  const rebaseResult = await rebaseOntoMain(worktreePath, env, logger)
  if (!rebaseResult.success) {
    return { success: false, error: `Rebase failed: ${rebaseResult.notes}` }
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

/**
 * Parse git numstat output into structured file change data.
 */
export function parseNumstat(
  numstat: string,
  patchMap: Map<string, string>
): Array<{ path: string; status: string; additions: number; deletions: number; patch: string }> {
  return numstat
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const parts = line.split('\t')
      const additions = parts[0] === '-' ? 0 : parseInt(parts[0], 10)
      const deletions = parts[1] === '-' ? 0 : parseInt(parts[1], 10)
      const filePath = parts.slice(2).join('\t')
      const status =
        additions > 0 && deletions > 0 ? 'modified' : additions > 0 ? 'added' : 'deleted'
      return {
        path: filePath,
        status,
        additions,
        deletions,
        patch: patchMap.get(filePath) ?? ''
      }
    })
}
