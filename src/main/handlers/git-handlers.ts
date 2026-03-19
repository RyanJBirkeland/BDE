import { safeHandle } from '../ipc-utils'
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
import { authenticatedGitHubFetch } from '../github-fetch'
import type { GitHubFetchInit } from '../../shared/ipc-channels'

function parseNextLink(linkHeader: string | null): string | null {
  if (!linkHeader) return null
  const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/)
  return match ? match[1] : null
}

export function registerGitHandlers(): void {
  // --- GitHub API proxy (renderer → main → api.github.com) ---
  safeHandle('github:fetch', async (_e, path: string, init?: GitHubFetchInit) => {
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

    // Strip Authorization from caller headers — token is injected server-side only
    const { Authorization: _, ...safeHeaders } = init?.headers ?? {}
    const res = await authenticatedGitHubFetch(url, {
      method: init?.method,
      headers: safeHeaders,
      body: init?.body,
    })

    const contentType = res.headers.get('content-type') ?? ''
    const body = contentType.includes('json') ? await res.json() : await res.text()
    const linkNext = parseNextLink(res.headers.get('Link'))

    return { ok: res.ok, status: res.status, body, linkNext }
  })

  // TODO: AX-S1 — add 'get-repo-paths' to IpcChannelMap
  safeHandle('get-repo-paths', () => getRepoPaths())

  // --- Git client IPC ---
  safeHandle('git:status', (_e, cwd: string) => gitStatus(cwd))
  safeHandle('git:diff', (_e, cwd: string, file?: string) => gitDiffFile(cwd, file))
  // TODO: AX-S1 — add 'git:stage' through 'git:checkout' to IpcChannelMap
  safeHandle('git:stage', (_e, cwd: string, files: string[]) => gitStage(cwd, files))
  safeHandle('git:unstage', (_e, cwd: string, files: string[]) => gitUnstage(cwd, files))
  safeHandle('git:commit', (_e, cwd: string, message: string) => gitCommit(cwd, message))
  safeHandle('git:push', (_e, cwd: string) => gitPush(cwd))
  safeHandle('git:branches', (_e, cwd: string) => gitBranches(cwd))
  safeHandle('git:checkout', (_e, cwd: string, branch: string) => gitCheckout(cwd, branch))

  // --- PR status polling ---
  // TODO: AX-S1 — add 'poll-pr-statuses' to IpcChannelMap
  safeHandle('poll-pr-statuses', (_e, prs: PrStatusInput[]) => pollPrStatuses(prs))

  // --- Conflict file detection ---
  safeHandle('check-conflict-files', (_e, input: ConflictFilesInput) => checkConflictFiles(input))

  // --- Open PR list (main-process poller is the source of truth) ---
  safeHandle('pr:get-list', () => getLatestPrList() ?? { prs: [], checks: {} })
  safeHandle('pr:refresh-list', () => refreshPrList())
}
