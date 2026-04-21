// Composite pre-flight checks. Each check is independent; grouped here because
// all must pass before task launch. This is not a domain service — it has no
// shared state or invariants between checks.
import { checkAuthStatus } from '../auth-guard'
import { getRepoPath } from '../git'
import { execFileAsync } from '../lib/async-utils'
import { listTasks } from './sprint-service'
import type { AgentManager } from '../agent-manager'

type CheckStatus = 'pass' | 'warn' | 'fail'

interface AuthCheckStatus {
  status: CheckStatus
  message: string
}
interface RepoPathCheckStatus {
  status: 'pass' | 'fail'
  message: string
  path?: string
}
interface GitCleanStatus {
  status: 'pass' | 'warn'
  message: string
}
interface ConflictCheckStatus {
  status: CheckStatus
  message: string
}
interface AgentSlotCapacity {
  status: 'pass' | 'warn'
  message: string
  available: number
  max: number
}

export interface OperationalCheckResults {
  auth: AuthCheckStatus
  repoPath: RepoPathCheckStatus
  gitClean: GitCleanStatus
  noConflict: ConflictCheckStatus
  slotsAvailable: AgentSlotCapacity
}

export async function validateAuthStatus(): Promise<AuthCheckStatus> {
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

export function validateRepoPath(repo: string): RepoPathCheckStatus {
  const repoPath = getRepoPath(repo)
  if (!repoPath) {
    return { status: 'fail', message: `No path configured for repo "${repo}"` }
  }
  return { status: 'pass', message: 'Repo path configured', path: repoPath }
}

export async function validateGitCleanStatus(
  repoPath: string | undefined
): Promise<GitCleanStatus> {
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

export function validateNoTaskConflicts(repo: string): ConflictCheckStatus {
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

export function assessAgentSlotCapacity(am: AgentManager | undefined): AgentSlotCapacity {
  if (!am) {
    return { status: 'warn', message: 'Agent manager not available', available: 0, max: 0 }
  }
  const status = am.getStatus()
  const available = status.concurrency
    ? status.concurrency.maxSlots - status.concurrency.activeCount
    : 0
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
  const repoPathResult = validateRepoPath(repo)
  const [auth, gitClean] = await Promise.all([
    validateAuthStatus(),
    validateGitCleanStatus(repoPathResult.path)
  ])
  const noConflict = validateNoTaskConflicts(repo)
  const slotsAvailable = assessAgentSlotCapacity(am)
  return { auth, repoPath: repoPathResult, gitClean, noConflict, slotsAvailable }
}
