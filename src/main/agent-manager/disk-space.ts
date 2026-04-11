import { statfs as statfsAsync } from 'node:fs/promises'
import type { Logger } from '../logger'

/**
 * Minimum free disk space required (bytes) before creating a worktree.
 * Worktrees + node_modules can consume 1-3GB each; 5GB ensures headroom
 * for at least one agent run plus build artifacts.
 */
export const MIN_FREE_DISK_BYTES = 5 * 1024 * 1024 * 1024 // 5 GiB

/**
 * Bytes reserved per in-flight worktree setup. Tracked in-memory so that
 * concurrent spawns don't all race past the disk check simultaneously
 * (F-t1-sre-5: each sees "5 GB free" but together they consume all 5 GB).
 *
 * Conservative: 2 GiB per worktree (worst-case with node_modules install).
 * Released after setupWorktree returns (success or failure).
 */
export const DISK_RESERVATION_BYTES = 2 * 1024 * 1024 * 1024 // 2 GiB

/** In-memory map of worktreeBase → total pending reservation in bytes. */
const _pendingReservations = new Map<string, number>()

/**
 * Mark `DISK_RESERVATION_BYTES` as reserved for `worktreeBase`.
 * Returns the updated total reserved bytes for the base.
 */
export function reserveDisk(worktreeBase: string): number {
  const existing = _pendingReservations.get(worktreeBase) ?? 0
  const updated = existing + DISK_RESERVATION_BYTES
  _pendingReservations.set(worktreeBase, updated)
  return updated
}

/**
 * Release a previously reserved `DISK_RESERVATION_BYTES` for `worktreeBase`.
 */
export function releaseDisk(worktreeBase: string): void {
  const existing = _pendingReservations.get(worktreeBase) ?? 0
  const updated = Math.max(0, existing - DISK_RESERVATION_BYTES)
  if (updated === 0) {
    _pendingReservations.delete(worktreeBase)
  } else {
    _pendingReservations.set(worktreeBase, updated)
  }
}

/**
 * Return the total pending disk reservation in bytes for `worktreeBase`.
 * Exposed for testing and observability.
 */
export function getPendingReservation(worktreeBase: string): number {
  return _pendingReservations.get(worktreeBase) ?? 0
}

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
    ;(log ?? console).warn(`[disk-space] Check failed (continuing): ${err}`)
  }
}
