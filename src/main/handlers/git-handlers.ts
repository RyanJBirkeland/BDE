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
  gitCheckout
} from '../git'
import { pollPrStatuses, type PrStatusInput } from '../github-pr-status'
import { checkConflictFiles, type ConflictFilesInput } from '../github-conflict-check'
import { getLatestPrList, refreshPrList } from '../pr-poller'
import { getGitHubToken } from '../config'
import { githubFetch, parseNextLink } from '../github-fetch'
import {
  markTaskDoneByPrNumber,
  markTaskCancelledByPrNumber,
  updateTaskMergeableState
} from './sprint-local'
import type { GitHubFetchInit } from '../../shared/ipc-channels'
import { createLogger } from '../logger'
import { getSettingJson } from '../settings'

const logger = createLogger('git-handlers')

interface RepoConfig {
  name: string
  localPath: string
  githubOwner?: string
  githubRepo?: string
  color?: string
}

/**
 * Get configured repos from settings.
 * Returns a Set of "owner/repo" strings for fast lookup.
 */
function getConfiguredRepos(): Set<string> {
  const repos = getSettingJson<RepoConfig[]>('repos')
  if (!repos) return new Set()

  const repoSet = new Set<string>()
  for (const repo of repos) {
    if (repo.githubOwner && repo.githubRepo) {
      repoSet.add(`${repo.githubOwner}/${repo.githubRepo}`)
    } else if (repo.githubOwner && repo.name) {
      // Use name as repo if githubRepo not specified
      repoSet.add(`${repo.githubOwner}/${repo.name}`)
    }
  }
  return repoSet
}

/**
 * Extract owner/repo from GitHub API path.
 * Returns null if path doesn't match expected format.
 */
function extractRepoFromPath(path: string): { owner: string; repo: string } | null {
  const match = path.match(/^\/repos\/([^/]+)\/([^/]+)/)
  if (!match) return null
  return { owner: match[1], repo: match[2] }
}

/**
 * Validate that PATCH body only contains allowed fields (title, body).
 * Returns true if valid, false otherwise.
 */
function validatePatchBody(body: string | undefined): boolean {
  if (!body) return true // Empty body is OK

  try {
    const parsed = JSON.parse(body)
    const allowedFields = new Set(['title', 'body'])
    const actualFields = Object.keys(parsed)

    // Check if all fields are allowed
    return actualFields.every((field) => allowedFields.has(field))
  } catch {
    // If we can't parse it, reject it
    return false
  }
}

// GitHub API endpoint + method allowlist for security
const GITHUB_API_ALLOWLIST: Array<{ method: string; pattern: RegExp }> = [
  { method: 'GET', pattern: /^\/repos\/[^/]+\/[^/]+\/pulls/ },
  { method: 'GET', pattern: /^\/repos\/[^/]+\/[^/]+\/issues/ },
  { method: 'GET', pattern: /^\/repos\/[^/]+\/[^/]+\/commits/ },
  { method: 'GET', pattern: /^\/repos\/[^/]+\/[^/]+\/branches/ },
  { method: 'GET', pattern: /^\/repos\/[^/]+\/[^/]+\/check-runs/ },
  { method: 'POST', pattern: /^\/repos\/[^/]+\/[^/]+\/pulls\/\d+\/reviews/ },
  { method: 'POST', pattern: /^\/repos\/[^/]+\/[^/]+\/pulls\/\d+\/comments/ },
  { method: 'PUT', pattern: /^\/repos\/[^/]+\/[^/]+\/pulls\/\d+\/merge/ },
  { method: 'PATCH', pattern: /^\/repos\/[^/]+\/[^/]+\/pulls\/\d+/ },
  // Add more as needed — but NO DELETE, no admin endpoints
]

function isGitHubRequestAllowed(method: string, path: string, body?: string): boolean {
  const normalizedMethod = method.toUpperCase()

  // First check if method/path match the allowlist pattern
  const matchesPattern = GITHUB_API_ALLOWLIST.some(
    (entry) => entry.method === normalizedMethod && entry.pattern.test(path)
  )
  if (!matchesPattern) return false

  // PR-3: Validate repo is in configured repos
  const repoInfo = extractRepoFromPath(path)
  if (repoInfo) {
    const configuredRepos = getConfiguredRepos()
    const repoKey = `${repoInfo.owner}/${repoInfo.repo}`
    if (!configuredRepos.has(repoKey)) {
      logger.warn(`github:fetch rejected: repo ${repoKey} not in configured repos`)
      return false
    }
  }

  // PR-4: For PATCH requests on PRs, only allow title/body fields
  if (normalizedMethod === 'PATCH' && /^\/repos\/[^/]+\/[^/]+\/pulls\/\d+$/.test(path)) {
    if (!validatePatchBody(body)) {
      logger.warn(`github:fetch rejected: PATCH body contains disallowed fields`)
      return false
    }
  }

  return true
}

let _onStatusTerminal: ((taskId: string, status: string) => void) | null = null

export function setGitHandlersOnStatusTerminal(
  fn: (taskId: string, status: string) => void
): void {
  _onStatusTerminal = fn
}

export function registerGitHandlers(): void {
  // --- GitHub API proxy (renderer -> main -> api.github.com) ---
  safeHandle('github:fetch', async (_e, path: string, init?: GitHubFetchInit) => {
    const token = getGitHubToken()
    if (!token)
      throw new Error('GitHub token not configured. Set it in Settings \u2192 Connections.')

    let url: string
    let apiPath: string
    if (path.startsWith('https://')) {
      const parsed = new URL(path)
      if (parsed.hostname !== 'api.github.com') {
        throw new Error('github:fetch only allows api.github.com URLs')
      }
      url = path
      apiPath = parsed.pathname
    } else {
      url = `https://api.github.com${path}`
      apiPath = path
    }

    // Validate request against allowlist
    const method = init?.method ?? 'GET'
    if (!isGitHubRequestAllowed(method, apiPath, init?.body)) {
      logger.warn(`github:fetch rejected: ${method} ${apiPath}`)
      throw new Error(
        `GitHub API request not allowed: ${method} ${apiPath}. ` +
          'Only specific read and PR-related operations are permitted.'
      )
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
      logger.warn(`git:status ${result.error}`)
      return { files: [], branch: '' }
    }
    return result.data
  })
  safeHandle('git:diff', async (_e, cwd: string, file?: string) => {
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
  safeHandle('git:checkout', (_e, cwd: string, branch: string) =>
    gitCheckout(validateRepoPath(cwd), branch)
  )

  // --- PR status polling ---
  safeHandle('pr:pollStatuses', async (_e, prs: PrStatusInput[]) => {
    const results = await pollPrStatuses(prs)
    for (const result of results) {
      const input = prs.find((p) => p.taskId === result.taskId)
      const prNumber = input ? parsePrUrl(input.prUrl)?.number : undefined
      if (!prNumber) continue
      if (result.merged) {
        const ids = markTaskDoneByPrNumber(prNumber)
        for (const id of ids) _onStatusTerminal?.(id, 'done')
      } else if (result.state === 'CLOSED') {
        const ids = markTaskCancelledByPrNumber(prNumber)
        for (const id of ids) _onStatusTerminal?.(id, 'cancelled')
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
