/**
 * Review PR service — handles pull request creation for code review.
 *
 * Provides branch push and GitHub PR creation via gh CLI.
 */
import { execFileAsync } from '../lib/async-utils'
import { createLogger } from '../logger'
import { pushBranch, checkExistingPr } from '../lib/git-operations'

const logger = createLogger('review-pr-service')

export interface CreatePROptions {
  worktreePath: string
  branch: string
  title: string
  body: string
  env: NodeJS.ProcessEnv
}

export interface CreatePRResult {
  success: boolean
  prUrl?: string | undefined
  prNumber?: number | undefined
  error?: string | undefined
}

/**
 * Push branch to origin and create GitHub PR (or return existing PR).
 */
export async function createPullRequest(options: CreatePROptions): Promise<CreatePRResult> {
  const { worktreePath, branch, title, body, env } = options

  try {
    // Push the branch
    logger.info(`[createPullRequest] Pushing branch ${branch}`)
    const pushResult = await pushBranch(worktreePath, branch, env, logger)
    if (!pushResult.success) {
      return {
        success: false,
        error: pushResult.error || 'Push failed'
      }
    }

    // Check for existing PR
    logger.info(`[createPullRequest] Checking for existing PR for ${branch}`)
    const existing = await checkExistingPr(worktreePath, branch, env, logger)
    if (existing) {
      logger.info(`[createPullRequest] Found existing PR #${existing.prNumber}: ${existing.prUrl}`)
      return {
        success: true,
        prUrl: existing.prUrl,
        prNumber: existing.prNumber
      }
    }

    // Create PR via gh CLI
    logger.info(`[createPullRequest] Creating PR for ${branch}`)
    const { stdout: prUrl } = await execFileAsync(
      'gh',
      ['pr', 'create', '--title', title, '--body', body, '--head', branch],
      { cwd: worktreePath, env }
    )
    const trimmedPrUrl = prUrl.trim()

    // Extract PR number from URL (e.g., https://github.com/owner/repo/pull/123)
    const prNumberMatch = trimmedPrUrl.match(/\/pull\/(\d+)$/)
    const prNumber = prNumberMatch?.[1] ? parseInt(prNumberMatch[1], 10) : undefined

    logger.info(`[createPullRequest] Created PR #${prNumber}: ${trimmedPrUrl}`)

    return {
      success: true,
      prUrl: trimmedPrUrl,
      prNumber
    }
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err)
    logger.error(`[createPullRequest] Failed: ${errMsg}`)
    return {
      success: false,
      error: errMsg
    }
  }
}
