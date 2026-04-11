import { mkdirSync, writeFileSync, readFileSync, rmSync, renameSync } from 'node:fs'
import path from 'node:path'
import type { Logger } from '../logger'

/**
 * Convert a repo path to a filesystem-safe slug for lock file naming.
 */
function repoSlug(repoPath: string): string {
  return repoPath.replace(/[^a-z0-9]/gi, '-').replace(/^-+|-+$/g, '')
}

/**
 * Compute the lock file path for a given worktree base and repo.
 */
function lockPath(worktreeBase: string, repoPath: string): string {
  return path.join(worktreeBase, '.locks', `${repoSlug(repoPath)}.lock`)
}

/**
 * Acquire an exclusive lock for worktree operations on the given repo.
 * Uses a PID-based lock file with liveness checking to prevent deadlocks
 * from crashed processes. Throws if another live process holds the lock.
 */
export function acquireLock(worktreeBase: string, repoPath: string, logger?: Logger): void {
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
    ;(logger ?? console).warn(`[file-lock] Corrupted lock file for ${repoPath} — removing`)
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

/**
 * Release the worktree lock for the given repo. Best-effort — warns on failure
 * but does not throw (lock files are cleaned up on next acquisition if stale).
 */
export function releaseLock(worktreeBase: string, repoPath: string): void {
  const lockFile = lockPath(worktreeBase, repoPath)
  try {
    rmSync(lockFile)
  } catch (err) {
    console.warn(`[file-lock] Failed to remove lock file: ${err}`)
  }
}
