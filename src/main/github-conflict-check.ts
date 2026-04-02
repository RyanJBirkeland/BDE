import { getGitHubToken } from './config'
import { githubFetch, fetchAllGitHubPages } from './github-fetch'

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

  try {
    // Fetch PR details for branch names
    const prRes = await githubFetch(
      `https://api.github.com/repos/${input.owner}/${input.repo}/pulls/${input.prNumber}`,
      {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
        timeoutMs: 10_000
      }
    )
    if (!prRes.ok) return empty
    const prData = (await prRes.json()) as {
      head: { ref: string }
      base: { ref: string }
    }

    // Fetch the list of changed files in the PR (paginated)
    const filesData = await fetchAllGitHubPages<{ filename: string }>(
      `https://api.github.com/repos/${input.owner}/${input.repo}/pulls/${input.prNumber}/files?per_page=100`,
      { token, timeoutMs: 10_000 }
    )

    return {
      prNumber: input.prNumber,
      files: filesData.map((f) => f.filename),
      baseBranch: prData.base.ref,
      headBranch: prData.head.ref
    }
  } catch {
    return empty
  }
}
