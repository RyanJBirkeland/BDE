import { checkAuthStatus } from '../auth-guard'
import { getRepoPath } from '../git'
import { execFileAsync } from '../lib/async-utils'
import { listTasks } from './sprint-service'
import type { AgentManager } from '../agent-manager'

type CheckStatus = 'pass' | 'warn' | 'fail'

interface AuthResult { status: CheckStatus; message: string }
interface RepoPathResult { status: 'pass' | 'fail'; message: string; path?: string }
interface GitCleanResult { status: 'pass' | 'warn'; message: string }
interface NoConflictResult { status: CheckStatus; message: string }
interface SlotsResult { status: 'pass' | 'warn'; message: string; available: number; max: number }

export interface OperationalCheckResults {
  auth: AuthResult
  repoPath: RepoPathResult
  gitClean: GitCleanResult
  noConflict: NoConflictResult
  slotsAvailable: SlotsResult
}

export async function checkAuth(): Promise<AuthResult> {
  const authStatus = await checkAuthStatus()
  if (!authStatus.tokenFound) {
    return { status: 'fail', message: 'No Claude subscription token found — run: claude login' }
  }
  if (authStatus.tokenExpired) {
    return { status: 'fail', message: 'Claude subscription token expired — run: claude login' }
  }
  if (authStatus.expiresAt) {
    const hoursUntilExpiry = (authStatus.expiresAt.getTime() - Date.now()) / (1000 * 60 * 60)
    if (hoursUntilExpiry < 1) {
      return {
        status: 'warn',
        message: `Token expires in ${Math.round(hoursUntilExpiry * 60)} minutes`
      }
    }
  }
  return { status: 'pass', message: 'Authentication valid' }
}

export function checkRepoPath(repo: string): RepoPathResult {
  const repoPath = getRepoPath(repo)
  if (!repoPath) {
    return { status: 'fail', message: `No path configured for repo "${repo}"` }
  }
  return { status: 'pass', message: 'Repo path configured', path: repoPath }
}

export async function checkGitStatus(repoPath: string | undefined): Promise<GitCleanResult> {
  if (!repoPath) {
    return { status: 'warn', message: 'Cannot check git status (repo path not configured)' }
  }
  try {
    const { stdout } = await execFileAsync('git', ['status', '--porcelain'], {
      cwd: repoPath,
      encoding: 'utf-8'
    })
    if (stdout.trim().length === 0) {
      return { status: 'pass', message: 'Working directory clean' }
    }
    return { status: 'warn', message: 'Uncommitted changes present (agent may conflict)' }
  } catch (err) {
    return { status: 'warn', message: `Unable to check git status: ${(err as Error).message}` }
  }
}

export function checkTaskConflicts(repo: string): NoConflictResult {
  try {
    const tasks = listTasks()
    const conflicting = tasks.filter(
      (t) => t.repo === repo && ['active', 'queued'].includes(t.status)
    )
    if (conflicting.length === 0) {
      return { status: 'pass', message: 'No conflicting tasks' }
    }
    const activeCount = conflicting.filter((t) => t.status === 'active').length
    const queuedCount = conflicting.filter((t) => t.status === 'queued').length
    if (activeCount > 0) {
      return { status: 'fail', message: `${activeCount} active task(s) on this repo` }
    }
    return { status: 'warn', message: `${queuedCount} queued task(s) on this repo` }
  } catch (err) {
    return { status: 'warn', message: `Error checking for conflicts: ${(err as Error).message}` }
  }
}

export function checkAgentSlots(am: AgentManager | undefined): SlotsResult {
  if (!am) {
    return { status: 'warn', message: 'Agent manager not available', available: 0, max: 0 }
  }
  const status = am.getStatus()
  const available = status.concurrency ? status.concurrency.maxSlots - status.concurrency.activeCount : 0
  const max = status.concurrency?.maxSlots ?? 0
  if (available > 0) {
    return { status: 'pass', message: `${available} of ${max} slots available`, available, max }
  }
  return {
    status: 'warn',
    message: 'All agent slots occupied (task will wait in queue)',
    available: 0,
    max
  }
}

export async function runOperationalChecks(
  repo: string,
  am: AgentManager | undefined
): Promise<OperationalCheckResults> {
  const repoPathResult = checkRepoPath(repo)
  const [auth, gitClean] = await Promise.all([
    checkAuth(),
    checkGitStatus(repoPathResult.path)
  ])
  const noConflict = checkTaskConflicts(repo)
  const slotsAvailable = checkAgentSlots(am)
  return { auth, repoPath: repoPathResult, gitClean, noConflict, slotsAvailable }
}
