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
  pollPrStatuses,
  checkConflictFiles,
  type PrStatusInput,
  type ConflictFilesInput
} from '../git'
import { getLatestPrList, refreshPrList } from '../pr-poller'
import { getGitHubToken } from '../config'
import { githubFetch, parseNextLink } from '../github-fetch'
import {
  markTaskDoneByPrNumber,
  markTaskCancelledByPrNumber,
  updateTaskMergeableState
} from './sprint-local'
import type { GitHubFetchInit } from '../../shared/ipc-channels'

export function registerGitHandlers(): void {
  // --- GitHub API proxy (renderer -> main -> api.github.com) ---
  safeHandle('github:fetch', async (_e, path: string, init?: GitHubFetchInit) => {
    const token = getGitHubToken()
    if (!token) throw new Error('GitHub token not configured. Set it in Settings \u2192 Connections.')

    let url: string
    if (path.startsWith('https://')) {
      const parsed = new URL(path)
      if (parsed.hostname !== 'api.github.com') {
        throw new Error('github:fetch only allows api.github.com URLs')
      }
      url = path
    } else {
      url = `https://api.github.com${path}`
    }

    // Strip caller Authorization -- token is injected server-side only
    const { Authorization: _, ...safeHeaders } = init?.headers ?? {}
    const res = await githubFetch(url, {
      method: init?.method,
      headers: { ...safeHeaders, Authorization: `Bearer ${token}` },
      body: init?.body,
      timeoutMs: 30_000
    })

    const contentType = res.headers.get('content-type') ?? ''
    const body = contentType.includes('json') ? await res.json() : await res.text()
    const linkNext = parseNextLink(res.headers.get('Link'))

    return { ok: res.ok, status: res.status, body, linkNext }
  })

  safeHandle('git:getRepoPaths', () => getRepoPaths())

  // --- Git client IPC (cwd validated against known repo paths) ---
  safeHandle('git:status', async (_e, cwd: string) => {
    const result = await gitStatus(validateRepoPath(cwd))
    if (!result.ok) {
      console.warn('[git:status]', result.error)
      return { files: [] }
    }
    return result.data
  })
  safeHandle('git:diff', async (_e, cwd: string, file?: string) => {
    const result = await gitDiffFile(validateRepoPath(cwd), file)
    if (!result.ok) {
      console.warn('[git:diff]', result.error)
      return ''
    }
    return result.data
  })
  safeHandle('git:stage', (_e, cwd: string, files: string[]) => gitStage(validateRepoPath(cwd), files))
  safeHandle('git:unstage', (_e, cwd: string, files: string[]) => gitUnstage(validateRepoPath(cwd), files))
  safeHandle('git:commit', (_e, cwd: string, message: string) => gitCommit(validateRepoPath(cwd), message))
  safeHandle('git:push', (_e, cwd: string) => gitPush(validateRepoPath(cwd)))
  safeHandle('git:branches', (_e, cwd: string) => gitBranches(validateRepoPath(cwd)))
  safeHandle('git:checkout', (_e, cwd: string, branch: string) => gitCheckout(validateRepoPath(cwd), branch))

  // --- PR status polling ---
  safeHandle('pr:pollStatuses', async (_e, prs: PrStatusInput[]) => {
    const results = await pollPrStatuses(prs)
    for (const result of results) {
      const input = prs.find((p) => p.taskId === result.taskId)
      const prNumber = input ? parsePrUrl(input.prUrl)?.number : undefined
      if (!prNumber) continue
      if (result.merged) {
        markTaskDoneByPrNumber(prNumber)
      } else if (result.state === 'CLOSED') {
        markTaskCancelledByPrNumber(prNumber)
      }
      updateTaskMergeableState(prNumber, result.mergeableState)
    }
    return results
  })

  // --- Conflict file detection ---
  safeHandle('pr:checkConflictFiles', (_e, input: ConflictFilesInput) => checkConflictFiles(input))

  // --- Open PR list (main-process poller is the source of truth) ---
  safeHandle('pr:getList', () => getLatestPrList() ?? { prs: [], checks: {} })
  safeHandle('pr:refreshList', () => refreshPrList())
}
