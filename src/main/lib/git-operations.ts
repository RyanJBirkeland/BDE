/**
 * Git operations on branches and commits — rebase, push, fetch, merge, commit.
 *
 * Re-exports PR operations (pr-operations.ts) and worktree lifecycle
 * (worktree-lifecycle.ts) for backward compatibility with existing callers.
 */
import type { Logger } from '../logger'
import { execFileAsync } from './async-utils'
import { buildAgentEnv } from '../env-utils'
import { runPostMergeDedup } from './post-merge-dedup'
import { getErrorMessage } from '../../shared/errors'
import { sanitizeForGit } from '../agent-manager/pr-operations'
import { cleanupWorktreeAndBranch } from '../agent-manager/worktree-lifecycle'

// Re-export PR operations for backward compatibility
export {
  generatePrBody,
  sanitizeForGit,
  checkExistingPr,
  createNewPr,
  findOrCreatePR
} from '../agent-manager/pr-operations'

// Re-export worktree lifecycle for backward compatibility
export {
  listWorktrees,
  removeWorktreeForce,
  pruneWorktrees,
  deleteBranch,
  forceDeleteBranchRef,
  addWorktree,
  cleanupWorktreeAndBranch
} from '../agent-manager/worktree-lifecycle'

/**
 * Test artifact patterns to exclude from agent commits.
 * These paths are unstaged during auto-commit to prevent polluting the diff with test outputs.
 */
const GIT_ARTIFACT_PATTERNS = ['test-results/', 'coverage/', '*.log', 'playwright-report/'] as const

/**
 * Rebase the agent's branch onto origin/main to ensure it's up-to-date.
 * Returns { success: true, baseSha } if rebase succeeds, { success: false, notes: string } if it fails.
 */
export async function rebaseOntoMain(
  worktreePath: string,
  env: NodeJS.ProcessEnv,
  logger: Logger
): Promise<{ success: boolean; notes?: string; baseSha?: string }> {
  try {
    logger.info(`[git-ops] fetching origin/main for rebase`)
    await execFileAsync('git', ['fetch', 'origin', 'main'], {
      cwd: worktreePath,
      env
    })

    logger.info(`[git-ops] rebasing onto origin/main`)
    await execFileAsync('git', ['rebase', 'origin/main'], {
      cwd: worktreePath,
      env
    })

    const { stdout: shaOut } = await execFileAsync('git', ['rev-parse', 'origin/main'], {
      cwd: worktreePath,
      env
    })

    logger.info(`[git-ops] rebase onto main succeeded`)
    return { success: true, baseSha: shaOut.trim() }
  } catch (err) {
    logger.warn(`[git-ops] rebase onto main failed: ${err}`)
    try {
      await execFileAsync('git', ['rebase', '--abort'], {
        cwd: worktreePath,
        env
      })
      logger.info(`[git-ops] rebase aborted successfully`)
    } catch (abortErr) {
      logger.error(`[git-ops] failed to abort rebase: ${abortErr}`)
    }

    return {
      success: false,
      notes: 'Rebase onto main failed — manual conflict resolution needed.'
    }
  }
}

/**
 * Push branch to origin with upstream tracking.
 */
export async function pushBranch(
  worktreePath: string,
  branch: string,
  env: NodeJS.ProcessEnv,
  logger: Logger
): Promise<{ success: boolean; error?: string }> {
  try {
    logger.info(`[git-ops] pushing branch ${branch}`)
    await execFileAsync('git', ['push', '-u', 'origin', branch], { cwd: worktreePath, env })
    logger.info(`[git-ops] push succeeded`)
    return { success: true }
  } catch (err) {
    const errMsg = String(err)
    logger.error(`[git-ops] push failed: ${errMsg}`)
    return { success: false, error: errMsg }
  }
}

/**
 * Fetch origin/main with optional timeout.
 */
export async function fetchMain(
  repoPath: string,
  env: NodeJS.ProcessEnv,
  logger: Logger,
  timeoutMs = 30000
): Promise<void> {
  await execFileAsync('git', ['fetch', 'origin', 'main', '--no-tags'], {
    cwd: repoPath,
    env,
    timeout: timeoutMs
  })
  logger.info(`[git-ops] Fetched origin/main`)
}

/**
 * Fast-forward merge origin/main into current branch.
 */
export async function ffMergeMain(
  repoPath: string,
  env: NodeJS.ProcessEnv,
  logger: Logger,
  timeoutMs = 10000
): Promise<void> {
  await execFileAsync('git', ['merge', '--ff-only', 'origin/main'], {
    cwd: repoPath,
    env,
    timeout: timeoutMs
  })
  logger.info(`[git-ops] Fast-forward merged origin/main`)
}

/**
 * Stages all changes (git add -A), then unstages known test artifact paths.
 * Returns true if there are staged changes remaining after cleanup, false otherwise.
 */
async function stageWithArtifactCleanup(
  worktreePath: string,
  env: NodeJS.ProcessEnv,
  logger: Logger
): Promise<boolean> {
  // Use -A to capture new (untracked) files created by agents, not just modifications.
  // The repo's .gitignore excludes node_modules, .env, etc.
  await execFileAsync('git', ['add', '-A'], { cwd: worktreePath, env })

  // Unstage test artifacts that may have been previously tracked
  for (const path of GIT_ARTIFACT_PATTERNS) {
    try {
      await execFileAsync('git', ['rm', '-r', '--cached', '--ignore-unmatch', path], {
        cwd: worktreePath,
        env
      })
    } catch (err) {
      // Non-fatal — artifact may not exist or not be tracked
      logger.info(`[completion] artifact cleanup failed for ${path}: ${getErrorMessage(err)}`)
    }
  }

  // Re-check if staged changes remain (unstaging may have removed everything)
  const { stdout: stagedOut } = await execFileAsync('git', ['diff', '--cached', '--name-only'], {
    cwd: worktreePath,
    env
  })

  return stagedOut.trim().length > 0
}

/**
 * Auto-commit any uncommitted changes in the worktree.
 * Uses -A to capture new (untracked) files. Unstages test artifact paths before committing.
 */
export async function autoCommitIfDirty(
  worktreePath: string,
  title: string,
  logger: Logger
): Promise<void> {
  const env = buildAgentEnv()
  const { stdout: statusOut } = await execFileAsync('git', ['status', '--porcelain'], {
    cwd: worktreePath,
    env
  })
  if (!statusOut.trim()) return

  logger.info(`[completion] auto-committing uncommitted changes`)
  const hasChanges = await stageWithArtifactCleanup(worktreePath, env, logger)

  if (!hasChanges) {
    logger.info(`[completion] no staged changes after unstaging test artifacts — skipping commit`)
    return
  }

  const sanitizedTitle = sanitizeForGit(title)
  await execFileAsync(
    'git',
    ['commit', '-m', `${sanitizedTitle}\n\nAutomated commit by BDE agent manager`],
    {
      cwd: worktreePath,
      env
    }
  )
}

export interface SquashMergeOpts {
  taskId: string
  branch: string
  worktreePath: string
  repoPath: string
  title: string
  logger: Logger
}

/**
 * Execute squash merge of agent branch into main repo.
 * Returns 'merged' on success, 'dirty-main' if main has uncommitted changes, 'failed' on merge error.
 * Task state updates are the caller's responsibility.
 */
export async function executeSquashMerge(
  opts: SquashMergeOpts
): Promise<'merged' | 'dirty-main' | 'failed'> {
  const { taskId, branch, worktreePath, repoPath, title, logger } = opts
  const env = buildAgentEnv()
  const { stdout: statusOut } = await execFileAsync('git', ['status', '--porcelain'], {
    cwd: repoPath,
    env
  })
  if (statusOut.trim()) {
    logger.warn(
      `[completion] Skipping auto-merge: main repo has uncommitted changes`
    )
    return 'dirty-main'
  }

  try {
    await execFileAsync('git', ['merge', '--squash', branch], {
      cwd: repoPath,
      env
    })
    await execFileAsync('git', ['commit', '-m', `${sanitizeForGit(title)} (#${taskId})`], {
      cwd: repoPath,
      env
    })

    try {
      await runPostMergeDedup(repoPath)
    } catch {
      // Non-fatal
    }

    await cleanupWorktreeAndBranch(worktreePath, branch, repoPath, logger)

    return 'merged'
  } catch (mergeErr) {
    logger.error(
      `[completion] Auto-merge failed: ${mergeErr} — task remains in review`
    )
    try {
      await execFileAsync('git', ['merge', '--abort'], {
        cwd: repoPath,
        env
      })
    } catch {
      /* best-effort */
    }
    return 'failed'
  }
}
