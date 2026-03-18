let cachedToken: string | null = null

async function getToken(): Promise<string> {
  if (cachedToken) return cachedToken
  const token = await window.api.getGitHubToken()
  if (!token) throw new Error('GitHub token not configured')
  cachedToken = token
  return token
}

async function githubFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = await getToken()
  return fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      ...init?.headers
    }
  })
}

export interface PullRequest {
  number: number
  title: string
  html_url: string
  state: string
  draft: boolean
  created_at: string
  updated_at: string
  head: { ref: string; sha: string }
  base: { ref: string }
  user: { login: string }
  merged: boolean
  merged_at: string | null
  additions: number
  deletions: number
  repo: string
}

export async function listOpenPRs(owner: string, repo: string): Promise<PullRequest[]> {
  const res = await githubFetch(`/repos/${owner}/${repo}/pulls?state=open&per_page=20`)
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`)
  const data = await res.json()
  return (data as PullRequest[]).map((pr) => ({ ...pr, repo }))
}

export interface PrMergeability {
  number: number
  repo: string
  mergeable: boolean | null
  mergeable_state: string | null
}

export async function getPrMergeability(
  owner: string,
  repo: string,
  prNumber: number
): Promise<PrMergeability> {
  const res = await githubFetch(`/repos/${owner}/${repo}/pulls/${prNumber}`)
  if (!res.ok) return { number: prNumber, repo, mergeable: null, mergeable_state: null }
  const data = (await res.json()) as { mergeable: boolean | null; mergeable_state: string | null }
  return {
    number: prNumber,
    repo,
    mergeable: data.mergeable ?? null,
    mergeable_state: data.mergeable_state ?? null,
  }
}

export async function checkOpenPrsMergeability(
  owner: string,
  repo: string,
  prs: PullRequest[]
): Promise<PrMergeability[]> {
  return Promise.all(prs.map((pr) => getPrMergeability(owner, repo, pr.number)))
}

export function parsePrUrl(url: string): { owner: string; repo: string; number: number } | null {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/)
  if (!match) return null
  return { owner: match[1], repo: match[2], number: parseInt(match[3], 10) }
}

export type CheckStatus = 'pending' | 'pass' | 'fail'

export interface CheckRunSummary {
  status: CheckStatus
  total: number
  passed: number
  failed: number
  pending: number
}

export async function getCheckRuns(owner: string, repo: string, sha: string): Promise<CheckRunSummary> {
  const res = await githubFetch(`/repos/${owner}/${repo}/commits/${sha}/check-runs`)
  if (!res.ok) return { status: 'pending', total: 0, passed: 0, failed: 0, pending: 0 }
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
  const total = data.total_count
  const status: CheckStatus = failed > 0 ? 'fail' : pending > 0 ? 'pending' : 'pass'
  return { status, total, passed, failed, pending }
}

export async function getPRDiff(owner: string, repo: string, number: number): Promise<string> {
  const token = await getToken()
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${number}`, {
    headers: {
      Accept: 'application/vnd.github.diff',
      Authorization: `Bearer ${token}`
    }
  })
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`)
  return res.text()
}


export interface PRDetail {
  number: number
  title: string
  body: string | null
  draft: boolean
  mergeable: boolean | null
  head: { ref: string; sha: string }
  base: { ref: string }
  user: { login: string; avatar_url: string }
  additions: number
  deletions: number
  labels: { name: string; color: string }[]
}

export async function getPRDetail(
  owner: string,
  repo: string,
  number: number
): Promise<PRDetail> {
  const res = await githubFetch(`/repos/${owner}/${repo}/pulls/${number}`)
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`)
  const data = (await res.json()) as PRDetail
  return data
}

export interface PRFile {
  filename: string
  status: string
  additions: number
  deletions: number
}

export async function getPRFiles(
  owner: string,
  repo: string,
  number: number
): Promise<PRFile[]> {
  const res = await githubFetch(`/repos/${owner}/${repo}/pulls/${number}/files?per_page=100`)
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`)
  return (await res.json()) as PRFile[]
}

export interface CheckRun {
  name: string
  status: string
  conclusion: string | null
  html_url: string
}

export async function getCheckRunsList(
  owner: string,
  repo: string,
  sha: string
): Promise<CheckRun[]> {
  const res = await githubFetch(`/repos/${owner}/${repo}/commits/${sha}/check-runs`)
  if (!res.ok) return []
  const data = (await res.json()) as { check_runs: CheckRun[] }
  return data.check_runs
}

export type MergeMethod = 'squash' | 'merge' | 'rebase'

export async function mergePR(
  owner: string,
  repo: string,
  number: number,
  method: MergeMethod = 'squash',
  commitTitle?: string
): Promise<void> {
  const body: Record<string, string> = { merge_method: method }
  if (commitTitle) body.commit_title = commitTitle
  const res = await githubFetch(`/repos/${owner}/${repo}/pulls/${number}/merge`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(
      `Merge failed: ${res.status} — ${(err as { message?: string }).message ?? 'unknown'}`
    )
  }
}

export async function closePR(owner: string, repo: string, number: number): Promise<void> {
  const res = await githubFetch(`/repos/${owner}/${repo}/pulls/${number}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: 'closed' })
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(
      `Close failed: ${res.status} — ${(err as { message?: string }).message ?? 'unknown'}`
    )
  }
}
