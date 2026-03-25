import { execFile as execFileCb } from 'node:child_process'
import { promisify } from 'node:util'
import { updateTask } from '../data/sprint-queries'
import { buildAgentEnv } from '../env-utils'
import { MAX_RETRIES } from './types'
import type { Logger } from './types'

const execFile = promisify(execFileCb)

export interface ResolveSuccessOpts {
  taskId: string
  worktreePath: string
  title: string
  ghRepo: string
  onTaskTerminal: (taskId: string, status: string) => Promise<void>
  agentSummary?: string | null
}

export interface ResolveFailureOpts {
  taskId: string
  retryCount: number
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
    const { stdout: log } = await execFile(
      'git', ['log', '--oneline', `origin/main..${branch}`],
      { cwd: worktreePath, env }
    )
    if (log.trim()) {
      sections.push('## Commits\n' + log.trim().split('\n').map((l) => `- ${l}`).join('\n'))
    }
  } catch { /* non-fatal */ }

  try {
    const { stdout: stat } = await execFile(
      'git', ['diff', '--stat', `origin/main..${branch}`],
      { cwd: worktreePath, env }
    )
    if (stat.trim()) {
      sections.push('## Changes\n```\n' + stat.trim() + '\n```')
    }
  } catch { /* non-fatal */ }

  sections.push('🤖 Automated by BDE Agent Manager')

  return sections.join('\n\n')
}

export async function resolveSuccess(opts: ResolveSuccessOpts, logger: Logger): Promise<void> {
  const { taskId, worktreePath, title, ghRepo, onTaskTerminal, agentSummary } = opts

  // 1. Detect current branch
  let branch: string
  try {
    const { stdout: branchOut } = await execFile(
      'git',
      ['rev-parse', '--abbrev-ref', 'HEAD'],
      { cwd: worktreePath, env: buildAgentEnv() }
    )
    branch = branchOut.trim()
  } catch (err) {
    logger.error(`[completion] Failed to detect branch for task ${taskId}: ${err}`)
    await updateTask(taskId, { status: 'error', completed_at: new Date().toISOString(), notes: 'Failed to detect branch', claimed_by: null }).catch((e) =>
      logger.warn(`[completion] Failed to update task ${taskId} after branch detection error: ${e}`)
    )
    await onTaskTerminal(taskId, 'error')
    return
  }

  if (!branch) {
    logger.error(`[completion] Empty branch name for task ${taskId}`)
    await updateTask(taskId, { status: 'error', completed_at: new Date().toISOString(), notes: 'Empty branch name', claimed_by: null }).catch((e) =>
      logger.warn(`[completion] Failed to update task ${taskId} after empty branch: ${e}`)
    )
    await onTaskTerminal(taskId, 'error')
    return
  }

  // 2. Auto-commit any uncommitted changes (agents may not commit before exiting)
  try {
    const { stdout: statusOut } = await execFile(
      'git', ['status', '--porcelain'],
      { cwd: worktreePath, env: buildAgentEnv() }
    )
    if (statusOut.trim()) {
      logger.info(`[completion] Task ${taskId}: auto-committing uncommitted changes`)
      await execFile('git', ['add', '-u'], { cwd: worktreePath, env: buildAgentEnv() })
      await execFile(
        'git', ['commit', '-m', `${title}\n\nAutomated commit by BDE agent manager`],
        { cwd: worktreePath, env: buildAgentEnv() }
      )
    }
  } catch (err) {
    logger.warn(`[completion] Auto-commit failed for task ${taskId}: ${err}`)
    // Continue — push will fail naturally if there are no commits
  }

  // 3. Check if there are any commits to push
  try {
    const { stdout: diffOut } = await execFile(
      'git', ['rev-list', '--count', `origin/main..${branch}`],
      { cwd: worktreePath, env: buildAgentEnv() }
    )
    if (parseInt(diffOut.trim(), 10) === 0) {
      logger.warn(`[completion] Task ${taskId}: no commits to push on branch ${branch} — marking error`)
      const summaryNote = agentSummary
        ? `Agent produced no commits. Last output: ${agentSummary.slice(0, 300)}`
        : 'Agent produced no commits (no output captured)'
      await updateTask(taskId, { status: 'error', completed_at: new Date().toISOString(), notes: summaryNote, claimed_by: null }).catch((e) =>
        logger.warn(`[completion] Failed to update task ${taskId} after empty branch: ${e}`)
      )
      await onTaskTerminal(taskId, 'error')
      return
    }
  } catch {
    // If rev-list fails, try pushing anyway
  }

  logger.info(`[completion] Task ${taskId}: pushing branch ${branch}`)

  // Push branch to origin (skip pre-push hooks — agent code is reviewed via PR)
  try {
    await execFile('git', ['push', '--no-verify', 'origin', branch], { cwd: worktreePath, env: buildAgentEnv() })
  } catch (err) {
    logger.error(`[completion] git push failed for task ${taskId} (branch ${branch}): ${err}`)
    await updateTask(taskId, { notes: `git push failed for branch ${branch}: ${err}` }).catch((e) =>
      logger.warn(`[completion] Failed to update task ${taskId} after push error: ${e}`)
    )
    return
  }

  // Check if PR already exists for this branch
  let prUrl: string | null = null
  let prNumber: number | null = null
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
        prUrl = existing.url
        prNumber = existing.number
        logger.info(`[completion] Task ${taskId}: PR already exists for branch ${branch}: ${prUrl}`)
      }
    }
  } catch (err) {
    logger.warn(`[completion] Failed to check for existing PR on branch ${branch}: ${err}`)
  }

  // Open PR via gh CLI if one doesn't exist
  if (!prUrl) {
    try {
      const body = await generatePrBody(worktreePath, branch)
      const { stdout: prOut } = await execFile(
        'gh',
        ['pr', 'create', '--title', title, '--body', body, '--head', branch, '--repo', ghRepo],
        { cwd: worktreePath, env: buildAgentEnv() }
      )
      const parsed = parsePrOutput(prOut)
      prUrl = parsed.prUrl
      prNumber = parsed.prNumber
      logger.info(`[completion] Task ${taskId}: created new PR ${prUrl}`)
    } catch (err) {
      const errMsg = String(err)
      // If PR creation failed because one already exists (race condition), try to fetch it
      if (errMsg.includes('already exists') || errMsg.includes('pull request already exists')) {
        logger.info(`[completion] Task ${taskId}: PR creation failed because one already exists, fetching existing PR`)
        try {
          const { stdout: retryListOut } = await execFile(
            'gh',
            ['pr', 'list', '--head', branch, '--json', 'url,number', '--jq', '.[0] | {url, number}'],
            { cwd: worktreePath, env: buildAgentEnv() }
          )
          const retryTrimmed = retryListOut.trim()
          if (retryTrimmed && retryTrimmed !== 'null') {
            const existing = JSON.parse(retryTrimmed)
            if (existing && existing.url && existing.number) {
              prUrl = existing.url
              prNumber = existing.number
              logger.info(`[completion] Task ${taskId}: found existing PR ${prUrl}`)
            }
          }
        } catch (retryErr) {
          logger.warn(`[completion] Failed to fetch existing PR after creation failure: ${retryErr}`)
        }
      } else {
        logger.warn(`[completion] gh pr create failed for task ${taskId}: ${err}`)
      }
      // User can create PR manually from the pushed branch — do not throw
    }
  }

  // Update task with PR info (task stays active; SprintPrPoller handles done on merge)
  try {
    if (prUrl !== null && prNumber !== null) {
      await updateTask(taskId, { pr_status: 'open', pr_url: prUrl, pr_number: prNumber })
    } else {
      // Push succeeded but PR creation failed — record branch name so user can create PR manually
      await updateTask(taskId, { notes: `Branch ${branch} pushed but PR creation failed` })
    }
  } catch (err) {
    logger.error(`[completion] Failed to update task ${taskId} with PR info: ${err}`)
  }
}

export async function resolveFailure(opts: ResolveFailureOpts, logger?: Logger): Promise<boolean> {
  const { taskId, retryCount } = opts

  try {
    if (retryCount < MAX_RETRIES) {
      await updateTask(taskId, {
        status: 'queued',
        retry_count: retryCount + 1,
        claimed_by: null,
      })
      return false  // not terminal
    } else {
      await updateTask(taskId, {
        status: 'failed',
        completed_at: new Date().toISOString(),
        claimed_by: null,
      })
      return true  // terminal
    }
  } catch (err) {
    logger?.error(`[completion] Failed to update task ${taskId} during failure resolution: ${err}`)
    return false
  }
}
