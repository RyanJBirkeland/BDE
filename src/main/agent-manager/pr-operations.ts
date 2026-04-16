/**
 * PR find/create operations for agent branches.
 *
 * Handles checking for existing PRs and creating new ones via gh CLI,
 * including retry logic and race-condition handling.
 */
import type { Logger } from '../logger'
import { execFileAsync, sleep } from '../lib/async-utils'
import { validateGitRef } from '../lib/review-paths'
import { broadcast } from '../broadcast'

const PR_CREATE_MAX_ATTEMPTS = 3
const PR_CREATE_BACKOFF_MS = [3000, 8000]

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
  validateGitRef(branch)
  const sections: string[] = []

  try {
    const { stdout: log } = await execFileAsync('git', ['log', '--oneline', `origin/main..${branch}`], {
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
    const { stdout: stat } = await execFileAsync('git', ['diff', '--stat', `origin/main..${branch}`], {
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
 * Sanitize task title for use in git commit messages and PR titles.
 * Strips backticks, command substitution $(), markdown links, and newlines.
 * Newline removal prevents git trailer injection (e.g. Co-Authored-By: attacker) via
 * crafted task titles. execFileAsync array arguments already prevent shell injection;
 * this guards against git-level metadata manipulation.
 */
export function sanitizeForGit(title: string): string {
  return title
    .replace(/\r?\n|\r/g, ' ')
    .replace(/`/g, "'")
    .replace(/\$\(/g, '(')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .trim()
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
    const { stdout: listOut } = await execFileAsync(
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
      const { stdout: prOut } = await execFileAsync(
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

  const failureMsg =
    `PR creation failed after ${PR_CREATE_MAX_ATTEMPTS} attempts for branch ${branch}. ` +
    `Run \`gh auth status\` to verify GitHub CLI authentication. Check ~/.bde/bde.log for details.`
  logger.warn(`[git-ops] ${failureMsg}: ${lastError}`)
  broadcast('manager:warning', { message: failureMsg })
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
