import { parsePrUrl } from '../shared/github'
import { getGitHubToken } from './config'
import { githubFetch } from './github-fetch'

export interface PrStatusInput {
  taskId: string
  prUrl: string
}

export interface PrStatusResult {
  taskId: string
  merged: boolean
  state: string
  mergedAt: string | null
  mergeableState: string | null
}

async function fetchPrStatusRest(pr: PrStatusInput): Promise<PrStatusResult> {
  const errorResult: PrStatusResult = {
    taskId: pr.taskId,
    merged: false,
    state: 'error',
    mergedAt: null,
    mergeableState: null
  }
  const parsed = parsePrUrl(pr.prUrl)
  if (!parsed)
    return {
      taskId: pr.taskId,
      merged: false,
      state: 'unknown',
      mergedAt: null,
      mergeableState: null
    }

  const token = getGitHubToken()
  if (!token) return errorResult

  try {
    const response = await githubFetch(
      `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/pulls/${parsed.number}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json'
        },
        timeoutMs: 10_000
      }
    )
    if (!response.ok) return errorResult

    const data = (await response.json()) as {
      state: string
      merged_at: string | null
      mergeable_state?: string
    }
    const merged = data.state === 'closed' && data.merged_at !== null
    const state = data.merged_at ? 'MERGED' : data.state.toUpperCase()
    const mergeableState = data.mergeable_state ?? null
    return { taskId: pr.taskId, merged, state, mergedAt: data.merged_at ?? null, mergeableState }
  } catch {
    return errorResult
  }
}

export async function pollPrStatuses(prs: PrStatusInput[]): Promise<PrStatusResult[]> {
  return Promise.all(prs.map(fetchPrStatusRest))
}
