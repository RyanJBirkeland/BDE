/**
 * GitHubProxyService — owns the renderer-facing GitHub API proxy semantics.
 *
 * The IPC handler (`github:fetch`) used to inline path normalisation, the
 * endpoint allowlist check, header sanitisation, and the response-shape
 * adapter. Those rules belong to the proxy itself, not to the wire boundary,
 * so this service hosts them and the handler shrinks to a thin call site.
 *
 * Side-effect-free with respect to FLEET state — the only escape is the outbound
 * HTTPS request via `githubFetch`.
 */

import type { GitHubFetchInit } from '../../shared/ipc-channels'
import { createLogger } from '../logger'
import { getGitHubToken } from '../config'
import { getSettingJson } from '../settings'
import { githubFetch, parseNextLink } from '../github-fetch'

const logger = createLogger('github-proxy-service')

const REQUEST_TIMEOUT_MS = 30_000

interface RepoConfig {
  name: string
  localPath: string
  githubOwner?: string
  githubRepo?: string
  color?: string
}

const GITHUB_API_ALLOWLIST: Array<{ method: string; pattern: RegExp }> = [
  { method: 'GET', pattern: /^\/user$/ },
  { method: 'GET', pattern: /^\/repos\/[^/]+\/[^/]+\/pulls/ },
  { method: 'GET', pattern: /^\/repos\/[^/]+\/[^/]+\/issues/ },
  { method: 'GET', pattern: /^\/repos\/[^/]+\/[^/]+\/commits/ },
  { method: 'GET', pattern: /^\/repos\/[^/]+\/[^/]+\/branches/ },
  { method: 'GET', pattern: /^\/repos\/[^/]+\/[^/]+\/check-runs/ },
  { method: 'POST', pattern: /^\/repos\/[^/]+\/[^/]+\/pulls\/\d+\/reviews/ },
  { method: 'POST', pattern: /^\/repos\/[^/]+\/[^/]+\/pulls\/\d+\/comments/ },
  { method: 'PUT', pattern: /^\/repos\/[^/]+\/[^/]+\/pulls\/\d+\/merge/ },
  { method: 'PATCH', pattern: /^\/repos\/[^/]+\/[^/]+\/pulls\/\d+/ }
]

const PR_PATCH_ALLOWED_FIELDS = new Set(['title', 'body', 'state'])

export interface GitHubProxyResult {
  ok: boolean
  status: number
  body: unknown
  linkNext: string | null
}

export async function proxyGitHubRequest(
  path: string,
  init?: GitHubFetchInit
): Promise<GitHubProxyResult> {
  const token = getGitHubToken()
  if (!token) return missingTokenResult()

  const target = resolveGitHubUrl(path)
  if (!target) return rejectedHostResult()

  const method = init?.method ?? 'GET'
  if (!isRequestAllowed(method, target.apiPath, init?.body)) {
    logger.warn(`github:fetch rejected: ${method} ${target.apiPath}`)
    return rejectedRequestResult(method, target.apiPath)
  }

  const response = await dispatchRequest(target.url, init, token)
  return adaptResponse(response)
}

function resolveGitHubUrl(path: string): { url: string; apiPath: string } | null {
  if (!path.startsWith('https://')) {
    return { url: `https://api.github.com${path}`, apiPath: path }
  }
  const parsed = new URL(path)
  if (parsed.hostname !== 'api.github.com') return null
  return { url: path, apiPath: parsed.pathname }
}

function isRequestAllowed(method: string, apiPath: string, body: string | undefined): boolean {
  const upper = method.toUpperCase()
  const matchesAllowlist = GITHUB_API_ALLOWLIST.some(
    (entry) => entry.method === upper && entry.pattern.test(apiPath)
  )
  if (!matchesAllowlist) return false

  const repoInfo = extractRepoFromPath(apiPath)
  if (repoInfo && !isRepoConfigured(repoInfo)) {
    logger.warn(`github:fetch rejected: repo ${repoInfo.owner}/${repoInfo.repo} not configured`)
    return false
  }

  if (upper === 'PATCH' && /^\/repos\/[^/]+\/[^/]+\/pulls\/\d+$/.test(apiPath)) {
    if (!isPatchBodyAllowed(body)) {
      logger.warn(`github:fetch rejected: PATCH body contains disallowed fields`)
      return false
    }
  }
  return true
}

function extractRepoFromPath(apiPath: string): { owner: string; repo: string } | null {
  const match = apiPath.match(/^\/repos\/([^/]+)\/([^/]+)/)
  if (!match) return null
  const [, owner, repo] = match
  if (!owner || !repo) return null
  return { owner, repo }
}

function isRepoConfigured(repo: { owner: string; repo: string }): boolean {
  const repos = getSettingJson<RepoConfig[]>('repos')
  if (!repos) return false
  for (const config of repos) {
    if (config.githubOwner && config.githubRepo) {
      if (config.githubOwner === repo.owner && config.githubRepo === repo.repo) return true
    } else if (config.githubOwner && config.name) {
      if (config.githubOwner === repo.owner && config.name === repo.repo) return true
    }
  }
  return false
}

function isPatchBodyAllowed(body: string | undefined): boolean {
  if (!body) return true
  try {
    const parsed = JSON.parse(body)
    return Object.keys(parsed).every((field) => PR_PATCH_ALLOWED_FIELDS.has(field))
  } catch {
    return false
  }
}

async function dispatchRequest(
  url: string,
  init: GitHubFetchInit | undefined,
  token: string
): Promise<Response> {
  const { Authorization: _, ...safeHeaders } = init?.headers ?? {}
  return githubFetch(url, {
    method: init?.method,
    headers: { ...safeHeaders, Authorization: `Bearer ${token}` },
    body: init?.body,
    timeoutMs: REQUEST_TIMEOUT_MS
  })
}

async function adaptResponse(response: Response): Promise<GitHubProxyResult> {
  const contentType = response.headers.get('content-type') ?? ''
  const body = contentType.includes('json') ? await response.json() : await response.text()
  const linkNext = parseNextLink(response.headers.get('Link'))
  return { ok: response.ok, status: response.status, body, linkNext }
}

function missingTokenResult(): GitHubProxyResult {
  return {
    ok: false,
    status: 0,
    body: { error: 'GitHub token not configured. Set it in Settings → Connections.' },
    linkNext: null
  }
}

function rejectedHostResult(): GitHubProxyResult {
  return {
    ok: false,
    status: 0,
    body: { error: 'github:fetch only allows api.github.com URLs' },
    linkNext: null
  }
}

function rejectedRequestResult(method: string, apiPath: string): GitHubProxyResult {
  return {
    ok: false,
    status: 0,
    body: {
      error:
        `GitHub API request not allowed: ${method} ${apiPath}. ` +
        'Only specific read and PR-related operations are permitted.'
    },
    linkNext: null
  }
}
