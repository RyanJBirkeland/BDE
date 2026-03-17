import { execFileSync, spawnSync } from 'child_process'
import { homedir } from 'os'
import { join } from 'path'

import { getGitHubToken } from './config'
import { getDb } from './db'

const REPO_PATHS: Record<string, string> = {
  BDE: join(homedir(), 'Documents', 'Repositories', 'BDE'),
  'life-os': join(homedir(), 'Documents', 'Repositories', 'life-os'),
  feast: join(homedir(), 'Documents', 'Repositories', 'feast')
}

export function getRepoPaths(): Record<string, string> {
  return { ...REPO_PATHS }
}

export interface GitFileStatus {
  path: string
  status: string
  staged: boolean
}

export function gitStatus(cwd: string): { files: GitFileStatus[] } {
  try {
    const raw = execFileSync('git', ['status', '--porcelain'], {
      cwd,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024
    })
    const files: GitFileStatus[] = []
    for (const line of raw.split('\n')) {
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

export function gitDiffFile(cwd: string, file?: string): string {
  try {
    const unstagedArgs = file ? ['diff', '--', file] : ['diff']
    const stagedArgs = file ? ['diff', '--cached', '--', file] : ['diff', '--cached']
    const opts = { cwd, encoding: 'utf-8' as const, maxBuffer: 10 * 1024 * 1024 }
    const unstaged = execFileSync('git', unstagedArgs, opts)
    const staged = execFileSync('git', stagedArgs, opts)
    return staged + unstaged
  } catch {
    return ''
  }
}

export function gitStage(cwd: string, files: string[]): void {
  if (files.length === 0) return
  execFileSync('git', ['add', '--', ...files], { cwd, encoding: 'utf-8' })
}

export function gitUnstage(cwd: string, files: string[]): void {
  if (files.length === 0) return
  execFileSync('git', ['reset', 'HEAD', '--', ...files], { cwd, encoding: 'utf-8' })
}

export function gitCommit(cwd: string, message: string): void {
  execFileSync('git', ['commit', '-m', message], { cwd, encoding: 'utf-8' })
}

export function gitPush(cwd: string): string {
  const result = spawnSync('git', ['push'], {
    cwd,
    encoding: 'utf-8',
    maxBuffer: 10 * 1024 * 1024
  })
  if (result.error) throw new Error(result.error.message)
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `git push exited with code ${result.status}`)
  }
  return (result.stdout + result.stderr).trim() || 'Pushed successfully'
}

export function gitBranches(cwd: string): { current: string; branches: string[] } {
  try {
    const raw = execFileSync('git', ['branch'], { cwd, encoding: 'utf-8' })
    const branches: string[] = []
    let current = ''
    for (const line of raw.split('\n')) {
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

export function gitCheckout(cwd: string, branch: string): void {
  execFileSync('git', ['checkout', branch], { cwd, encoding: 'utf-8' })
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
}

function parsePrUrl(url: string): { owner: string; repo: string; number: string } | null {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/)
  if (!match) return null
  return { owner: match[1], repo: match[2], number: match[3] }
}

async function fetchPrStatusRest(pr: PrStatusInput): Promise<PrStatusResult> {
  const errorResult: PrStatusResult = { taskId: pr.taskId, merged: false, state: 'error', mergedAt: null }
  const parsed = parsePrUrl(pr.prUrl)
  if (!parsed) return { taskId: pr.taskId, merged: false, state: 'unknown', mergedAt: null }

  const token = getGitHubToken()
  if (!token) return errorResult

  try {
    const response = await fetch(
      `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/pulls/${parsed.number}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json'
        },
        signal: AbortSignal.timeout(10_000)
      }
    )
    if (!response.ok) return errorResult

    const data = (await response.json()) as { state: string; merged_at: string | null }
    const merged = data.state === 'closed' && data.merged_at !== null
    const state = data.merged_at ? 'MERGED' : data.state.toUpperCase()
    return { taskId: pr.taskId, merged, state, mergedAt: data.merged_at ?? null }
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

export async function pollPrStatuses(prs: PrStatusInput[]): Promise<PrStatusResult[]> {
  const results = await Promise.all(prs.map(fetchPrStatusRest))
  for (const result of results) {
    const input = prs.find((p) => p.taskId === result.taskId)
    const prNumber = input ? parsePrUrl(input.prUrl)?.number : null
    if (!prNumber) continue
    if (result.merged) {
      markTaskDoneOnMerge(parseInt(prNumber, 10))
    } else if (result.state === 'CLOSED') {
      markTaskCancelled(parseInt(prNumber, 10))
    }
  }
  return results
}
