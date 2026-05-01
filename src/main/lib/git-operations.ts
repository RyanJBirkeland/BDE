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
import { getMainRepoPorcelainStatus } from './main-repo-guards'
import { resolveDefaultBranch } from './default-branch'

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
 * Rebase the agent's branch onto the repo's default branch (origin/<default>) to
 * ensure it's up-to-date. Returns { success: true, baseSha } on success,
 * { success: false, notes } on failure.
 */
export async function rebaseOntoMain(
  worktreePath: string,
  env: NodeJS.ProcessEnv,
  logger: Logger
): Promise<{ success: boolean; notes?: string; baseSha?: string }> {
  const defaultBranch = await resolveDefaultBranch(worktreePath)
  const upstream = `origin/${defaultBranch}`
  try {
    logger.info(`[git-ops] fetching ${upstream} for rebase`)
    await execFileAsync('git', ['fetch', 'origin', defaultBranch], {
      cwd: worktreePath,
      env
    })

    logger.info(`[git-ops] rebasing onto ${upstream}`)
    await execFileAsync('git', ['rebase', upstream], {
      cwd: worktreePath,
      env
    })

    const { stdout: shaOut } = await execFileAsync('git', ['rev-parse', upstream], {
      cwd: worktreePath,
      env
    })

    logger.info(`[git-ops] rebase onto ${defaultBranch} succeeded`)
    return { success: true, baseSha: shaOut.trim() }
  } catch (err) {
    logger.warn(`[git-ops] rebase onto ${defaultBranch} failed: ${err}`)
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
      notes: `Rebase onto ${defaultBranch} failed — manual conflict resolution needed.`
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
 * Fetch the repo's default branch (origin/<default>) with optional timeout.
 */
export async function fetchMain(
  repoPath: string,
  env: NodeJS.ProcessEnv,
  logger: Logger,
  timeoutMs = 30000
): Promise<void> {
  const defaultBranch = await resolveDefaultBranch(repoPath)
  await execFileAsync('git', ['fetch', 'origin', defaultBranch, '--no-tags'], {
    cwd: repoPath,
    env,
    timeout: timeoutMs
  })
  logger.info(`[git-ops] Fetched origin/${defaultBranch}`)
}

/**
 * Fast-forward merge origin/<default-branch> into current branch.
 */
export async function ffMergeMain(
  repoPath: string,
  env: NodeJS.ProcessEnv,
  logger: Logger,
  timeoutMs = 10000
): Promise<void> {
  const defaultBranch = await resolveDefaultBranch(repoPath)
  await execFileAsync('git', ['merge', '--ff-only', `origin/${defaultBranch}`], {
    cwd: repoPath,
    env,
    timeout: timeoutMs
  })
  logger.info(`[git-ops] Fast-forward merged origin/${defaultBranch}`)
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
  commitMessage: string,
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

  await execFileAsync('git', ['commit', '-m', commitMessage], {
    cwd: worktreePath,
    env
  })
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
/**
 * Best-effort rollback pair used when a merge or commit inside
 * executeSquashMerge fails mid-sequence. Any stray MERGE_HEAD or staged
 * modification left in the main repo is the exact failure mode that lets
 * agent edits leak into the main working tree, so we always try both steps
 * regardless of which step failed.
 */
async function abortAndReset(
  repoPath: string,
  env: Record<string, string | undefined>
): Promise<void> {
  try {
    await execFileAsync('git', ['merge', '--abort'], { cwd: repoPath, env })
  } catch {
    /* best-effort */
  }
  try {
    await execFileAsync('git', ['reset', '--hard', 'HEAD'], { cwd: repoPath, env })
  } catch {
    /* best-effort */
  }
}

export async function executeSquashMerge(
  opts: SquashMergeOpts
): Promise<'merged' | 'dirty-main' | 'failed'> {
  const { taskId, branch, worktreePath, repoPath, title, logger } = opts
  const env = buildAgentEnv()
  const preStatus = await getMainRepoPorcelainStatus(repoPath, env)
  if (preStatus) {
    logger.warn(`[completion] Skipping auto-merge: main repo has uncommitted changes`)
    return 'dirty-main'
  }

  try {
    await execFileAsync('git', ['merge', '--squash', '--no-commit', branch], {
      cwd: repoPath,
      env
    })
  } catch (mergeErr) {
    logger.error(`[completion] Auto-merge squash failed: ${mergeErr} — rolling back main repo`)
    await abortAndReset(repoPath, env)
    return 'failed'
  }

  try {
    await execFileAsync('git', ['commit', '-m', `${sanitizeForGit(title)} (#${taskId})`], {
      cwd: repoPath,
      env
    })
  } catch (commitErr) {
    logger.error(`[completion] Auto-merge commit failed: ${commitErr} — rolling back main repo`)
    await abortAndReset(repoPath, env)
    return 'failed'
  }

  // Commit succeeded — verify the main repo is clean. A dirty main here means
  // residual untracked/unstaged files that should not have survived the commit,
  // which is worth logging but not worth rolling back: the merge commit itself
  // is a valid history and backing it out would just create a different kind of
  // mess. Surface it loudly so an operator can investigate.
  try {
    const postStatus = await getMainRepoPorcelainStatus(repoPath, env)
    if (postStatus) {
      logger.error(
        `[completion] Main repo dirty after successful auto-merge commit — inspect manually:\n${postStatus}`
      )
    }
  } catch (statusErr) {
    logger.warn(`[completion] Post-commit status check failed: ${statusErr}`)
  }

  try {
    await runPostMergeDedup(repoPath)
  } catch {
    // Non-fatal
  }

  await cleanupWorktreeAndBranch(worktreePath, branch, repoPath, logger)

  return 'merged'
}
