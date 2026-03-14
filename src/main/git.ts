import { readFile } from 'fs/promises'
import { execSync } from 'child_process'
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
    return execSync(`git diff ${ref}...HEAD`, {
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
    return execSync('git branch --show-current', {
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
    return execSync(`git log --oneline -${count}`, {
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
    const raw = execSync('git status --porcelain', {
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
    const cmd = file ? `git diff -- ${file}` : 'git diff'
    const stagedCmd = file ? `git diff --cached -- ${file}` : 'git diff --cached'
    const unstaged = execSync(cmd, { cwd, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 })
    const staged = execSync(stagedCmd, { cwd, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 })
    return staged + unstaged
  } catch {
    return ''
  }
}

export function gitStage(cwd: string, files: string[]): void {
  if (files.length === 0) return
  const escaped = files.map((f) => `"${f}"`).join(' ')
  execSync(`git add ${escaped}`, { cwd, encoding: 'utf-8' })
}

export function gitUnstage(cwd: string, files: string[]): void {
  if (files.length === 0) return
  const escaped = files.map((f) => `"${f}"`).join(' ')
  execSync(`git reset HEAD ${escaped}`, { cwd, encoding: 'utf-8' })
}

export function gitCommit(cwd: string, message: string): void {
  execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, { cwd, encoding: 'utf-8' })
}

export function gitPush(cwd: string): string {
  try {
    return execSync('git push 2>&1', { cwd, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 })
  } catch (e) {
    if (e instanceof Error && 'stdout' in e) {
      const err = e as Error & { stdout?: string; stderr?: string }
      return err.stdout || err.stderr || e.message
    }
    return e instanceof Error ? e.message : 'Push failed'
  }
}

export function gitBranches(cwd: string): { current: string; branches: string[] } {
  try {
    const raw = execSync('git branch', { cwd, encoding: 'utf-8' })
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
  execSync(`git checkout "${branch.replace(/"/g, '\\"')}"`, { cwd, encoding: 'utf-8' })
}
