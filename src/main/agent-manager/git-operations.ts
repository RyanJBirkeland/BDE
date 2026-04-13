/**
 * Shared git operation utilities for agent completion and code review.
 *
 * Consolidates rebase, push, and PR creation logic to avoid duplication
 * between completion.ts and review.ts.
 */
import { execFile as execFileCb } from 'node:child_process'
import { promisify } from 'node:util'
import type { Logger } from '../logger'
import { buildAgentEnv } from '../env-utils'
import { runPostMergeDedup } from '../services/post-merge-dedup'
import { getErrorMessage } from '../../shared/errors'

const execFile = promisify(execFileCb)

/**
 * Test artifact patterns to exclude from agent commits.
 * These paths are unstaged during auto-commit to prevent polluting the diff with test outputs.
 */
const GIT_ARTIFACT_PATTERNS = ['test-results/', 'coverage/', '*.log', 'playwright-report/'] as const

const PR_CREATE_MAX_ATTEMPTS = 3
const PR_CREATE_BACKOFF_MS = [3000, 8000]

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Parse git PR creation output to extract PR URL and number.
 */
function parsePrOutput(stdout: string): { prUrl: string | null; prNumber: number | null } {
  const urlMatch = stdout.match(/https:\/\/github\.com\/[^\s]+\/pull\/(\d+)/)
  if (!urlMatch) return { prUrl: null, prNumber: null }
  return { prUrl: urlMatch[0], prNumber: parseInt(urlMatch[1], 10) }
}

/**
 * Generate PR body with commit list and diff stats.
 */
export async function generatePrBody(
  worktreePath: string,
  branch: string,
  env: NodeJS.ProcessEnv
): Promise<string> {
  const sections: string[] = []

  try {
    const { stdout: log } = await execFile('git', ['log', '--oneline', `origin/main..${branch}`], {
      cwd: worktreePath,
      env
    })
    if (log.trim()) {
      sections.push(
        '## Commits\n' +
          log
            .trim()
            .split('\n')
            .map((l) => `- ${l}`)
            .join('\n')
      )
    }
  } catch {
    /* non-fatal */
  }

  try {
    const { stdout: stat } = await execFile('git', ['diff', '--stat', `origin/main..${branch}`], {
      cwd: worktreePath,
      env
    })
    if (stat.trim()) {
      sections.push('## Changes\n```\n' + stat.trim() + '\n```')
    }
  } catch {
    /* non-fatal */
  }

  sections.push('🤖 Automated by BDE Agent Manager')

  return sections.join('\n\n')
}

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
    await execFile('git', ['fetch', 'origin', 'main'], {
      cwd: worktreePath,
      env
    })

    logger.info(`[git-ops] rebasing onto origin/main`)
    await execFile('git', ['rebase', 'origin/main'], {
      cwd: worktreePath,
      env
    })

    const { stdout: shaOut } = await execFile('git', ['rev-parse', 'origin/main'], {
      cwd: worktreePath,
      env
    })

    logger.info(`[git-ops] rebase onto main succeeded`)
    return { success: true, baseSha: shaOut.trim() }
  } catch (err) {
    logger.warn(`[git-ops] rebase onto main failed: ${err}`)
    try {
      await execFile('git', ['rebase', '--abort'], {
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
    await execFile('git', ['push', '-u', 'origin', branch], { cwd: worktreePath, env })
    logger.info(`[git-ops] push succeeded`)
    return { success: true }
  } catch (err) {
    const errMsg = String(err)
    logger.error(`[git-ops] push failed: ${errMsg}`)
    return { success: false, error: errMsg }
  }
}

/**
 * Check if a PR already exists for the given branch.
 * Returns `{ prUrl, prNumber }` if found, `null` otherwise.
 */
export async function checkExistingPr(
  worktreePath: string,
  branch: string,
  env: NodeJS.ProcessEnv,
  logger: Logger
): Promise<{ prUrl: string; prNumber: number } | null> {
  try {
    const { stdout: listOut } = await execFile(
      'gh',
      ['pr', 'list', '--head', branch, '--json', 'url,number', '--jq', '.[0] | {url, number}'],
      { cwd: worktreePath, env }
    )
    const trimmed = listOut.trim()
    if (trimmed && trimmed !== 'null') {
      const existing = JSON.parse(trimmed)
      if (existing && existing.url && existing.number) {
        logger.info(`[git-ops] PR already exists for branch ${branch}: ${existing.url}`)
        return { prUrl: existing.url, prNumber: existing.number }
      }
    }
  } catch (err) {
    logger.warn(`[git-ops] Failed to check for existing PR on branch ${branch}: ${err}`)
  }
  return null
}

/**
 * Sanitize task title for use in git commit messages and PR titles.
 * Strips backticks, command substitution $(), and markdown links to prevent shell injection.
 */
export function sanitizeForGit(title: string): string {
  return title
    .replace(/`/g, "'")
    .replace(/\$\(/g, '(')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .trim()
}

/**
 * Create a new PR via `gh pr create`. Handles the race condition where a PR
 * was created between the check and create calls by falling back to a fetch.
 * Returns `{ prUrl, prNumber }` (either may be null if creation failed).
 *
 * @param customBody - Optional custom PR body. If not provided, generates body from git log/diff.
 */
export async function createNewPr(
  worktreePath: string,
  branch: string,
  title: string,
  ghRepo: string,
  env: NodeJS.ProcessEnv,
  logger: Logger,
  customBody?: string
): Promise<{ prUrl: string | null; prNumber: number | null }> {
  let prUrl: string | null = null
  let prNumber: number | null = null
  let lastError: unknown = null

  const body = customBody ?? (await generatePrBody(worktreePath, branch, env))

  for (let attempt = 0; attempt < PR_CREATE_MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      const delayMs =
        PR_CREATE_BACKOFF_MS[attempt - 1] ?? PR_CREATE_BACKOFF_MS[PR_CREATE_BACKOFF_MS.length - 1]
      logger.info(
        `[git-ops] Retrying PR creation for branch ${branch} (attempt ${attempt + 1}/${PR_CREATE_MAX_ATTEMPTS}) after ${delayMs}ms`
      )
      await sleep(delayMs)
    }

    try {
      const sanitizedTitle = sanitizeForGit(title)
      const { stdout: prOut } = await execFile(
        'gh',
        [
          'pr',
          'create',
          '--title',
          sanitizedTitle,
          '--body',
          body,
          '--head',
          branch,
          '--repo',
          ghRepo
        ],
        { cwd: worktreePath, env }
      )
      const parsed = parsePrOutput(prOut)
      prUrl = parsed.prUrl
      prNumber = parsed.prNumber
      logger.info(`[git-ops] created new PR ${prUrl}`)
      return { prUrl, prNumber }
    } catch (err) {
      lastError = err
      const errMsg = String(err)

      if (errMsg.includes('already exists') || errMsg.includes('pull request already exists')) {
        logger.info(`[git-ops] PR creation failed because one already exists, fetching existing PR`)
        const existing = await checkExistingPr(worktreePath, branch, env, logger)
        if (existing) {
          return { prUrl: existing.prUrl, prNumber: existing.prNumber }
        }
      }

      logger.warn(
        `[git-ops] gh pr create attempt ${attempt + 1}/${PR_CREATE_MAX_ATTEMPTS} failed: ${err}`
      )
    }
  }

  logger.warn(
    `[git-ops] PR creation failed after ${PR_CREATE_MAX_ATTEMPTS} attempts for branch ${branch}: ${lastError}`
  )
  return { prUrl: null, prNumber: null }
}

/**
 * Find existing PR or create a new one for the given branch.
 * Exported for use by completion and review flows.
 */
export async function findOrCreatePR(
  worktreePath: string,
  branch: string,
  title: string,
  ghRepo: string,
  env: NodeJS.ProcessEnv,
  logger: Logger
): Promise<{ prUrl: string | null; prNumber: number | null }> {
  const existing = await checkExistingPr(worktreePath, branch, env, logger)
  if (existing) return existing

  return createNewPr(worktreePath, branch, title, ghRepo, env, logger)
}

/**
 * List all worktrees in porcelain format.
 * Returns stdout containing worktree metadata.
 */
export async function listWorktrees(repoPath: string, env: NodeJS.ProcessEnv): Promise<string> {
  const { stdout } = await execFile('git', ['worktree', 'list', '--porcelain'], {
    cwd: repoPath,
    env
  })
  return stdout
}

/**
 * Remove a worktree forcefully.
 */
export async function removeWorktreeForce(
  repoPath: string,
  worktreePath: string,
  env: NodeJS.ProcessEnv
): Promise<void> {
  await execFile('git', ['worktree', 'remove', '--force', worktreePath], {
    cwd: repoPath,
    env
  })
}

/**
 * Prune stale worktree administrative files.
 */
export async function pruneWorktrees(repoPath: string, env: NodeJS.ProcessEnv): Promise<void> {
  await execFile('git', ['worktree', 'prune'], { cwd: repoPath, env })
}

/**
 * Delete a branch forcefully (git branch -D).
 */
export async function deleteBranch(
  repoPath: string,
  branch: string,
  env: NodeJS.ProcessEnv
): Promise<void> {
  await execFile('git', ['branch', '-D', branch], { cwd: repoPath, env })
}

/**
 * Force delete a branch ref directly (bypasses worktree-in-use check).
 */
export async function forceDeleteBranchRef(
  repoPath: string,
  branch: string,
  env: NodeJS.ProcessEnv
): Promise<void> {
  await execFile('git', ['update-ref', '-d', `refs/heads/${branch}`], {
    cwd: repoPath,
    env
  })
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
  await execFile('git', ['fetch', 'origin', 'main', '--no-tags'], {
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
  await execFile('git', ['merge', '--ff-only', 'origin/main'], {
    cwd: repoPath,
    env,
    timeout: timeoutMs
  })
  logger.info(`[git-ops] Fast-forward merged origin/main`)
}

/**
 * Create a new worktree with a new branch.
 */
export async function addWorktree(
  repoPath: string,
  branch: string,
  worktreePath: string,
  env: NodeJS.ProcessEnv
): Promise<void> {
  await execFile('git', ['worktree', 'add', '-b', branch, worktreePath], {
    cwd: repoPath,
    env
  })
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
  const { stdout: statusOut } = await execFile('git', ['status', '--porcelain'], {
    cwd: worktreePath,
    env
  })
  if (statusOut.trim()) {
    logger.info(`[completion] auto-committing uncommitted changes`)
    // Use -A to capture new (untracked) files created by agents, not just modifications.
    // The repo's .gitignore excludes node_modules, .env, etc.
    await execFile('git', ['add', '-A'], { cwd: worktreePath, env })

    // Unstage test artifacts that may have been previously tracked
    for (const path of GIT_ARTIFACT_PATTERNS) {
      try {
        await execFile('git', ['rm', '-r', '--cached', '--ignore-unmatch', path], {
          cwd: worktreePath,
          env
        })
      } catch (err) {
        // Non-fatal — artifact may not exist or not be tracked
        logger.info(`[completion] artifact cleanup failed for ${path}: ${getErrorMessage(err)}`)
      }
    }

    // Re-check if staged changes remain (unstaging may have removed everything)
    const { stdout: stagedOut } = await execFile('git', ['diff', '--cached', '--name-only'], {
      cwd: worktreePath,
      env
    })

    if (!stagedOut.trim()) {
      logger.info(`[completion] no staged changes after unstaging test artifacts — skipping commit`)
      return
    }

    const sanitizedTitle = sanitizeForGit(title)
    await execFile(
      'git',
      ['commit', '-m', `${sanitizedTitle}\n\nAutomated commit by BDE agent manager`],
      {
        cwd: worktreePath,
        env
      }
    )
  }
}

/**
 * Clean up worktree and branch after merge or discard.
 * Best-effort cleanup — does not throw on failure.
 */
export async function cleanupWorktreeAndBranch(
  worktreePath: string,
  branch: string,
  repoPath: string,
  logger: Logger
): Promise<void> {
  const env = buildAgentEnv()
  try {
    await execFile('git', ['worktree', 'remove', worktreePath, '--force'], {
      cwd: repoPath,
      env
    })
  } catch (err) {
    logger.warn(`[completion] Failed to remove worktree ${worktreePath}: ${err}`)
  }

  try {
    await execFile('git', ['branch', '-D', branch], {
      cwd: repoPath,
      env
    })
  } catch (err) {
    logger.warn(`[completion] Failed to delete branch ${branch}: ${err}`)
  }
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
  const { stdout: statusOut } = await execFile('git', ['status', '--porcelain'], {
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
    await execFile('git', ['merge', '--squash', branch], {
      cwd: repoPath,
      env
    })
    await execFile('git', ['commit', '-m', `${sanitizeForGit(title)} (#${taskId})`], {
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
      await execFile('git', ['merge', '--abort'], {
        cwd: repoPath,
        env
      })
    } catch {
      /* best-effort */
    }
    return 'failed'
  }
}
