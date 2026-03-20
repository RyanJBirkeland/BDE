import { execFile } from 'child_process'
import { promisify } from 'util'

import { parsePrUrl } from '../shared/github'
import type { Result } from '../shared/types'
import { getGitHubToken } from './config'
import { githubFetch, fetchAllGitHubPages } from './github-fetch'
import { getRepoPaths as getRepoPathsFromSettings } from './paths'

const execFileAsync = promisify(execFile)

export function getRepoPaths(): Record<string, string> {
  return getRepoPathsFromSettings()
}

export interface GitFileStatus {
  path: string
  status: string
  staged: boolean
}

export async function gitStatus(cwd: string): Promise<Result<{ files: GitFileStatus[] }>> {
  try {
    const { stdout } = await execFileAsync('git', ['status', '--porcelain'], {
      cwd,
      encoding: 'utf-8' as const,
      maxBuffer: 10 * 1024 * 1024
    })
    const files: GitFileStatus[] = []
    for (const line of stdout.split('\n')) {
      if (!line.trim()) continue
      const index = line[0]
      const worktree = line[1]
      const filePath = line.slice(3)
      if (index !== ' ' && index !== '?') {
        files.push({ path: filePath, status: index, staged: true })
      }
      if (worktree !== ' ' && index !== '?') {
        files.push({ path: filePath, status: worktree, staged: false })
      }
      if (index === '?') {
        files.push({ path: filePath, status: '?', staged: false })
      }
    }
    return { ok: true, data: { files } }
  } catch (err) {
    return { ok: false, error: `git status failed in ${cwd}: ${(err as Error).message}` }
  }
}

export async function gitDiffFile(cwd: string, file?: string): Promise<Result<string>> {
  try {
    const unstagedArgs = file ? ['diff', '--', file] : ['diff']
    const stagedArgs = file ? ['diff', '--cached', '--', file] : ['diff', '--cached']
    const opts = { cwd, encoding: 'utf-8' as const, maxBuffer: 10 * 1024 * 1024 }
    const { stdout: unstaged } = await execFileAsync('git', unstagedArgs, opts)
    const { stdout: staged } = await execFileAsync('git', stagedArgs, opts)
    return { ok: true, data: staged + unstaged }
  } catch (err) {
    return { ok: false, error: `git diff failed in ${cwd}${file ? ` for ${file}` : ''}: ${(err as Error).message}` }
  }
}

export async function gitStage(cwd: string, files: string[]): Promise<void> {
  if (files.length === 0) return
  await execFileAsync('git', ['add', '--', ...files], {
    cwd,
    encoding: 'utf-8' as const,
    maxBuffer: 10 * 1024 * 1024
  })
}

export async function gitUnstage(cwd: string, files: string[]): Promise<void> {
  if (files.length === 0) return
  await execFileAsync('git', ['reset', 'HEAD', '--', ...files], {
    cwd,
    encoding: 'utf-8' as const,
    maxBuffer: 10 * 1024 * 1024
  })
}

export async function gitCommit(cwd: string, message: string): Promise<void> {
  await execFileAsync('git', ['commit', '-m', message], {
    cwd,
    encoding: 'utf-8' as const,
    maxBuffer: 10 * 1024 * 1024
  })
}

export async function gitPush(cwd: string): Promise<string> {
  const { stdout, stderr } = await execFileAsync('git', ['push'], {
    cwd,
    encoding: 'utf-8' as const,
    maxBuffer: 10 * 1024 * 1024
  })
  return (stdout + stderr).trim() || 'Pushed successfully'
}

export async function gitBranches(
  cwd: string
): Promise<{ current: string; branches: string[] }> {
  try {
    const { stdout } = await execFileAsync('git', ['branch'], {
      cwd,
      encoding: 'utf-8' as const,
      maxBuffer: 10 * 1024 * 1024
    })
    const branches: string[] = []
    let current = ''
    for (const line of stdout.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      if (line.startsWith('* ')) {
        current = trimmed.slice(2)
        branches.push(current)
      } else {
        branches.push(trimmed)
      }
    }
    return { current, branches }
  } catch {
    return { current: '', branches: [] }
  }
}

export async function gitCheckout(cwd: string, branch: string): Promise<void> {
  await execFileAsync('git', ['checkout', branch], {
    cwd,
    encoding: 'utf-8' as const,
    maxBuffer: 10 * 1024 * 1024
  })
}

// --- PR status polling via GitHub REST API ---

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
  const errorResult: PrStatusResult = { taskId: pr.taskId, merged: false, state: 'error', mergedAt: null, mergeableState: null }
  const parsed = parsePrUrl(pr.prUrl)
  if (!parsed) return { taskId: pr.taskId, merged: false, state: 'unknown', mergedAt: null, mergeableState: null }

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

// --- Conflict file detection ---

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
  const empty: ConflictFilesResult = { prNumber: input.prNumber, files: [], baseBranch: '', headBranch: '' }
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
      headBranch: prData.head.ref,
    }
  } catch {
    return empty
  }
}
