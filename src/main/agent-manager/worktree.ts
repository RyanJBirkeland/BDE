import { execFile } from 'node:child_process'
import { mkdirSync, existsSync, readdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { promisify } from 'node:util'
import path from 'node:path'
import { buildAgentEnv } from '../env-utils'
import type { Logger } from './types'

const execFileAsync = promisify(execFile)

export function branchNameForTask(title: string, taskId?: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  const suffix = taskId ? `-${taskId.slice(0, 8)}` : ''
  return `agent/${slug}${suffix}`
}

export interface SetupWorktreeOpts {
  repoPath: string
  worktreeBase: string
  taskId: string
  title: string
}

export interface SetupWorktreeResult {
  worktreePath: string
  branch: string
}

function repoSlug(repoPath: string): string {
  return repoPath.replace(/[^a-z0-9]/gi, '-').replace(/^-+|-+$/g, '')
}

function lockPath(worktreeBase: string, repoPath: string): string {
  return path.join(worktreeBase, '.locks', `${repoSlug(repoPath)}.lock`)
}

function acquireLock(worktreeBase: string, repoPath: string, logger?: Logger): void {
  const locksDir = path.join(worktreeBase, '.locks')
  mkdirSync(locksDir, { recursive: true })

  const lockFile = lockPath(worktreeBase, repoPath)

  if (existsSync(lockFile)) {
    const raw = readFileSync(lockFile, 'utf-8').trim()
    const pid = parseInt(raw, 10)
    if (isNaN(pid)) {
      ;(logger ?? console).warn(`[worktree] Corrupted lock file for ${repoPath} — removing`)
      rmSync(lockFile)
    } else {
      let alive = false
      try {
        process.kill(pid, 0)
        alive = true
      } catch {
        alive = false
      }
      if (alive) {
        throw new Error(`Worktree lock held by PID ${pid} for repo ${repoPath}`)
      }
    }
  }

  writeFileSync(lockFile, String(process.pid), 'utf-8')
}

function releaseLock(worktreeBase: string, repoPath: string): void {
  const lockFile = lockPath(worktreeBase, repoPath)
  try {
    rmSync(lockFile)
  } catch {
    // best-effort
  }
}

export async function setupWorktree(opts: SetupWorktreeOpts & { logger?: Logger }): Promise<SetupWorktreeResult> {
  const { repoPath, worktreeBase, taskId, title, logger } = opts
  const branch = branchNameForTask(title, taskId)
  const repoDir = path.join(worktreeBase, repoSlug(repoPath))
  const worktreePath = path.join(repoDir, taskId)

  mkdirSync(repoDir, { recursive: true })

  acquireLock(worktreeBase, repoPath, logger)

  // Validate repo path exists and is a git repository
  if (!existsSync(repoPath) || !existsSync(path.join(repoPath, '.git'))) {
    releaseLock(worktreeBase, repoPath)
    throw new Error(`Repo path does not exist or is not a git repository: ${repoPath}`)
  }

  try {
    await execFileAsync('git', ['worktree', 'add', '-b', branch, worktreePath], { cwd: repoPath, env: buildAgentEnv() })
  } catch (err) {
    // If branch already exists (stale from previous failed run), delete and retry
    const errMsg = err instanceof Error ? err.message : String(err)
    if (errMsg.includes('already exists')) {
      ;(logger ?? console).warn(`[worktree] Stale branch ${branch} — deleting and retrying`)
      try {
        await execFileAsync('git', ['worktree', 'prune'], { cwd: repoPath, env: buildAgentEnv() })
        // Check for unpushed work before destroying branch
        try {
          const { stdout: aheadCount } = await execFileAsync(
            'git', ['rev-list', '--count', `main..${branch}`],
            { cwd: repoPath, env: buildAgentEnv() }
          )
          if (parseInt(aheadCount.trim(), 10) > 0) {
            ;(logger ?? console).warn(
              `[worktree] Branch ${branch} has ${aheadCount.trim()} unpushed commits — pushing before delete`
            )
            try {
              await execFileAsync('git', ['push', 'origin', branch], { cwd: repoPath, env: buildAgentEnv() })
            } catch (pushErr) {
              ;(logger ?? console).warn(`[worktree] Failed to push ${branch}: ${pushErr} — proceeding with delete`)
            }
          }
        } catch {
          // Branch may not have commits relative to main — proceed
        }
        await execFileAsync('git', ['branch', '-D', branch], { cwd: repoPath, env: buildAgentEnv() })
        await execFileAsync('git', ['worktree', 'add', '-b', branch, worktreePath], { cwd: repoPath, env: buildAgentEnv() })
      } catch (retryErr) {
        // Retry failed — clean up and throw
        try { rmSync(worktreePath, { recursive: true, force: true }) } catch { /* best-effort */ }
        releaseLock(worktreeBase, repoPath)
        throw retryErr
      }
    } else {
      // Non-branch-exists error — clean up and throw
      try {
        await execFileAsync('git', ['worktree', 'remove', worktreePath, '--force'], { cwd: repoPath, env: buildAgentEnv() })
      } catch {
        // best-effort
      }
      try {
        rmSync(worktreePath, { recursive: true, force: true })
      } catch {
        // best-effort
      }
      releaseLock(worktreeBase, repoPath)
      throw err
    }
  }

  releaseLock(worktreeBase, repoPath)
  return { worktreePath, branch }
}

export interface CleanupWorktreeOpts {
  repoPath: string
  worktreePath: string
  branch: string
}

export function cleanupWorktree(opts: CleanupWorktreeOpts): void {
  const { repoPath, worktreePath, branch } = opts

  execFile('git', ['worktree', 'remove', worktreePath, '--force'], { cwd: repoPath }, () => {
    // best-effort
  })

  execFile('git', ['branch', '-D', branch], { cwd: repoPath }, () => {
    // best-effort
  })
}

export async function pruneStaleWorktrees(
  worktreeBase: string,
  isActive: (taskId: string) => boolean
): Promise<number> {
  let pruned = 0

  if (!existsSync(worktreeBase)) return pruned

  const repoDirs = readdirSync(worktreeBase, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== '.locks')
    .map((d) => path.join(worktreeBase, d.name))

  for (const repoDir of repoDirs) {
    let taskDirs: string[]
    try {
      taskDirs = readdirSync(repoDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
    } catch {
      continue
    }

    for (const taskId of taskDirs) {
      if (!isActive(taskId)) {
        const worktreePath = path.join(repoDir, taskId)
        try {
          rmSync(worktreePath, { recursive: true, force: true })
          pruned++
        } catch {
          // best-effort
        }
      }
    }
  }

  return pruned
}
