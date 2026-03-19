import { execFile } from 'child_process'
import { promisify } from 'util'

import { parsePrUrl } from '../shared/github'
import { getGitHubToken } from './config'
import { getDb } from './db'
import { authenticatedGitHubFetch } from './github-fetch'
import { DEFAULT_REPO_PATHS } from './paths'

const execFileAsync = promisify(execFile)

export function getRepoPaths(): Record<string, string> {
  return { ...DEFAULT_REPO_PATHS }
}

export interface GitFileStatus {
  path: string
  status: string
  staged: boolean
}

export async function gitStatus(cwd: string): Promise<{ files: GitFileStatus[] }> {
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
    return { files }
  } catch {
    return { files: [] }
  }
}

export async function gitDiffFile(cwd: string, file?: string): Promise<string> {
  try {
    const unstagedArgs = file ? ['diff', '--', file] : ['diff']
    const stagedArgs = file ? ['diff', '--cached', '--', file] : ['diff', '--cached']
    const opts = { cwd, encoding: 'utf-8' as const, maxBuffer: 10 * 1024 * 1024 }
    const { stdout: unstaged } = await execFileAsync('git', unstagedArgs, opts)
    const { stdout: staged } = await execFileAsync('git', stagedArgs, opts)
    return staged + unstaged
  } catch {
    return ''
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

  if (!getGitHubToken()) return errorResult

  try {
    const response = await authenticatedGitHubFetch(
      `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/pulls/${parsed.number}`,
      { timeoutMs: 10_000 }
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

function markTaskDoneOnMerge(prNumber: number): void {
  try {
    const completedAt = new Date().toISOString()
    getDb()
      .prepare(
        "UPDATE sprint_tasks SET status='done', completed_at=? WHERE pr_number=? AND status='active'"
      )
      .run(completedAt, prNumber)
  } catch (err) {
    console.warn(`[git] failed to mark task done for PR #${prNumber}:`, err)
  }
}

function markTaskCancelled(prNumber: number): void {
  try {
    getDb()
      .prepare(
        "UPDATE sprint_tasks SET status='cancelled', completed_at=? WHERE pr_number=? AND status='active'"
      )
      .run(new Date().toISOString(), prNumber)
  } catch (err) {
    console.warn(`[git] failed to mark task cancelled for PR #${prNumber}:`, err)
  }
}

function updateMergeableState(prNumber: number, mergeableState: string | null): void {
  if (!mergeableState) return
  try {
    getDb()
      .prepare('UPDATE sprint_tasks SET pr_mergeable_state = ? WHERE pr_number = ?')
      .run(mergeableState, prNumber)
  } catch (err) {
    console.warn(`[git] failed to update mergeable_state for PR #${prNumber}:`, err)
  }
}

export async function pollPrStatuses(prs: PrStatusInput[]): Promise<PrStatusResult[]> {
  const results = await Promise.all(prs.map(fetchPrStatusRest))
  for (const result of results) {
    const input = prs.find((p) => p.taskId === result.taskId)
    const prNumber = input ? parsePrUrl(input.prUrl)?.number : undefined
    if (!prNumber) continue
    if (result.merged) {
      markTaskDoneOnMerge(prNumber)
    } else if (result.state === 'CLOSED') {
      markTaskCancelled(prNumber)
    }
    updateMergeableState(prNumber, result.mergeableState)
  }
  return results
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
  if (!getGitHubToken()) return empty

  try {
    // Fetch PR details for branch names
    const prRes = await authenticatedGitHubFetch(
      `https://api.github.com/repos/${input.owner}/${input.repo}/pulls/${input.prNumber}`,
      { timeoutMs: 10_000 }
    )
    if (!prRes.ok) return empty
    const prData = (await prRes.json()) as {
      head: { ref: string }
      base: { ref: string }
    }

    // Fetch the list of changed files in the PR
    const filesRes = await authenticatedGitHubFetch(
      `https://api.github.com/repos/${input.owner}/${input.repo}/pulls/${input.prNumber}/files?per_page=100`,
      { timeoutMs: 10_000 }
    )
    if (!filesRes.ok) return empty
    const filesData = (await filesRes.json()) as Array<{ filename: string }>

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
