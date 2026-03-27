import { broadcast as broadcastEvent } from './broadcast'
import { getGitHubToken } from './config'
import { githubFetch, fetchAllGitHubPages } from './github-fetch'
import { getConfiguredRepos } from './paths'
import type { OpenPr, CheckRunSummary, PrListPayload } from '../shared/types'

const POLL_INTERVAL_MS = 60_000
const REQUEST_TIMEOUT_MS = 10_000

function getGitHubRepos(): { owner: string; repo: string }[] {
  return getConfiguredRepos()
    .filter((r) => r.githubOwner && r.githubRepo)
    .map((r) => ({ owner: r.githubOwner!, repo: r.githubRepo! }))
}

let timer: ReturnType<typeof setInterval> | null = null
let latestPayload: PrListPayload | null = null

async function fetchOpenPrs(owner: string, repo: string, token: string): Promise<OpenPr[]> {
  try {
    const data = await fetchAllGitHubPages<OpenPr>(
      `https://api.github.com/repos/${owner}/${repo}/pulls?state=open&per_page=100`,
      { token, timeoutMs: REQUEST_TIMEOUT_MS }
    )
    return data.map((pr) => ({ ...pr, repo }))
  } catch {
    return []
  }
}

async function fetchCheckRuns(
  owner: string,
  repo: string,
  sha: string,
  token: string
): Promise<CheckRunSummary> {
  const empty: CheckRunSummary = { status: 'pending', total: 0, passed: 0, failed: 0, pending: 0 }
  try {
    const res = await githubFetch(
      `https://api.github.com/repos/${owner}/${repo}/commits/${sha}/check-runs`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json'
        },
        timeoutMs: REQUEST_TIMEOUT_MS
      }
    )
    if (!res.ok) return empty
    const data = (await res.json()) as {
      total_count: number
      check_runs: { status: string; conclusion: string | null }[]
    }
    let passed = 0
    let failed = 0
    let pending = 0
    for (const run of data.check_runs) {
      if (run.status !== 'completed') pending++
      else if (run.conclusion === 'success' || run.conclusion === 'skipped') passed++
      else failed++
    }
    const status: CheckRunSummary['status'] = failed > 0 ? 'fail' : pending > 0 ? 'pending' : 'pass'
    return { status, total: data.total_count, passed, failed, pending }
  } catch {
    return empty
  }
}

async function poll(): Promise<void> {
  const token = getGitHubToken()
  if (!token) return

  const repos = getGitHubRepos()
  const results = await Promise.all(repos.map((r) => fetchOpenPrs(r.owner, r.repo, token)))
  const prs = results
    .flat()
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())

  const checks: Record<string, CheckRunSummary> = {}
  const checkPromises = prs.map(async (pr) => {
    const repoConfig = repos.find((r) => r.repo === pr.repo)
    if (!repoConfig) return
    const summary = await fetchCheckRuns(repoConfig.owner, repoConfig.repo, pr.head.sha, token)
    checks[`${pr.repo}-${pr.number}`] = summary
  })
  await Promise.all(checkPromises)

  latestPayload = { prs, checks }
  broadcastPrList(latestPayload)
}

function broadcastPrList(payload: PrListPayload): void {
  broadcastEvent('pr:listUpdated', payload)
}

function safePoll(): void {
  poll().catch(err => console.error('[pr-poller] poll error:', err))
}

export function startPrPoller(): void {
  safePoll()
  timer = setInterval(safePoll, POLL_INTERVAL_MS)
}

export function stopPrPoller(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

/** Return the most recent poll result (for on-demand IPC requests). */
export function getLatestPrList(): PrListPayload | null {
  return latestPayload
}

/** Force an immediate poll and return results. */
export async function refreshPrList(): Promise<PrListPayload> {
  await poll()
  return latestPayload ?? { prs: [], checks: {} }
}
