import { execFile as execFileCb } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import type { ISprintTaskRepository } from '../data/sprint-task-repository'
import { buildAgentEnv } from '../env-utils'
import { MAX_RETRIES, AGENT_SUMMARY_MAX_LENGTH } from './types'
import type { Logger } from './types'
import { broadcast } from '../broadcast'
import type { AgentEvent, FailureReason } from '../../shared/types'
import { runPostMergeDedup } from '../services/post-merge-dedup'
import { captureDiffSnapshot } from './diff-snapshot'

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
    .replace(/\$\(/g, '(') // Strip the $ from $( to neutralize command substitution
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

    // Unstage test artifacts that may have been previously tracked
    const artifactPaths = ['test-results/', 'coverage/', '*.log', 'playwright-report/']
    for (const path of artifactPaths) {
      try {
        await execFile('git', ['rm', '-r', '--cached', '--ignore-unmatch', path], {
          cwd: worktreePath,
          env: buildAgentEnv()
        })
      } catch {
        // Non-fatal — artifact may not exist or not be tracked
      }
    }

    // Re-check if staged changes remain (unstaging may have removed everything)
    const { stdout: stagedOut } = await execFile('git', ['diff', '--cached', '--name-only'], {
      cwd: worktreePath,
      env: buildAgentEnv()
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
        env: buildAgentEnv()
      }
    )
  }
}

/**
 * Rebase the agent's branch onto origin/main to ensure it's up-to-date.
 * Returns { success: true, baseSha } if rebase succeeds, { success: false, notes: string } if it fails.
 */
async function rebaseOntoMain(
  worktreePath: string,
  logger: Logger
): Promise<{ success: boolean; notes?: string; baseSha?: string }> {
  try {
    // Fetch origin/main
    logger.info(`[completion] fetching origin/main for rebase`)
    await execFile('git', ['fetch', 'origin', 'main'], {
      cwd: worktreePath,
      env: buildAgentEnv()
    })

    // Rebase onto origin/main
    logger.info(`[completion] rebasing onto origin/main`)
    await execFile('git', ['rebase', 'origin/main'], {
      cwd: worktreePath,
      env: buildAgentEnv()
    })

    const { stdout: shaOut } = await execFile('git', ['rev-parse', 'origin/main'], {
      cwd: worktreePath,
      env: buildAgentEnv()
    })

    logger.info(`[completion] rebase onto main succeeded`)
    return { success: true, baseSha: shaOut.trim() }
  } catch (err) {
    // Rebase failed — abort to restore clean state
    logger.warn(`[completion] rebase onto main failed: ${err}`)
    try {
      await execFile('git', ['rebase', '--abort'], {
        cwd: worktreePath,
        env: buildAgentEnv()
      })
      logger.info(`[completion] rebase aborted successfully`)
    } catch (abortErr) {
      logger.error(`[completion] failed to abort rebase: ${abortErr}`)
    }

    return {
      success: false,
      notes: 'Rebase onto main failed — manual conflict resolution needed.'
    }
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

/**
 * Classify failure reason from error notes for structured filtering and auto-handling.
 * Pattern matches on common error strings to categorize failure types.
 */
export function classifyFailureReason(notes: string | undefined): FailureReason {
  if (!notes) return 'unknown'

  const lowerNotes = notes.toLowerCase()

  // Auth failures — API key, token, credentials
  if (
    lowerNotes.includes('invalid api key') ||
    lowerNotes.includes('authentication failed') ||
    lowerNotes.includes('unauthorized') ||
    lowerNotes.includes('token expired') ||
    lowerNotes.includes('invalid token')
  ) {
    return 'auth'
  }

  // Timeout failures — watchdog, runtime exceeded
  if (
    lowerNotes.includes('exceeded maximum runtime') ||
    lowerNotes.includes('timeout') ||
    lowerNotes.includes('timed out') ||
    lowerNotes.includes('watchdog')
  ) {
    return 'timeout'
  }

  // Test failures — npm test, vitest, jest
  if (
    lowerNotes.includes('npm test failed') ||
    lowerNotes.includes('test failed') ||
    lowerNotes.includes('vitest failed') ||
    lowerNotes.includes('jest failed') ||
    lowerNotes.includes('tests failed')
  ) {
    return 'test_failure'
  }

  // Compilation failures — tsc, typescript, build errors
  if (
    lowerNotes.includes('compilation error') ||
    lowerNotes.includes('compilation failed') ||
    lowerNotes.includes('tsc failed') ||
    lowerNotes.includes('typescript error') ||
    lowerNotes.includes('type error') ||
    lowerNotes.includes('build failed')
  ) {
    return 'compilation'
  }

  // Spawn failures — process creation, agent spawn
  if (
    lowerNotes.includes('spawn failed') ||
    lowerNotes.includes('failed to spawn') ||
    lowerNotes.includes('enoent') ||
    lowerNotes.includes('command not found')
  ) {
    return 'spawn'
  }

  return 'unknown'
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

  // 3. Rebase onto origin/main to prevent stale branch merge conflicts
  let rebaseNote: string | undefined
  let rebaseBaseSha: string | undefined
  let rebaseSucceeded = false
  try {
    const rebaseResult = await rebaseOntoMain(worktreePath, logger)
    if (!rebaseResult.success) {
      rebaseNote = rebaseResult.notes
    } else {
      rebaseBaseSha = rebaseResult.baseSha
      rebaseSucceeded = true
    }
  } catch (err) {
    logger.warn(`[completion] Rebase step failed for task ${taskId}: ${err}`)
    rebaseNote = 'Rebase onto main failed — manual conflict resolution needed.'
  }

  // 4. Check if there are any commits
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

  // 5. Transition to review — preserve worktree for code review.
  // Push + PR creation deferred to explicit user/UI action.
  logger.info(
    `[completion] Task ${taskId}: agent finished with commits on branch ${branch} — transitioning to review`
  )

  // Calculate duration from started_at to now
  const task = repo.getTask(taskId)
  let durationMs: number | undefined
  if (task?.started_at) {
    const startTime = new Date(task.started_at).getTime()
    const endTime = Date.now()
    durationMs = endTime - startTime
  }

  // Capture diff snapshot BEFORE any cleanup so review UI can fall back to it
  // if the worktree is later removed (e.g. after merge or discard).
  let diffSnapshotJson: string | null = null
  try {
    const snapshot = await captureDiffSnapshot(worktreePath, 'origin/main', logger)
    if (snapshot) {
      diffSnapshotJson = JSON.stringify(snapshot)
    }
  } catch (err) {
    logger.warn(`[completion] Diff snapshot capture failed for task ${taskId}: ${err}`)
  }

  try {
    repo.updateTask(taskId, {
      status: 'review',
      worktree_path: worktreePath,
      claimed_by: null,
      ...(durationMs !== undefined ? { duration_ms: durationMs } : {}),
      ...(rebaseNote ? { notes: rebaseNote } : {}),
      ...(diffSnapshotJson ? { review_diff_snapshot: diffSnapshotJson } : {}),
      rebase_base_sha: rebaseBaseSha ?? null,
      rebased_at: rebaseSucceeded ? new Date().toISOString() : null
    })
  } catch (err) {
    logger.error(`[completion] Failed to update task ${taskId} to review status: ${err}`)
  }

  // 5. Check auto-review rules — if qualified, auto-merge
  const { getSettingJson } = await import('../settings')
  const rules = getSettingJson<
    Array<{
      id: string
      name: string
      enabled: boolean
      conditions: {
        maxLinesChanged?: number
        filePatterns?: string[]
        excludePatterns?: string[]
      }
      action: 'auto-merge' | 'auto-approve'
    }>
  >('autoReview.rules')

  if (rules && rules.length > 0) {
    try {
      // Get file diff stats
      const { stdout: numstatOut } = await execFile(
        'git',
        ['diff', '--numstat', 'origin/main...HEAD'],
        { cwd: worktreePath, env: buildAgentEnv() }
      )

      if (numstatOut.trim()) {
        // Parse numstat into file summaries
        const files = numstatOut
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((line) => {
            const parts = line.split('\t')
            const additions = parts[0] === '-' ? 0 : parseInt(parts[0], 10)
            const deletions = parts[1] === '-' ? 0 : parseInt(parts[1], 10)
            const filePath = parts.slice(2).join('\t')
            return { path: filePath, additions, deletions }
          })

        // Evaluate rules
        const { evaluateAutoReviewRules } = await import('../services/auto-review')
        const result = evaluateAutoReviewRules(rules, files)

        if (result && result.action === 'auto-merge') {
          logger.info(
            `[completion] Task ${taskId} qualifies for auto-merge (rule: ${result.rule.name}) — merging`
          )

          // Get task to find repo name
          const task = repo.getTask(taskId)
          if (!task) {
            logger.error(`[completion] Task ${taskId} not found for auto-merge`)
            return
          }

          const repos = getSettingJson<Array<{ name: string; localPath: string }>>('repos')
          const repoConfig = repos?.find((r) => r.name === task.repo)
          if (!repoConfig) {
            logger.error(`[completion] Repo "${task.repo}" not found in settings for auto-merge`)
            return
          }

          const repoPath = repoConfig.localPath

          // Verify clean working tree
          const { stdout: statusOut } = await execFile('git', ['status', '--porcelain'], {
            cwd: repoPath,
            env: buildAgentEnv()
          })
          if (statusOut.trim()) {
            logger.warn(
              `[completion] Skipping auto-merge for task ${taskId}: main repo has uncommitted changes`
            )
            return
          }

          // Perform squash merge
          try {
            await execFile('git', ['merge', '--squash', branch], {
              cwd: repoPath,
              env: buildAgentEnv()
            })
            await execFile('git', ['commit', '-m', `${sanitizeForGit(title)} (#${taskId})`], {
              cwd: repoPath,
              env: buildAgentEnv()
            })

            try {
              await runPostMergeDedup(repoPath)
            } catch {
              // Non-fatal
            }

            // Clean up worktree + branch
            try {
              await execFile('git', ['worktree', 'remove', worktreePath, '--force'], {
                cwd: repoPath,
                env: buildAgentEnv()
              })
            } catch {
              /* best-effort */
            }
            try {
              await execFile('git', ['branch', '-D', branch], {
                cwd: repoPath,
                env: buildAgentEnv()
              })
            } catch {
              /* best-effort */
            }

            // Mark task done — preserve duration_ms from review status
            const reviewTask = repo.getTask(taskId)
            repo.updateTask(taskId, {
              status: 'done',
              completed_at: new Date().toISOString(),
              worktree_path: null,
              // Preserve duration_ms calculated at review transition
              ...(reviewTask?.duration_ms !== undefined
                ? { duration_ms: reviewTask.duration_ms }
                : {})
            })

            logger.info(`[completion] Task ${taskId} auto-merged successfully`)
            await onTaskTerminal(taskId, 'done')
          } catch (mergeErr) {
            logger.error(
              `[completion] Auto-merge failed for task ${taskId}: ${mergeErr} — task remains in review`
            )
            // Abort the failed merge
            try {
              await execFile('git', ['merge', '--abort'], {
                cwd: repoPath,
                env: buildAgentEnv()
              })
            } catch {
              /* best-effort */
            }
          }
        }
      }
    } catch (err) {
      logger.warn(`[completion] Auto-review check failed for task ${taskId}: ${err}`)
      // Non-fatal — task stays in review for manual review
    }
  }

  // NOTE: If not auto-merged, do NOT call onTaskTerminal — review is not a terminal status.
  // Do NOT clean up worktree — it stays alive for review.
}

export function resolveFailure(opts: ResolveFailureOpts, logger?: Logger): boolean {
  const { taskId, retryCount, notes, repo } = opts

  // Classify failure reason for structured filtering
  const failureReason = classifyFailureReason(notes)

  // Determine if this is a terminal state (exhausted retries)
  const isTerminal = retryCount >= MAX_RETRIES

  // Calculate duration from started_at to now (for terminal failures only)
  const task = repo.getTask(taskId)
  let durationMs: number | undefined
  if (isTerminal && task?.started_at) {
    const startTime = new Date(task.started_at).getTime()
    const endTime = Date.now()
    durationMs = endTime - startTime
  }

  try {
    if (!isTerminal) {
      // Exponential backoff: 30s, 60s, 120s, capped at 5 minutes
      const backoffMs = Math.min(300000, 30000 * Math.pow(2, retryCount))
      const nextEligibleAt = new Date(Date.now() + backoffMs).toISOString()
      repo.updateTask(taskId, {
        status: 'queued',
        retry_count: retryCount + 1,
        claimed_by: null,
        next_eligible_at: nextEligibleAt,
        failure_reason: failureReason,
        ...(notes ? { notes } : {})
      })
      return false // not terminal
    } else {
      repo.updateTask(taskId, {
        status: 'failed',
        completed_at: new Date().toISOString(),
        claimed_by: null,
        needs_review: true,
        failure_reason: failureReason,
        ...(durationMs !== undefined ? { duration_ms: durationMs } : {}),
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
