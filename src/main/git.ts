import { readFile } from 'fs/promises'
import { execFileSync, spawnSync } from 'child_process'
import { homedir } from 'os'
import { join } from 'path'

const REPO_PATHS: Record<string, string> = {
  BDE: join(homedir(), 'Documents', 'Repositories', 'BDE'),
  'life-os': join(homedir(), 'Documents', 'Repositories', 'life-os'),
  feast: join(homedir(), 'Documents', 'Repositories', 'feast')
}

export function getRepoPaths(): Record<string, string> {
  return { ...REPO_PATHS }
}

export async function readSprintMd(repoPath: string): Promise<string> {
  const filePath = join(repoPath, 'SPRINT.md')
  return readFile(filePath, 'utf-8')
}

export function getDiff(repoPath: string, base?: string): string {
  const ref = base ?? 'origin/main'
  try {
    return execFileSync('git', ['diff', `${ref}...HEAD`], {
      cwd: repoPath,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024
    })
  } catch {
    return ''
  }
}

export function getBranch(repoPath: string): string {
  try {
    return execFileSync('git', ['branch', '--show-current'], {
      cwd: repoPath,
      encoding: 'utf-8'
    }).trim()
  } catch {
    return ''
  }
}

export function getLog(repoPath: string, n?: number): string {
  const count = n ?? 10
  try {
    return execFileSync('git', ['log', '--oneline', `-${count}`], {
      cwd: repoPath,
      encoding: 'utf-8'
    }).trim()
  } catch {
    return ''
  }
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

// --- PR status polling via `gh` CLI ---

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

function fetchPrStatus(pr: PrStatusInput): PrStatusResult {
  const parsed = parsePrUrl(pr.prUrl)
  if (!parsed) return { taskId: pr.taskId, merged: false, state: 'unknown', mergedAt: null }
  try {
    const raw = execFileSync(
      'gh',
      ['pr', 'view', parsed.number, '--repo', `${parsed.owner}/${parsed.repo}`, '--json', 'state,mergedAt'],
      { encoding: 'utf-8', timeout: 10_000 }
    )
    const data = JSON.parse(raw) as { state: string; mergedAt: string | null }
    return { taskId: pr.taskId, merged: data.state === 'MERGED', state: data.state, mergedAt: data.mergedAt ?? null }
  } catch {
    return { taskId: pr.taskId, merged: false, state: 'error', mergedAt: null }
  }
}

export function pollPrStatuses(prs: PrStatusInput[]): PrStatusResult[] {
  return prs.map(fetchPrStatus)
}
