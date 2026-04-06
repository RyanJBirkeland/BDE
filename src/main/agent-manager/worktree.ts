import { execFile } from 'node:child_process'
import {
  mkdirSync,
  existsSync,
  readdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  renameSync
} from 'node:fs'
import { statfs as statfsAsync } from 'node:fs/promises'
import { promisify } from 'node:util'
import path from 'node:path'
import { buildAgentEnv } from '../env-utils'
import { BRANCH_SLUG_MAX_LENGTH } from './types'
import type { Logger } from './types'

const execFileAsync = promisify(execFile)

/**
 * Minimum free disk space required (bytes) before creating a worktree.
 * Worktrees + node_modules can consume 1-3GB each; 5GB ensures headroom
 * for at least one agent run plus build artifacts.
 */
export const MIN_FREE_DISK_BYTES = 5 * 1024 * 1024 * 1024 // 5 GiB

/**
 * Tagged error thrown by `ensureFreeDiskSpace` when the requested path has
 * less than the required free bytes available. Use `instanceof` to
 * distinguish from platform errors (ENOSYS, EACCES, etc.) which the
 * caller treats as non-fatal.
 */
export class InsufficientDiskSpaceError extends Error {
  constructor(
    public readonly path: string,
    public readonly availableBytes: number,
    public readonly requiredBytes: number
  ) {
    super(
      `Insufficient disk space at ${path}: ${availableBytes} bytes available, ${requiredBytes} required`
    )
    this.name = 'InsufficientDiskSpaceError'
  }
}

/**
 * Check available disk space at the given path. Throws
 * `InsufficientDiskSpaceError` if free space is below `minFreeBytes`.
 * Best-effort — silently succeeds if statfs is unsupported on the platform
 * (e.g. ENOSYS) or other platform errors occur during the check.
 */
export async function ensureFreeDiskSpace(
  checkPath: string,
  minFreeBytes: number = MIN_FREE_DISK_BYTES,
  log?: Logger | Console
): Promise<void> {
  try {
    const stats = await statfsAsync(checkPath)
    const free = Number(stats.bavail) * Number(stats.bsize)
    if (free < minFreeBytes) {
      throw new InsufficientDiskSpaceError(checkPath, free, minFreeBytes)
    }
  } catch (err) {
    // Re-throw our own tagged error; swallow platform errors (statfs not
    // supported, permission denied, etc.) so the check stays best-effort.
    if (err instanceof InsufficientDiskSpaceError) {
      throw err
    }
    ;(log ?? console).warn(`[worktree] Disk space check failed (continuing): ${err}`)
  }
}

export function branchNameForTask(title: string, taskId?: string, groupId?: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, BRANCH_SLUG_MAX_LENGTH)
  // Fallback to 'unnamed-task' if slug is empty (all special chars)
  const finalSlug = slug || 'unnamed-task'
  // When groupId is present, append group short-id instead of taskId
  const suffix = groupId ? `-${groupId.slice(0, 8)}` : taskId ? `-${taskId.slice(0, 8)}` : ''
  return `agent/${finalSlug}${suffix}`
}

export interface SetupWorktreeOpts {
  repoPath: string
  worktreeBase: string
  taskId: string
  title: string
  groupId?: string
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
    try {
      rmSync(tempLockFile)
    } catch {
      /* ignore */
    }
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
  const { repoPath, worktreeBase, taskId, title, groupId, logger } = opts
  const branch = branchNameForTask(title, taskId, groupId)
  const repoDir = path.join(worktreeBase, repoSlug(repoPath))
  const worktreePath = path.join(repoDir, taskId)
  const env = buildAgentEnv()
  const log = logger ?? console

  mkdirSync(repoDir, { recursive: true })

  // Validate repo path exists and is a git repository (no lock needed — read-only)
  if (!existsSync(repoPath) || !existsSync(path.join(repoPath, '.git'))) {
    throw new Error(`Repo path does not exist or is not a git repository: ${repoPath}`)
  }

  // Pre-check: ensure enough free disk space at the worktree base.
  // Worktrees + node_modules can consume 1-3GB each. Failing fast here gives
  // a clearer error than git's downstream "no space left on device" failure.
  await ensureFreeDiskSpace(worktreeBase, MIN_FREE_DISK_BYTES, log)

  // Step 1: Fetch latest main OUTSIDE the per-repo lock.
  // git fetch is safe to run concurrently from multiple processes — git
  // handles locking on its own packed-refs / fetch-head writes. Holding our
  // own lock through 30s of network I/O fully serialized worktree setup
  // for multiple agents on the same repo (10 tasks → 5+ minute startup).
  try {
    await execFileAsync('git', ['fetch', 'origin', 'main', '--no-tags'], {
      cwd: repoPath,
      env,
      timeout: 30_000
    })
    log.info(`[worktree] Fetched origin/main for task ${taskId}`)
  } catch (err) {
    // Non-fatal — proceed with whatever HEAD we have
    log.warn(`[worktree] Failed to fetch origin/main (proceeding anyway): ${err}`)
  }

  // Step 2: Acquire the per-repo lock for the conflict-sensitive operations.
  // The lock guards `git worktree add`, branch creation, and the merge --ff-only
  // (which mutates the main checkout's HEAD) — these races corrupted state in
  // testing when multiple agents started simultaneously on the same repo.
  acquireLock(worktreeBase, repoPath, logger)

  try {
    // Clean any stale state for this task/branch (other worktrees with the
    // same branch name, leftover dirs, dangling refs).
    await nukeStaleState(repoPath, worktreePath, branch, env, log)

    // Fast-forward local main to match origin so the new worktree branches
    // off the latest commit. Non-destructive — only succeeds for true ff.
    try {
      await execFileAsync('git', ['merge', '--ff-only', 'origin/main'], {
        cwd: repoPath,
        env,
        timeout: 10_000
      })
    } catch (err) {
      log.warn(`[worktree] Failed to ff-merge origin/main (proceeding anyway): ${err}`)
    }

    // Create fresh worktree + branch
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
    await execFileAsync('git', ['worktree', 'remove', worktreePath, '--force'], {
      cwd: repoPath,
      env
    })
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
  logger?: Logger,
  isReview?: (taskId: string) => boolean
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
      if (isActive(taskId)) continue
      // Skip worktrees belonging to tasks in review status
      if (isReview?.(taskId)) {
        log.info(`[worktree] Skipping prune of review worktree for task ${taskId}`)
        continue
      }
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

  return pruned
}
