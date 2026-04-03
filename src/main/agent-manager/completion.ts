import { execFile as execFileCb } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import type { ISprintTaskRepository } from '../data/sprint-task-repository'
import { buildAgentEnv } from '../env-utils'
import { MAX_RETRIES, AGENT_SUMMARY_MAX_LENGTH } from './types'
import type { Logger } from './types'
import { broadcast } from '../broadcast'
import type { AgentEvent } from '../../shared/types'

const execFile = promisify(execFileCb)

const PR_CREATE_MAX_ATTEMPTS = 3
const PR_CREATE_BACKOFF_MS = [3000, 8000]

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Sanitize task title for use in git commit messages and PR titles.
 * Strips backticks, command substitution $(), and markdown links to prevent shell injection.
 */
export function sanitizeForGit(title: string): string {
  return title
    .replace(/`/g, "'") // Replace backticks with single quotes
    .replace(/\$\(/g, '$(') // Escape command substitution (note: still visible but not executable in git commit -m)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Strip markdown links, keep text only
    .trim()
}

export interface ResolveSuccessOpts {
  taskId: string
  worktreePath: string
  title: string
  ghRepo: string
  onTaskTerminal: (taskId: string, status: string) => Promise<void>
  agentSummary?: string | null
  retryCount: number
  repo: ISprintTaskRepository
}

export interface ResolveFailureOpts {
  taskId: string
  retryCount: number
  notes?: string
  repo: ISprintTaskRepository
}

function parsePrOutput(stdout: string): { prUrl: string | null; prNumber: number | null } {
  // gh pr create outputs the PR URL as the last line, e.g.:
  // https://github.com/owner/repo/pull/42
  const urlMatch = stdout.match(/https:\/\/github\.com\/[^\s]+\/pull\/(\d+)/)
  if (!urlMatch) return { prUrl: null, prNumber: null }
  return { prUrl: urlMatch[0], prNumber: parseInt(urlMatch[1], 10) }
}

async function generatePrBody(worktreePath: string, branch: string): Promise<string> {
  const env = buildAgentEnv()
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

async function detectBranch(worktreePath: string): Promise<string> {
  const { stdout } = await execFile('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd: worktreePath,
    env: buildAgentEnv()
  })
  return stdout.trim()
}

async function autoCommitIfDirty(
  worktreePath: string,
  title: string,
  logger: Logger
): Promise<void> {
  const { stdout: statusOut } = await execFile('git', ['status', '--porcelain'], {
    cwd: worktreePath,
    env: buildAgentEnv()
  })
  if (statusOut.trim()) {
    logger.info(`[completion] auto-committing uncommitted changes`)
    // Use -A to capture new (untracked) files created by agents, not just modifications.
    // The repo's .gitignore excludes node_modules, .env, etc.
    await execFile('git', ['add', '-A'], { cwd: worktreePath, env: buildAgentEnv() })
    const sanitizedTitle = sanitizeForGit(title)
    await execFile(
      'git',
      ['commit', '-m', `${sanitizedTitle}\n\nAutomated commit by BDE agent manager`],
      {
        cwd: worktreePath,
        env: buildAgentEnv()
      }
    )
  }
}

/**
 * Check if a PR already exists for the given branch.
 * Returns `{ prUrl, prNumber }` if found, `null` otherwise.
 */
async function checkExistingPr(
  worktreePath: string,
  branch: string,
  logger: Logger
): Promise<{ prUrl: string; prNumber: number } | null> {
  try {
    const { stdout: listOut } = await execFile(
      'gh',
      ['pr', 'list', '--head', branch, '--json', 'url,number', '--jq', '.[0] | {url, number}'],
      { cwd: worktreePath, env: buildAgentEnv() }
    )
    const trimmed = listOut.trim()
    if (trimmed && trimmed !== 'null') {
      const existing = JSON.parse(trimmed)
      if (existing && existing.url && existing.number) {
        logger.info(`[completion] PR already exists for branch ${branch}: ${existing.url}`)
        return { prUrl: existing.url, prNumber: existing.number }
      }
    }
  } catch (err) {
    logger.warn(`[completion] Failed to check for existing PR on branch ${branch}: ${err}`)
  }
  return null
}

/**
 * Create a new PR via `gh pr create`. Handles the race condition where a PR
 * was created between the check and create calls by falling back to a fetch.
 * Returns `{ prUrl, prNumber }` (either may be null if creation failed).
 */
async function createNewPr(
  worktreePath: string,
  branch: string,
  title: string,
  ghRepo: string,
  logger: Logger
): Promise<{ prUrl: string | null; prNumber: number | null }> {
  let prUrl: string | null = null
  let prNumber: number | null = null
  let lastError: unknown = null

  const body = await generatePrBody(worktreePath, branch)

  for (let attempt = 0; attempt < PR_CREATE_MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      const delayMs =
        PR_CREATE_BACKOFF_MS[attempt - 1] ?? PR_CREATE_BACKOFF_MS[PR_CREATE_BACKOFF_MS.length - 1]
      logger.info(
        `[completion] Retrying PR creation for branch ${branch} (attempt ${attempt + 1}/${PR_CREATE_MAX_ATTEMPTS}) after ${delayMs}ms`
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
        { cwd: worktreePath, env: buildAgentEnv() }
      )
      const parsed = parsePrOutput(prOut)
      prUrl = parsed.prUrl
      prNumber = parsed.prNumber
      logger.info(`[completion] created new PR ${prUrl}`)
      return { prUrl, prNumber }
    } catch (err) {
      lastError = err
      const errMsg = String(err)

      // If PR creation failed because one already exists (race condition), fetch it immediately — no retry needed
      if (errMsg.includes('already exists') || errMsg.includes('pull request already exists')) {
        logger.info(
          `[completion] PR creation failed because one already exists, fetching existing PR`
        )
        const existing = await checkExistingPr(worktreePath, branch, logger)
        if (existing) {
          return { prUrl: existing.prUrl, prNumber: existing.prNumber }
        }
      }

      logger.warn(
        `[completion] gh pr create attempt ${attempt + 1}/${PR_CREATE_MAX_ATTEMPTS} failed: ${err}`
      )
    }
  }

  logger.warn(
    `[completion] PR creation failed after ${PR_CREATE_MAX_ATTEMPTS} attempts for branch ${branch}: ${lastError}`
  )
  return { prUrl: null, prNumber: null }
}

/** Exported for use by the review-approve-push flow (push + PR creation deferred from agent completion). */
export async function findOrCreatePR(
  worktreePath: string,
  branch: string,
  title: string,
  ghRepo: string,
  logger: Logger
): Promise<{ prUrl: string | null; prNumber: number | null }> {
  const existing = await checkExistingPr(worktreePath, branch, logger)
  if (existing) return existing

  return createNewPr(worktreePath, branch, title, ghRepo, logger)
}

export async function resolveSuccess(opts: ResolveSuccessOpts, logger: Logger): Promise<void> {
  const { taskId, worktreePath, title, onTaskTerminal, agentSummary, retryCount, repo } = opts

  // 0. Guard: worktree must still exist (macOS /tmp can evict it)
  if (!existsSync(worktreePath)) {
    logger.error(`[completion] Worktree path no longer exists for task ${taskId}: ${worktreePath}`)
    // Emit agent event so user sees the failure in agent console
    const event: AgentEvent = {
      type: 'agent:error',
      message: `Worktree evicted before completion (${worktreePath}). Use ~/worktrees/ instead of /tmp/.`,
      timestamp: Date.now()
    }
    broadcast('agent:event', { agentId: taskId, event })
    try {
      repo.updateTask(taskId, {
        status: 'error',
        completed_at: new Date().toISOString(),
        notes: `Worktree evicted before completion (${worktreePath}). Use ~/worktrees/ instead of /tmp/.`,
        claimed_by: null
      })
    } catch (e) {
      logger.warn(`[completion] Failed to update task ${taskId} after worktree eviction: ${e}`)
    }
    await onTaskTerminal(taskId, 'error')
    return
  }

  // 1. Detect current branch
  let branch: string
  try {
    branch = await detectBranch(worktreePath)
  } catch (err) {
    logger.error(`[completion] Failed to detect branch for task ${taskId}: ${err}`)
    const event: AgentEvent = {
      type: 'agent:error',
      message: 'Failed to detect branch',
      timestamp: Date.now()
    }
    broadcast('agent:event', { agentId: taskId, event })
    try {
      repo.updateTask(taskId, {
        status: 'error',
        completed_at: new Date().toISOString(),
        notes: 'Failed to detect branch',
        claimed_by: null
      })
    } catch (e) {
      logger.warn(`[completion] Failed to update task ${taskId} after branch detection error: ${e}`)
    }
    await onTaskTerminal(taskId, 'error')
    return
  }

  if (!branch) {
    logger.error(`[completion] Empty branch name for task ${taskId}`)
    const event: AgentEvent = {
      type: 'agent:error',
      message: 'Empty branch name',
      timestamp: Date.now()
    }
    broadcast('agent:event', { agentId: taskId, event })
    try {
      repo.updateTask(taskId, {
        status: 'error',
        completed_at: new Date().toISOString(),
        notes: 'Empty branch name',
        claimed_by: null
      })
    } catch (e) {
      logger.warn(`[completion] Failed to update task ${taskId} after empty branch: ${e}`)
    }
    await onTaskTerminal(taskId, 'error')
    return
  }

  // 2. Auto-commit any uncommitted changes (agents may not commit before exiting)
  try {
    await autoCommitIfDirty(worktreePath, title, logger)
  } catch (err) {
    logger.warn(`[completion] Auto-commit failed for task ${taskId}: ${err}`)
    // Continue — push will fail naturally if there are no commits
  }

  // 3. Check if there are any commits
  try {
    const { stdout: diffOut } = await execFile(
      'git',
      ['rev-list', '--count', `origin/main..${branch}`],
      { cwd: worktreePath, env: buildAgentEnv() }
    )
    if (parseInt(diffOut.trim(), 10) === 0) {
      const summaryNote = agentSummary
        ? `Agent produced no commits. Last output: ${agentSummary.slice(0, AGENT_SUMMARY_MAX_LENGTH)}`
        : 'Agent produced no commits (no output captured)'
      const isTerminal = resolveFailure({ taskId, retryCount, notes: summaryNote, repo }, logger)
      if (isTerminal) {
        logger.warn(
          `[completion] Task ${taskId}: no commits on branch ${branch} — exhausted retries`
        )
        await onTaskTerminal(taskId, 'failed')
      } else {
        logger.warn(
          `[completion] Task ${taskId}: no commits on branch ${branch} — requeuing (retry ${retryCount + 1}/${MAX_RETRIES})`
        )
      }
      return
    }
  } catch {
    // If rev-list fails, continue — commits may still exist
  }

  // 4. Transition to review — preserve worktree for code review.
  // Push + PR creation deferred to explicit user/UI action.
  logger.info(
    `[completion] Task ${taskId}: agent finished with commits on branch ${branch} — transitioning to review`
  )
  try {
    repo.updateTask(taskId, {
      status: 'review',
      worktree_path: worktreePath,
      claimed_by: null
    })
  } catch (err) {
    logger.error(`[completion] Failed to update task ${taskId} to review status: ${err}`)
  }
  // NOTE: Do NOT call onTaskTerminal — review is not a terminal status.
  // Do NOT clean up worktree — it stays alive for review.
}

export function resolveFailure(opts: ResolveFailureOpts, logger?: Logger): boolean {
  const { taskId, retryCount, notes, repo } = opts

  // Determine if this is a terminal state (exhausted retries)
  const isTerminal = retryCount >= MAX_RETRIES

  try {
    if (!isTerminal) {
      repo.updateTask(taskId, {
        status: 'queued',
        retry_count: retryCount + 1,
        claimed_by: null,
        ...(notes ? { notes } : {})
      })
      return false // not terminal
    } else {
      repo.updateTask(taskId, {
        status: 'failed',
        completed_at: new Date().toISOString(),
        claimed_by: null,
        needs_review: true,
        ...(notes ? { notes } : {})
      })
      return true // terminal
    }
  } catch (err) {
    logger?.error(`[completion] Failed to update task ${taskId} during failure resolution: ${err}`)
    // Still return correct terminal status even if DB update failed
    // so caller knows to trigger onStatusTerminal callback
    return isTerminal
  }
}

export { PR_CREATE_MAX_ATTEMPTS }
