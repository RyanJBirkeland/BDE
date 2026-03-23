import { execFile as execFileCb } from 'node:child_process'
import { promisify } from 'node:util'
import { updateTask } from '../data/sprint-queries'
import { MAX_RETRIES } from './types'

const execFile = promisify(execFileCb)

const EXEC_ENV = {
  ...process.env,
  PATH: ['/usr/local/bin', '/opt/homebrew/bin', `${process.env.HOME}/.local/bin`, process.env.PATH].filter(Boolean).join(':'),
}

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

export async function resolveSuccess(opts: ResolveSuccessOpts): Promise<void> {
  const { taskId, worktreePath, title, ghRepo } = opts

  // 1. Detect current branch
  const { stdout: branchOut } = await execFile(
    'git',
    ['rev-parse', '--abbrev-ref', 'HEAD'],
    { cwd: worktreePath, env: EXEC_ENV }
  )
  const branch = branchOut.trim()

  // 2. Push branch to origin
  await execFile('git', ['push', 'origin', branch], { cwd: worktreePath, env: EXEC_ENV })

  // 3. Open PR via gh CLI
  let prUrl: string | null = null
  let prNumber: number | null = null
  try {
    const { stdout: prOut } = await execFile(
      'gh',
      ['pr', 'create', '--title', title, '--body', 'Automated by BDE', '--head', branch, '--repo', ghRepo],
      { cwd: worktreePath, env: EXEC_ENV }
    )
    const parsed = parsePrOutput(prOut)
    prUrl = parsed.prUrl
    prNumber = parsed.prNumber
  } catch (err) {
    console.error(`[completion] gh pr create failed for task ${taskId}:`, err)
    // User can create PR manually from the pushed branch — do not throw
  }

  // 4. Update task with PR info (task stays active; SprintPrPoller handles done on merge)
  const patch: Record<string, unknown> = { pr_status: 'open' }
  if (prUrl !== null) patch.pr_url = prUrl
  if (prNumber !== null) patch.pr_number = prNumber
  await updateTask(taskId, patch)
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
