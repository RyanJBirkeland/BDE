import { broadcast as broadcastEvent } from './broadcast'
import { getGitHubToken } from './config'
import { githubFetchJson, fetchAllGitHubPages } from './github-fetch'
import { getConfiguredRepos } from './paths'
import { createLogger } from './logger'
import type { OpenPr, CheckRunSummary, PrListPayload } from '../shared/types'
import { getErrorMessage } from '../shared/errors'

export const POLL_INTERVAL_MS = 60_000
const REQUEST_TIMEOUT_MS = 10_000
const MAX_ERROR_COUNT = 10
const logger = createLogger('pr-poller')

function getGitHubRepos(): { owner: string; repo: string }[] {
  return getConfiguredRepos()
    .filter((r) => r.githubOwner && r.githubRepo)
    .map((r) => ({ owner: r.githubOwner!, repo: r.githubRepo! }))
}

let timer: ReturnType<typeof setInterval> | null = null
let latestPayload: PrListPayload | null = null
let errorCount = 0
// Backoff state — tracks when the next poll is allowed.
// Using state (not timer recreation) so startPrPoller uses a single
// setInterval rather than clearInterval+setInterval on every tick.
let nextPollAt = 0

function isOpenPr(item: unknown): item is OpenPr {
  if (typeof item !== 'object' || item === null) return false
  const pr = item as Record<string, unknown>
  return typeof pr.number === 'number' && typeof pr.html_url === 'string'
}

async function fetchOpenPrs(owner: string, repo: string, token: string): Promise<OpenPr[]> {
  try {
    const data = await fetchAllGitHubPages<OpenPr>(
      `https://api.github.com/repos/${owner}/${repo}/pulls?state=open&per_page=100`,
      { token, timeoutMs: REQUEST_TIMEOUT_MS, validate: isOpenPr }
    )
    return data.map((pr) => ({ ...pr, repo }))
  } catch (err) {
    logger.warn(`Failed to fetch PRs for ${owner}/${repo}: ${getErrorMessage(err)}`)
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
  const result = await githubFetchJson<{
    total_count: number
    check_runs: { status: string; conclusion: string | null }[]
  }>(`https://api.github.com/repos/${owner}/${repo}/commits/${sha}/check-runs`, token, {
    timeoutMs: REQUEST_TIMEOUT_MS
  })
  // On any error, degrade to the "pending" sentinel so the UI doesn't flash
  // false positives. Error details are logged + broadcast by githubFetchJson
  // via `github:error` for the renderer toast system to surface.
  if (!result.ok) return empty

  const data = result.data
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
}

async function poll(): Promise<void> {
  const token = getGitHubToken()
  if (!token) return

  const repos = getGitHubRepos()
  const settled = await Promise.allSettled(repos.map((r) => fetchOpenPrs(r.owner, r.repo, token)))
  const results = settled
    .filter((r): r is PromiseFulfilledResult<OpenPr[]> => r.status === 'fulfilled')
    .map((r) => r.value)
  settled
    .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    .forEach((r) => logger.warn(`[pr-poller] Repo fetch failed: ${r.reason}`))
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
  await Promise.allSettled(checkPromises)

  latestPayload = { prs, checks }
  broadcastPrList(latestPayload)
}

function broadcastPrList(payload: PrListPayload): void {
  broadcastEvent('pr:listUpdated', payload)
}

function safePoll(): void {
  // Backoff gate — skip this tick if we're still within a backoff window.
  if (Date.now() < nextPollAt) return

  logger.event('pr-poller.tick.start', { errorCount })

  poll()
    .then(() => {
      errorCount = 0
      nextPollAt = 0
      logger.event('pr-poller.tick.end', { ok: true })
    })
    .catch((err) => {
      errorCount = Math.min(errorCount + 1, MAX_ERROR_COUNT)
      const backoffMs = Math.min(POLL_INTERVAL_MS * Math.pow(2, errorCount - 1), 300_000)
      nextPollAt = Date.now() + backoffMs
      logger.error(`PR poller error: ${getErrorMessage(err)}`)
      logger.event('pr-poller.tick.end', { ok: false, error: getErrorMessage(err), backoffMs })
      logger.warn(`PR poller backing off for ${backoffMs}ms after ${errorCount} consecutive errors`)
    })
}

export function startPrPoller(): void {
  // Guard against double-start — clear any existing interval first.
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  // Reset backoff state so a previous error backoff doesn't delay the
  // first poll after a settings change or app restart.
  errorCount = 0
  nextPollAt = 0
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
