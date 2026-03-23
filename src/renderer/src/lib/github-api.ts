import type { GitHubFetchInit, GitHubFetchResult } from '../../../shared/ipc-channels'
import type { PrReview, PrComment, PrIssueComment } from '../../../shared/types'

/**
 * All GitHub REST API calls are proxied through the main process via IPC.
 * The token never enters renderer memory — auth is handled entirely in main.
 */

async function githubFetchRaw(
  path: string,
  init?: GitHubFetchInit
): Promise<GitHubFetchResult> {
  return window.api.github.fetch(path, init)
}

async function fetchAllPages<T>(path: string): Promise<T[]> {
  const items: T[] = []

  let res = await githubFetchRaw(path)
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`)
  items.push(...(res.body as T[]))

  let nextUrl = res.linkNext
  while (nextUrl) {
    res = await githubFetchRaw(nextUrl)
    if (!res.ok) throw new Error(`GitHub API error: ${res.status}`)
    items.push(...(res.body as T[]))
    nextUrl = res.linkNext
  }

  return items
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
  repo: string
}

export async function listOpenPRs(owner: string, repo: string): Promise<PullRequest[]> {
  const data = await fetchAllPages<PullRequest>(
    `/repos/${owner}/${repo}/pulls?state=open&per_page=100`
  )
  return data.map((pr) => ({ ...pr, repo }))
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
  prNumber: number,
  _signal?: AbortSignal
): Promise<PrMergeability> {
  const res = await githubFetchRaw(`/repos/${owner}/${repo}/pulls/${prNumber}`)
  if (!res.ok) return { number: prNumber, repo, mergeable: null, mergeable_state: null }
  const data = res.body as { mergeable: boolean | null; mergeable_state: string | null }
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

export type CheckStatus = 'pending' | 'pass' | 'fail'

export interface CheckRunSummary {
  status: CheckStatus
  total: number
  passed: number
  failed: number
  pending: number
}

export async function getCheckRuns(owner: string, repo: string, sha: string): Promise<CheckRunSummary> {
  const res = await githubFetchRaw(`/repos/${owner}/${repo}/commits/${sha}/check-runs`)
  if (!res.ok) return { status: 'pending', total: 0, passed: 0, failed: 0, pending: 0 }
  const data = res.body as {
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
  const res = await githubFetchRaw(`/repos/${owner}/${repo}/pulls/${number}`, {
    headers: { Accept: 'application/vnd.github.diff' }
  })
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`)
  return res.body as string
}


export interface PRDetail {
  number: number
  title: string
  body: string | null
  draft: boolean
  mergeable: boolean | null
  mergeable_state: string | null
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
  const res = await githubFetchRaw(`/repos/${owner}/${repo}/pulls/${number}`)
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`)
  return res.body as PRDetail
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
  return fetchAllPages<PRFile>(`/repos/${owner}/${repo}/pulls/${number}/files?per_page=100`)
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
  const res = await githubFetchRaw(`/repos/${owner}/${repo}/commits/${sha}/check-runs`)
  if (!res.ok) return []
  const data = res.body as { check_runs: CheckRun[] }
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
  const res = await githubFetchRaw(`/repos/${owner}/${repo}/pulls/${number}/merge`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (!res.ok) {
    const err = (res.body ?? {}) as { message?: string }
    throw new Error(
      `Merge failed: ${res.status} — ${err.message ?? 'unknown'}`
    )
  }
}

export async function getReviews(
  owner: string,
  repo: string,
  number: number
): Promise<PrReview[]> {
  return fetchAllPages<PrReview>(
    `/repos/${owner}/${repo}/pulls/${number}/reviews?per_page=100`
  )
}

export async function getReviewComments(
  owner: string,
  repo: string,
  number: number
): Promise<PrComment[]> {
  return fetchAllPages<PrComment>(
    `/repos/${owner}/${repo}/pulls/${number}/comments?per_page=100`
  )
}

export async function getIssueComments(
  owner: string,
  repo: string,
  number: number
): Promise<PrIssueComment[]> {
  return fetchAllPages<PrIssueComment>(
    `/repos/${owner}/${repo}/issues/${number}/comments?per_page=100`
  )
}

export interface CreateReviewBody {
  body?: string
  event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'
  comments?: Array<{
    path: string
    line: number
    side: 'RIGHT' | 'LEFT'
    start_line?: number
    start_side?: 'RIGHT' | 'LEFT'
    body: string
  }>
}

export async function createReview(
  owner: string,
  repo: string,
  number: number,
  review: CreateReviewBody
): Promise<void> {
  const res = await githubFetchRaw(`/repos/${owner}/${repo}/pulls/${number}/reviews`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(review)
  })
  if (!res.ok) {
    const err = (res.body ?? {}) as { message?: string }
    throw new Error(`Review failed: ${res.status} — ${err.message ?? 'unknown'}`)
  }
}

export async function replyToComment(
  owner: string,
  repo: string,
  number: number,
  commentId: number,
  body: string
): Promise<PrComment> {
  const res = await githubFetchRaw(
    `/repos/${owner}/${repo}/pulls/${number}/comments/${commentId}/replies`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body })
    }
  )
  if (!res.ok) {
    const err = (res.body ?? {}) as { message?: string }
    throw new Error(`Reply failed: ${res.status} — ${err.message ?? 'unknown'}`)
  }
  return res.body as PrComment
}

export async function closePR(owner: string, repo: string, number: number): Promise<void> {
  const res = await githubFetchRaw(`/repos/${owner}/${repo}/pulls/${number}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: 'closed' })
  })
  if (!res.ok) {
    const err = (res.body ?? {}) as { message?: string }
    throw new Error(
      `Close failed: ${res.status} — ${err.message ?? 'unknown'}`
    )
  }
}
