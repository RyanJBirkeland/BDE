import { mkdirSync } from 'node:fs'
import { writeFile, readFile, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { createLogger, type Logger } from '../logger'

const defaultLogger = createLogger('file-lock')

/**
 * Thrown when two processes race to claim the same stale lock and this process
 * loses the verify-after-rename check. The caller should retry acquisition.
 */
export class LockContestedError extends Error {
  constructor(lockFile: string, winnerPid: number) {
    super(`Lock at ${lockFile} was claimed by PID ${winnerPid} before we could verify ownership`)
    this.name = 'LockContestedError'
  }
}

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
 *
 * In the stale-lock path, uses a write-then-verify pattern to close the
 * TOCTOU window: after renameSync claims the lock, re-reads the file and
 * confirms the PID is ours. Throws LockContestedError if another process
 * won the race — the caller should retry.
 */
export async function acquireLock(worktreeBase: string, repoPath: string, logger?: Logger): Promise<void> {
  const locksDir = path.join(worktreeBase, '.locks')
  mkdirSync(locksDir, { recursive: true })

  const lockFile = lockPath(worktreeBase, repoPath)

  // Try atomic create — fails if file already exists
  try {
    await writeFile(lockFile, String(process.pid), { flag: 'wx' })
    return // Lock acquired
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
    // Lock file exists — fall through to stale-lock recovery
  }

  // Lock file exists — read PID and check liveness
  const raw = (await readFile(lockFile, 'utf-8')).trim()
  const pid = parseInt(raw, 10)

  if (isNaN(pid)) {
    ;(logger ?? defaultLogger).warn(`[file-lock] Corrupted lock file for ${repoPath} — removing`)
    await rm(lockFile).catch(() => {})
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

  // Re-acquire atomically after cleaning stale lock using rename (atomic on POSIX).
  // Write our PID to a temp file first, then rename it into place.
  const tempLockFile = lockFile + `.${process.pid}.tmp`
  await writeFile(tempLockFile, String(process.pid))
  await rm(lockFile).catch(() => { /* already gone */ })
  try {
    // rename is atomic and overwrites the target on POSIX systems
    await rename(tempLockFile, lockFile)
  } catch (err) {
    await rm(tempLockFile).catch(() => {})
    throw err
  }

  // Verify we actually won the race. Two processes can both detect the stale
  // lock, both write temp files, and both rename — the last rename wins.
  // Re-reading immediately after our rename tells us who won.
  const verifiedRaw = (await readFile(lockFile, 'utf-8')).trim()
  const verifiedPid = parseInt(verifiedRaw, 10)
  if (verifiedPid !== process.pid) {
    throw new LockContestedError(lockFile, verifiedPid)
  }
}

/**
 * Release the worktree lock for the given repo. Best-effort — warns on failure
 * but does not throw (lock files are cleaned up on next acquisition if stale).
 */
export function releaseLock(worktreeBase: string, repoPath: string, logger?: Logger): void {
  const lockFile = lockPath(worktreeBase, repoPath)
  rm(lockFile).catch((err) => {
    ;(logger ?? defaultLogger).warn(`[file-lock] Failed to remove lock file: ${err}`)
  })
}
