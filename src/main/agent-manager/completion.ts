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

export async function resolveSuccess(opts: ResolveSuccessOpts, logger: Logger): Promise<void> {
  const { taskId, worktreePath, title, ghRepo } = opts

  // 1. Detect current branch
  const { stdout: branchOut } = await execFile(
    'git',
    ['rev-parse', '--abbrev-ref', 'HEAD'],
    { cwd: worktreePath, env: buildAgentEnv() }
  )
  const branch = branchOut.trim()
  logger.info(`[completion] Task ${taskId}: pushing branch ${branch}`)

  // 2. Push branch to origin (skip pre-push hooks — agent code is reviewed via PR)
  await execFile('git', ['push', '--no-verify', 'origin', branch], { cwd: worktreePath, env: buildAgentEnv() })

  // 3. Open PR via gh CLI
  let prUrl: string | null = null
  let prNumber: number | null = null
  try {
    const { stdout: prOut } = await execFile(
      'gh',
      ['pr', 'create', '--title', title, '--body', 'Automated by BDE', '--head', branch, '--repo', ghRepo],
      { cwd: worktreePath, env: buildAgentEnv() }
    )
    const parsed = parsePrOutput(prOut)
    prUrl = parsed.prUrl
    prNumber = parsed.prNumber
  } catch (err) {
    logger.warn(`[completion] gh pr create failed for task ${taskId}: ${err}`)
    // User can create PR manually from the pushed branch — do not throw
  }

  // 4. Update task with PR info (task stays active; SprintPrPoller handles done on merge)
  if (prUrl !== null && prNumber !== null) {
    await updateTask(taskId, { pr_status: 'open', pr_url: prUrl, pr_number: prNumber })
  } else {
    // Push succeeded but PR creation failed — record branch name so user can create PR manually
    await updateTask(taskId, { notes: `Branch ${branch} pushed but PR creation failed` })
  }
}

export async function resolveFailure(opts: ResolveFailureOpts): Promise<void> {
  const { taskId, retryCount } = opts

  if (retryCount < MAX_RETRIES) {
    await updateTask(taskId, {
      status: 'queued',
      retry_count: retryCount + 1,
      claimed_by: null,
    })
  } else {
    await updateTask(taskId, {
      status: 'failed',
      completed_at: new Date().toISOString(),
    })
  }
}
