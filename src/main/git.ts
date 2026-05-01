import { stat } from 'node:fs/promises'
import { execFileAsync } from './lib/async-utils'
import { resolveGitExecutable } from './agent-manager/resolve-git'

import type { Result } from '../shared/types'
import { getErrorMessage } from '../shared/errors'
import { parseGitHubRemote } from '../shared/git-remote'

// `getRepoPaths` / `getRepoPath` belong to repo configuration, not to git
// operations — re-exported here for backward compatibility while callers
// migrate to `./paths` directly. New code should import from `./paths`.
export { getRepoPaths, getRepoPath } from './paths'

const MAX_BUFFER = 10 * 1024 * 1024

export interface GitFileStatus {
  path: string
  status: string
  staged: boolean
}

function git(): string {
  return resolveGitExecutable() ?? 'git'
}

export async function gitStatus(
  cwd: string
): Promise<Result<{ files: GitFileStatus[]; branch: string }>> {
  try {
    const { stdout } = await execFileAsync(git(), ['status', '--porcelain', '--branch'], {
      cwd,
      encoding: 'utf-8' as const,
      maxBuffer: MAX_BUFFER
    })
    const files: GitFileStatus[] = []
    let branch = ''

    for (const line of stdout.split('\n')) {
      if (!line.trim()) continue

      // Parse branch line (## branch_name or ## branch_name...origin/branch_name)
      if (line.startsWith('## ')) {
        const branchPart = line.slice(3)
        const dotIndex = branchPart.indexOf('...')
        branch = dotIndex > 0 ? branchPart.slice(0, dotIndex) : branchPart
        continue
      }

      const index = line[0] ?? ' '
      const worktree = line[1] ?? ' '
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
    return { ok: true, data: { files, branch } }
  } catch (err) {
    return { ok: false, error: `git status failed in ${cwd}: ${(err as Error).message}` }
  }
}

/**
 * Detect a GitHub remote for the given local directory.
 *
 * - Checks `<dir>/.git` exists (works for both regular repos and worktrees).
 * - Runs `git remote get-url origin` via execFile (no shell interpolation).
 * - Parses the URL via `parseGitHubRemote` in shared/git-remote.
 */
export async function detectGitRemote(cwd: string): Promise<{
  isGitRepo: boolean
  remoteUrl: string | null
  owner: string | null
  repo: string | null
}> {
  try {
    // Confirm .git exists (file for worktrees, dir for regular repos)
    try {
      await stat(`${cwd}/.git`)
    } catch {
      return { isGitRepo: false, remoteUrl: null, owner: null, repo: null }
    }

    const { stdout } = await execFileAsync(git(), ['remote', 'get-url', 'origin'], {
      cwd,
      encoding: 'utf-8' as const,
      maxBuffer: MAX_BUFFER
    })
    const remoteUrl = stdout.trim() || null
    const parsed = parseGitHubRemote(remoteUrl)
    return {
      isGitRepo: true,
      remoteUrl,
      owner: parsed?.owner ?? null,
      repo: parsed?.repo ?? null
    }
  } catch {
    // `git remote get-url origin` exits non-zero if no remote
    return { isGitRepo: true, remoteUrl: null, owner: null, repo: null }
  }
}

export async function gitDiffFile(cwd: string, file?: string): Promise<Result<string>> {
  try {
    const unstagedArgs = file ? ['diff', '--', file] : ['diff']
    const stagedArgs = file ? ['diff', '--cached', '--', file] : ['diff', '--cached']
    const opts = { cwd, encoding: 'utf-8' as const, maxBuffer: MAX_BUFFER }
    const { stdout: unstaged } = await execFileAsync(git(), unstagedArgs, opts)
    const { stdout: staged } = await execFileAsync(git(), stagedArgs, opts)
    return { ok: true, data: staged + unstaged }
  } catch (err) {
    return {
      ok: false,
      error: `git diff failed in ${cwd}${file ? ` for ${file}` : ''}: ${(err as Error).message}`
    }
  }
}

export async function gitStage(cwd: string, files: string[]): Promise<void> {
  if (files.length === 0) return
  await execFileAsync(git(), ['add', '--', ...files], {
    cwd,
    encoding: 'utf-8' as const,
    maxBuffer: MAX_BUFFER
  })
}

export async function gitUnstage(cwd: string, files: string[]): Promise<void> {
  if (files.length === 0) return
  await execFileAsync(git(), ['reset', 'HEAD', '--', ...files], {
    cwd,
    encoding: 'utf-8' as const,
    maxBuffer: MAX_BUFFER
  })
}

export async function gitCommit(cwd: string, message: string): Promise<void> {
  await execFileAsync(git(), ['commit', '-m', message], {
    cwd,
    encoding: 'utf-8' as const,
    maxBuffer: MAX_BUFFER
  })
}

export async function gitPush(cwd: string): Promise<string> {
  try {
    const { stdout, stderr } = await execFileAsync(git(), ['push'], {
      cwd,
      encoding: 'utf-8' as const,
      maxBuffer: MAX_BUFFER
    })
    return (stdout + stderr).trim() || 'Pushed successfully'
  } catch (err: unknown) {
    const msg = getErrorMessage(err)
    throw new Error(`git push failed in ${cwd}: ${msg}`)
  }
}

export async function gitBranches(cwd: string): Promise<{ current: string; branches: string[] }> {
  try {
    const { stdout } = await execFileAsync(git(), ['branch'], {
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
  await execFileAsync(git(), ['checkout', branch], {
    cwd,
    encoding: 'utf-8' as const,
    maxBuffer: MAX_BUFFER
  })
}

export async function gitFetch(
  cwd: string
): Promise<{ success: boolean; error?: string; stdout?: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(git(), ['fetch', 'origin'], {
      cwd,
      encoding: 'utf-8' as const,
      maxBuffer: MAX_BUFFER
    })
    return { success: true, stdout: (stdout + stderr).trim() || 'Fetched from origin' }
  } catch (err: unknown) {
    const msg = getErrorMessage(err)
    return { success: false, error: `git fetch failed in ${cwd}: ${msg}` }
  }
}

export async function gitPull(
  cwd: string,
  currentBranch: string
): Promise<{ success: boolean; error?: string; stdout?: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(
      git(),
      ['pull', '--ff-only', 'origin', currentBranch],
      {
        cwd,
        encoding: 'utf-8' as const,
        maxBuffer: MAX_BUFFER
      }
    )
    return { success: true, stdout: (stdout + stderr).trim() || 'Pulled from origin' }
  } catch (err: unknown) {
    const msg = getErrorMessage(err)
    // Check if the error is due to non-fast-forward
    if (msg.includes('non-fast-forward') || msg.includes('diverged')) {
      return { success: false, error: 'Local branch has diverged from origin. Resolve manually.' }
    }
    return { success: false, error: `git pull failed in ${cwd}: ${msg}` }
  }
}
