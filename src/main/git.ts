import { readFile } from 'fs/promises'
import { execSync } from 'child_process'
import { homedir } from 'os'
import { join } from 'path'

const REPO_PATHS: Record<string, string> = {
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
