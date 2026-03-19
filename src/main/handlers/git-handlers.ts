import { resolve } from 'path'
import { safeHandle } from '../ipc-utils'
import { getDb } from '../db'
import { parsePrUrl } from '../../shared/github'
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
import type { GitHubFetchInit } from '../../shared/ipc-channels'

/** Ensures cwd is under a known repository root. */
function validateRepoCwd(cwd: string): string {
  const resolved = resolve(cwd)
  const repoPaths = Object.values(getRepoPaths()).map(p => resolve(p))
  const allowed = repoPaths.some(
    root => resolved.startsWith(root + '/') || resolved === root
  )
  if (!allowed) {
    throw new Error(`CWD rejected: not under a known repository`)
  }
  return resolved
}

function markTaskDoneOnMerge(prNumber: number): void {
  try {
    const completedAt = new Date().toISOString()
    getDb()
      .prepare(
        "UPDATE sprint_tasks SET status='done', completed_at=? WHERE pr_number=? AND status='active'"
      )
      .run(completedAt, prNumber)
  } catch (err) {
    console.warn(`[git] failed to mark task done for PR #${prNumber}:`, err)
  }
}

function markTaskCancelled(prNumber: number): void {
  try {
    getDb()
      .prepare(
        "UPDATE sprint_tasks SET status='cancelled', completed_at=? WHERE pr_number=? AND status='active'"
      )
      .run(new Date().toISOString(), prNumber)
  } catch (err) {
    console.warn(`[git] failed to mark task cancelled for PR #${prNumber}:`, err)
  }
}

function updateMergeableState(prNumber: number, mergeableState: string | null): void {
  if (!mergeableState) return
  try {
    getDb()
      .prepare('UPDATE sprint_tasks SET pr_mergeable_state = ? WHERE pr_number = ?')
      .run(mergeableState, prNumber)
  } catch (err) {
    console.warn(`[git] failed to update mergeable_state for PR #${prNumber}:`, err)
  }
}

export function registerGitHandlers(): void {
  // --- GitHub API proxy (renderer -> main -> api.github.com) ---
  safeHandle('github:fetch', async (_e, path: string, init?: GitHubFetchInit) => {
    const token = getGitHubToken()
    if (!token) throw new Error('GitHub token not configured')

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
  safeHandle('git:status', (_e, cwd: string) => gitStatus(validateRepoCwd(cwd)))
  safeHandle('git:diff', (_e, cwd: string, file?: string) => gitDiffFile(validateRepoCwd(cwd), file))
  safeHandle('git:stage', (_e, cwd: string, files: string[]) => gitStage(validateRepoCwd(cwd), files))
  safeHandle('git:unstage', (_e, cwd: string, files: string[]) => gitUnstage(validateRepoCwd(cwd), files))
  safeHandle('git:commit', (_e, cwd: string, message: string) => gitCommit(validateRepoCwd(cwd), message))
  safeHandle('git:push', (_e, cwd: string) => gitPush(validateRepoCwd(cwd)))
  safeHandle('git:branches', (_e, cwd: string) => gitBranches(validateRepoCwd(cwd)))
  safeHandle('git:checkout', (_e, cwd: string, branch: string) => gitCheckout(validateRepoCwd(cwd), branch))

  // --- PR status polling ---
  safeHandle('pr:pollStatuses', async (_e, prs: PrStatusInput[]) => {
    const results = await pollPrStatuses(prs)
    for (const result of results) {
      const input = prs.find((p) => p.taskId === result.taskId)
      const prNumber = input ? parsePrUrl(input.prUrl)?.number : undefined
      if (!prNumber) continue
      if (result.merged) {
        markTaskDoneOnMerge(prNumber)
      } else if (result.state === 'CLOSED') {
        markTaskCancelled(prNumber)
      }
      updateMergeableState(prNumber, result.mergeableState)
    }
    return results
  })

  // --- Conflict file detection ---
  safeHandle('pr:checkConflictFiles', (_e, input: ConflictFilesInput) => checkConflictFiles(input))

  // --- Open PR list (main-process poller is the source of truth) ---
  safeHandle('pr:getList', () => getLatestPrList() ?? { prs: [], checks: {} })
  safeHandle('pr:refreshList', () => refreshPrList())
}
