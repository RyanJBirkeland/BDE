import { execFile } from 'child_process'
import { promisify } from 'util'

import type { Result } from '../shared/types'
import { getRepoPaths as getRepoPathsFromSettings } from './paths'

const execFileAsync = promisify(execFile)

const MAX_BUFFER = 10 * 1024 * 1024

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
      maxBuffer: MAX_BUFFER
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
    const opts = { cwd, encoding: 'utf-8' as const, maxBuffer: MAX_BUFFER }
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
    maxBuffer: MAX_BUFFER
  })
}

export async function gitUnstage(cwd: string, files: string[]): Promise<void> {
  if (files.length === 0) return
  await execFileAsync('git', ['reset', 'HEAD', '--', ...files], {
    cwd,
    encoding: 'utf-8' as const,
    maxBuffer: MAX_BUFFER
  })
}

export async function gitCommit(cwd: string, message: string): Promise<void> {
  await execFileAsync('git', ['commit', '-m', message], {
    cwd,
    encoding: 'utf-8' as const,
    maxBuffer: MAX_BUFFER
  })
}

export async function gitPush(cwd: string): Promise<string> {
  try {
    const { stdout, stderr } = await execFileAsync('git', ['push'], {
      cwd,
      encoding: 'utf-8' as const,
      maxBuffer: MAX_BUFFER
    })
    return (stdout + stderr).trim() || 'Pushed successfully'
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`git push failed in ${cwd}: ${msg}`)
  }
}

export async function gitBranches(
  cwd: string
): Promise<{ current: string; branches: string[] }> {
  try {
    const { stdout } = await execFileAsync('git', ['branch'], {
      cwd,
      encoding: 'utf-8' as const,
      maxBuffer: MAX_BUFFER
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
    maxBuffer: MAX_BUFFER
  })
}

