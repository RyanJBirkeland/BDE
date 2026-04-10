/**
 * Review PR service — handles pull request creation for code review.
 *
 * Provides branch push and GitHub PR creation via gh CLI.
 */
import { execFile } from 'child_process'
import { promisify } from 'util'
import { createLogger } from '../logger'

const execFileAsync = promisify(execFile)
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
  prUrl?: string
  prNumber?: number
  error?: string
}

/**
 * Push branch to origin and create GitHub PR.
 */
export async function createPullRequest(options: CreatePROptions): Promise<CreatePRResult> {
  const { worktreePath, branch, title, body, env } = options

  try {
    // Push the branch
    logger.info(`[createPullRequest] Pushing branch ${branch}`)
    await execFileAsync('git', ['push', '-u', 'origin', branch], { cwd: worktreePath, env })

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
    const prNumber = prNumberMatch ? parseInt(prNumberMatch[1], 10) : undefined

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
