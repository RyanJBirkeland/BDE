import path from 'node:path'
import { safeHandle } from '../ipc-utils'
import { parsePrUrl } from '../../shared/github'
import { validateRepoPath } from '../validation'
import {
  getRepoPaths,
  gitStatus,
  gitDiffFile,
  gitStage,
  gitUnstage,
  gitCommit,
  gitPush,
  gitBranches,
  gitCheckout,
  detectGitRemote,
  gitFetch,
  gitPull
} from '../git'
import { pollPrStatuses, type PrStatusInput } from '../github-pr-status'
import type { TaskStatus } from '../../shared/task-state-machine'
import { checkConflictFiles, type ConflictFilesInput } from '../github-conflict-check'
import { getLatestPrList, refreshPrList } from '../pr-poller'
import { getGitHubToken } from '../config'
import {
  markTaskDoneByPrNumber,
  markTaskCancelledByPrNumber,
  updateTaskMergeableState
} from '../services/sprint-service'
import { proxyGitHubRequest } from '../services/github-proxy-service'
import type { GitHubFetchInit } from '../../shared/ipc-channels'
import { createLogger } from '../logger'
import { validateGitRef, validateFilePath } from '../lib/review-paths'
import { execFileAsync } from '../lib/async-utils'

const logger = createLogger('git-handlers')

export interface GitHandlersDeps {
  onStatusTerminal: (taskId: string, status: TaskStatus) => void | Promise<void>
}

export function registerGitHandlers(deps: GitHandlersDeps): void {
  // --- GitHub token availability check ---
  safeHandle('github:isConfigured', () => {
    return getGitHubToken() !== null
  })

  // --- GitHub API proxy (renderer -> main -> api.github.com) ---
  safeHandle('github:fetch', async (_e, path: string, init?: GitHubFetchInit) => {
    return proxyGitHubRequest(path, init)
  })

  safeHandle('git:checkInstalled', async () => {
    try {
      await execFileAsync('git', ['--version'])
      return true
    } catch {
      return false
    }
  })

  safeHandle('git:getRepoPaths', () => getRepoPaths())

  // --- Git client IPC (cwd validated against known repo paths) ---
  safeHandle('git:status', async (_e, cwd: string) => {
    const result = await gitStatus(validateRepoPath(cwd))
    if (!result.ok) {
      logger.warn(`git:status ${result.error}`)
      return { files: [], branch: '' }
    }
    return result.data
  })
  safeHandle('git:diff', async (_e, cwd: string, file?: string) => {
    if (file !== undefined) validateFilePath(file)
    const result = await gitDiffFile(validateRepoPath(cwd), file)
    if (!result.ok) {
      logger.warn(`git:diff ${result.error}`)
      return ''
    }
    return result.data
  })
  safeHandle('git:stage', (_e, cwd: string, files: string[]) =>
    gitStage(validateRepoPath(cwd), files)
  )
  safeHandle('git:unstage', (_e, cwd: string, files: string[]) =>
    gitUnstage(validateRepoPath(cwd), files)
  )
  safeHandle('git:commit', (_e, cwd: string, message: string) =>
    gitCommit(validateRepoPath(cwd), message)
  )
  safeHandle('git:push', (_e, cwd: string) => gitPush(validateRepoPath(cwd)))
  safeHandle('git:branches', (_e, cwd: string) => gitBranches(validateRepoPath(cwd)))
  safeHandle('git:checkout', (_e, cwd: string, branch: string) => {
    validateGitRef(branch)
    return gitCheckout(validateRepoPath(cwd), branch)
  })
  safeHandle('git:fetch', (_e, cwd: string) => gitFetch(validateRepoPath(cwd)))
  safeHandle('git:pull', (_e, cwd: string, currentBranch: string) => {
    validateGitRef(currentBranch)
    return gitPull(validateRepoPath(cwd), currentBranch)
  })

  // --- Detect GitHub remote for a directory picked by the user.
  // NOTE: validateRepoPath is intentionally NOT used here — this is called
  // BEFORE a repo is configured in settings (e.g. Settings > Add Repository
  // or the onboarding inline repo form), so the path is not yet on the
  // allowlist. We still require an absolute path and sanity-check it.
  safeHandle('git:detectRemote', async (_e, cwd: string) => {
    if (typeof cwd !== 'string' || !cwd.startsWith('/')) {
      return { isGitRepo: false, remoteUrl: null, owner: null, repo: null }
    }
    // Defense in depth: reject anything that doesn't normalize to itself or
    // contains parent-traversal segments. The operation is read-only via
    // execFile (no shell, no writes), so blast radius is small — this just
    // closes traversal tricks.
    const resolved = path.resolve(cwd)
    if (resolved !== cwd || cwd.includes('..')) {
      return { isGitRepo: false, remoteUrl: null, owner: null, repo: null }
    }
    return detectGitRemote(cwd)
  })

  // --- PR status polling ---
  safeHandle('pr:pollStatuses', async (_e, prs: PrStatusInput[]) => {
    const results = await pollPrStatuses(prs)
    for (const result of results) {
      const input = prs.find((p) => p.taskId === result.taskId)
      const prNumber = input ? parsePrUrl(input.prUrl)?.number : undefined
      if (!prNumber) continue
      if (result.merged) {
        const ids = await markTaskDoneByPrNumber(prNumber)
        for (const id of ids) deps.onStatusTerminal(id, 'done')
      } else if (result.state === 'CLOSED') {
        const ids = await markTaskCancelledByPrNumber(prNumber)
        for (const id of ids) deps.onStatusTerminal(id, 'cancelled')
      }
      await updateTaskMergeableState(prNumber, result.mergeableState)
    }
    return results
  })

  // --- Conflict file detection ---
  safeHandle('pr:checkConflictFiles', (_e, input: ConflictFilesInput) => checkConflictFiles(input))

  // --- Open PR list (main-process poller is the source of truth) ---
  safeHandle('pr:getList', () => getLatestPrList() ?? { prs: [], checks: {} })
  safeHandle('pr:refreshList', () => refreshPrList())
}
