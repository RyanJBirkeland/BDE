import { BrowserWindow } from 'electron'
import { getGitHubToken } from './config'
import type { OpenPr, CheckRunSummary, PrListPayload } from '../shared/types'

const POLL_INTERVAL_MS = 60_000
const REQUEST_TIMEOUT_MS = 10_000

const REPOS = [
  { owner: 'RyanJBirkeland', repo: 'BDE' },
  { owner: 'RyanJBirkeland', repo: 'life-os' },
  { owner: 'RyanJBirkeland', repo: 'feast' },
] as const

let timer: ReturnType<typeof setInterval> | null = null
let latestPayload: PrListPayload | null = null

async function fetchOpenPrs(
  owner: string,
  repo: string,
  token: string
): Promise<OpenPr[]> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/pulls?state=open&per_page=20`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      }
    )
    if (!res.ok) return []
    const data = (await res.json()) as OpenPr[]
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
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/commits/${sha}/check-runs`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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

  const results = await Promise.all(
    REPOS.map((r) => fetchOpenPrs(r.owner, r.repo, token))
  )
  const prs = results
    .flat()
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())

  const checks: Record<string, CheckRunSummary> = {}
  const checkPromises = prs.map(async (pr) => {
    const repoConfig = REPOS.find((r) => r.repo === pr.repo)
    if (!repoConfig) return
    const summary = await fetchCheckRuns(repoConfig.owner, repoConfig.repo, pr.head.sha, token)
    checks[`${pr.repo}-${pr.number}`] = summary
  })
  await Promise.all(checkPromises)

  latestPayload = { prs, checks }
  broadcast(latestPayload)
}

function broadcast(payload: PrListPayload): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('pr:list-updated', payload)
  }
}

export function startPrPoller(): void {
  poll()
  timer = setInterval(poll, POLL_INTERVAL_MS)
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
