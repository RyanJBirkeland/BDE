import { getGitHubToken } from './config'
import { githubFetchJson, fetchAllGitHubPages } from './github-fetch'

export interface ConflictFilesInput {
  owner: string
  repo: string
  prNumber: number
}

export interface ConflictFilesResult {
  prNumber: number
  files: string[]
  baseBranch: string
  headBranch: string
}

export async function checkConflictFiles(input: ConflictFilesInput): Promise<ConflictFilesResult> {
  const empty: ConflictFilesResult = {
    prNumber: input.prNumber,
    files: [],
    baseBranch: '',
    headBranch: ''
  }
  const token = getGitHubToken()
  if (!token) return empty

  // Fetch PR details for branch names. Structured error is broadcast by the
  // wrapper; we degrade to empty here so the caller sees a no-conflict state
  // rather than a throw.
  const prResult = await githubFetchJson<{
    head: { ref: string }
    base: { ref: string }
  }>(`https://api.github.com/repos/${input.owner}/${input.repo}/pulls/${input.prNumber}`, token, {
    timeoutMs: 10_000
  })
  if (!prResult.ok) return empty

  // Fetch the list of changed files in the PR (paginated)
  // fetchAllGitHubPages returns [] on any HTTP error (already degrades
  // gracefully per its existing contract).
  const filesData = await fetchAllGitHubPages<{ filename: string }>(
    `https://api.github.com/repos/${input.owner}/${input.repo}/pulls/${input.prNumber}/files?per_page=100`,
    { token, timeoutMs: 10_000 }
  )

  return {
    prNumber: input.prNumber,
    files: filesData.map((f) => f.filename),
    baseBranch: prResult.data.base.ref,
    headBranch: prResult.data.head.ref
  }
}
