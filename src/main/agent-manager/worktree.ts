import { execFile } from 'node:child_process'
import { mkdirSync, existsSync, readdirSync, writeFileSync, readFileSync, rmSync, renameSync } from 'node:fs'
import { promisify } from 'node:util'
import path from 'node:path'
import { buildAgentEnv } from '../env-utils'
import { BRANCH_SLUG_MAX_LENGTH } from './types'
import type { Logger } from './types'

const execFileAsync = promisify(execFile)

export function branchNameForTask(title: string, taskId?: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, BRANCH_SLUG_MAX_LENGTH)
  // Fallback to 'unnamed-task' if slug is empty (all special chars)
  const finalSlug = slug || 'unnamed-task'
  const suffix = taskId ? `-${taskId.slice(0, 8)}` : ''
  return `agent/${finalSlug}${suffix}`
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

  // Try atomic create — fails if file already exists
  try {
    writeFileSync(lockFile, String(process.pid), { flag: 'wx' })
    return // Lock acquired
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
    // Lock file exists — check if holder is alive
  }

  // Lock file exists — read PID and check liveness
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
    // Stale lock — PID is dead
  }

  // Re-acquire atomically after cleaning stale lock using rename (atomic on POSIX)
  const tempLockFile = lockFile + `.${process.pid}.tmp`
  writeFileSync(tempLockFile, String(process.pid))
  try {
    rmSync(lockFile)
  } catch {
    /* already gone */
  }
  try {
    // renameSync is atomic and overwrites the target on POSIX systems
    renameSync(tempLockFile, lockFile)
  } catch (err) {
    // If rename fails, clean up temp file and re-throw
    try { rmSync(tempLockFile) } catch { /* ignore */ }
    throw err
  }
}

function releaseLock(worktreeBase: string, repoPath: string): void {
  const lockFile = lockPath(worktreeBase, repoPath)
  try {
    rmSync(lockFile)
  } catch (err) {
    console.warn(`[worktree] Failed to remove lock file: ${err}`)
  }
}

/**
 * Unconditionally removes any stale worktree path and branch.
 * Idempotent — safe to call even if nothing stale exists.
 * Agent branches are throwaway — never tries to push before deleting.
 */
async function nukeStaleState(
  repoPath: string,
  worktreePath: string,
  branch: string,
  env: Record<string, string | undefined>,
  log: Logger | Console
): Promise<void> {
  // Remove any worktree that references this branch (may be at a different path)
  try {
    const { stdout: wtList } = await execFileAsync('git', ['worktree', 'list', '--porcelain'], {
      cwd: repoPath,
      env
    })
    for (const block of wtList.split('\n\n')) {
      if (block.includes(`branch refs/heads/${branch}`)) {
        const pathLine = block.split('\n').find((l) => l.startsWith('worktree '))
        if (pathLine) {
          const stalePath = pathLine.replace('worktree ', '')
          log.warn(`[worktree] Removing stale worktree at ${stalePath} for branch ${branch}`)
          try {
            await execFileAsync('git', ['worktree', 'remove', '--force', stalePath], {
              cwd: repoPath,
              env
            })
          } catch {
            try {
              rmSync(stalePath, { recursive: true, force: true })
            } catch {
              /* best effort */
            }
          }
        }
      }
    }
  } catch {
    /* worktree list failed — continue */
  }

  // Remove the target worktree path if it exists (from a previous run at this exact path)
  if (existsSync(worktreePath)) {
    try {
      await execFileAsync('git', ['worktree', 'remove', '--force', worktreePath], {
        cwd: repoPath,
        env
      })
    } catch {
      rmSync(worktreePath, { recursive: true, force: true })
    }
  }

  // Prune stale worktree references from git's tracking
  try {
    await execFileAsync('git', ['worktree', 'prune'], { cwd: repoPath, env })
  } catch {
    /* best effort */
  }

  // Delete the branch if it exists (no push — agent branches are throwaway)
  try {
    await execFileAsync('git', ['branch', '-D', branch], { cwd: repoPath, env })
  } catch {
    /* branch doesn't exist — fine */
  }
}

export async function setupWorktree(
  opts: SetupWorktreeOpts & { logger?: Logger }
): Promise<SetupWorktreeResult> {
  const { repoPath, worktreeBase, taskId, title, logger } = opts
  const branch = branchNameForTask(title, taskId)
  const repoDir = path.join(worktreeBase, repoSlug(repoPath))
  const worktreePath = path.join(repoDir, taskId)
  const env = buildAgentEnv()
  const log = logger ?? console

  mkdirSync(repoDir, { recursive: true })

  acquireLock(worktreeBase, repoPath, logger)

  // Validate repo path exists and is a git repository
  if (!existsSync(repoPath) || !existsSync(path.join(repoPath, '.git'))) {
    releaseLock(worktreeBase, repoPath)
    throw new Error(`Repo path does not exist or is not a git repository: ${repoPath}`)
  }

  try {
    // Step 1: Unconditionally clean any stale state for this task/branch.
    // This runs BEFORE attempting creation — not in an error handler.
    // Agent branches are throwaway; never try to preserve commits.
    await nukeStaleState(repoPath, worktreePath, branch, env, log)

    // Step 2: Create fresh worktree + branch
    await execFileAsync('git', ['worktree', 'add', '-b', branch, worktreePath], {
      cwd: repoPath,
      env
    })
  } catch (err) {
    // Clean up on failure
    try {
      rmSync(worktreePath, { recursive: true, force: true })
    } catch {
      /* best effort */
    }
    releaseLock(worktreeBase, repoPath)
    throw err
  }

  releaseLock(worktreeBase, repoPath)
  return { worktreePath, branch }
}

export interface CleanupWorktreeOpts {
  repoPath: string
  worktreePath: string
  branch: string
  logger?: Logger
}

export async function cleanupWorktree(opts: CleanupWorktreeOpts): Promise<void> {
  const { repoPath, worktreePath, branch, logger } = opts
  const env = buildAgentEnv()
  const log = logger ?? console

  try {
    await execFileAsync('git', ['worktree', 'remove', worktreePath, '--force'], { cwd: repoPath, env })
  } catch (err) {
    log.warn(`[worktree] Failed to remove worktree ${worktreePath}: ${err}`)
  }

  try {
    await execFileAsync('git', ['worktree', 'prune'], { cwd: repoPath, env })
  } catch (err) {
    log.warn(`[worktree] Failed to prune worktrees: ${err}`)
  }

  try {
    await execFileAsync('git', ['branch', '-D', branch], { cwd: repoPath, env })
  } catch (err) {
    log.warn(`[worktree] Failed to delete branch ${branch}: ${err}`)
  }
}

export async function pruneStaleWorktrees(
  worktreeBase: string,
  isActive: (taskId: string) => boolean,
  logger?: Logger
): Promise<number> {
  let pruned = 0

  if (!existsSync(worktreeBase)) return pruned

  const repoDirs = readdirSync(worktreeBase, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== '.locks')
    .map((d) => path.join(worktreeBase, d.name))

  const log = logger ?? console
  for (const repoDir of repoDirs) {
    let taskDirs: string[]
    try {
      taskDirs = readdirSync(repoDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
    } catch (err) {
      log.warn(`[worktree] Failed to read repo directory during prune: ${err}`)
      continue
    }

    for (const taskId of taskDirs) {
      if (!isActive(taskId)) {
        const worktreePath = path.join(repoDir, taskId)
        try {
          // Use shell rm -rf instead of rmSync to avoid Electron's ASAR
          // interception, which treats .asar files as directories and
          // fails with ENOTDIR when trying to rmdir them.
          const env = buildAgentEnv()
          await execFileAsync('rm', ['-rf', worktreePath], { env })
          pruned++
        } catch (err) {
          log.warn(`[worktree] Failed to remove stale worktree directory: ${err}`)
        }
      }
    }
  }

  return pruned
}
