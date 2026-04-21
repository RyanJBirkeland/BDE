import { mkdirSync, existsSync, readdirSync, rmSync, symlinkSync } from 'node:fs'
import path from 'node:path'
import { execFileAsync } from '../lib/async-utils'
import { buildAgentEnv } from '../env-utils'
import { assertRepoCleanOrAbort } from '../lib/main-repo-guards'
import { BRANCH_SLUG_MAX_LENGTH, GIT_FETCH_TIMEOUT_MS, GIT_FF_MERGE_TIMEOUT_MS } from './types'
import type { Logger } from '../logger'
import {
  listWorktrees,
  removeWorktreeForce,
  pruneWorktrees,
  deleteBranch,
  forceDeleteBranchRef,
  fetchMain,
  ffMergeMain,
  addWorktree
} from '../lib/git-operations'
import {
  MIN_FREE_DISK_BYTES,
  DISK_RESERVATION_BYTES,
  reserveDisk,
  releaseDisk,
  getPendingReservation,
  ensureFreeDiskSpace,
  InsufficientDiskSpaceError
} from './disk-space'
import { acquireLock, releaseLock } from './file-lock'

// Re-export for backward compatibility
export {
  InsufficientDiskSpaceError,
  DISK_RESERVATION_BYTES,
  reserveDisk,
  releaseDisk,
  getPendingReservation,
  ensureFreeDiskSpace
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
  groupId?: string | undefined
}

export interface SetupWorktreeResult {
  worktreePath: string
  branch: string
}

function repoSlug(repoPath: string): string {
  return repoPath.replace(/[^a-z0-9]/gi, '-').replace(/^-+|-+$/g, '')
}

/**
 * Unconditionally removes any stale worktree path and branch.
 * Idempotent — safe to call even if nothing stale exists.
 * Agent branches are throwaway — never tries to push before deleting.
 */
async function cleanupStaleWorktrees(
  repoPath: string,
  worktreePath: string,
  branch: string,
  env: Record<string, string | undefined>,
  log: Logger | Console
): Promise<void> {
  // Remove any worktree that references this branch (may be at a different path)
  try {
    const wtList = await listWorktrees(repoPath, env)
    for (const block of wtList.split('\n\n')) {
      if (block.includes(`branch refs/heads/${branch}`)) {
        const pathLine = block.split('\n').find((l) => l.startsWith('worktree '))
        if (pathLine) {
          const stalePath = pathLine.replace('worktree ', '')
          log.warn(`[worktree] Removing stale worktree at ${stalePath} for branch ${branch}`)
          try {
            await removeWorktreeForce(repoPath, stalePath, env)
          } catch (removeErr) {
            log.warn(
              `[worktree] removeWorktreeForce failed for ${stalePath} (branch ${branch}): ${removeErr instanceof Error ? removeErr.message : String(removeErr)} — falling back to rmSync`
            )
            try {
              rmSync(stalePath, { recursive: true, force: true })
            } catch (rmErr) {
              log.warn(
                `[worktree] rmSync fallback also failed for ${stalePath}: ${rmErr instanceof Error ? rmErr.message : String(rmErr)}`
              )
            }
          }
        }
      }
    }
  } catch (listErr) {
    log.warn(
      `[worktree] listWorktrees failed for ${repoPath} (branch ${branch}): ${listErr instanceof Error ? listErr.message : String(listErr)} — skipping stale worktree removal`
    )
  }

  // Remove the target worktree path if it exists (from a previous run at this exact path)
  if (existsSync(worktreePath)) {
    try {
      await removeWorktreeForce(repoPath, worktreePath, env)
    } catch (removeErr) {
      log.warn(
        `[worktree] removeWorktreeForce failed for ${worktreePath} (branch ${branch}): ${removeErr instanceof Error ? removeErr.message : String(removeErr)} — falling back to rmSync`
      )
      rmSync(worktreePath, { recursive: true, force: true })
    }
  }

  // Prune stale worktree references from git's tracking
  try {
    await pruneWorktrees(repoPath, env)
  } catch (pruneErr) {
    log.warn(
      `[worktree] pruneWorktrees failed for ${repoPath}: ${pruneErr instanceof Error ? pruneErr.message : String(pruneErr)}`
    )
  }

  // Delete the branch if it exists (no push — agent branches are throwaway).
  // `git branch -D` can fail if git still considers the branch "in use" by a
  // worktree whose directory was already removed (rmSync above) but whose
  // .git/worktrees/<hash> entry hasn't been pruned yet.  Fall back to the
  // lower-level `git update-ref -d` which bypasses the worktree-in-use check
  // and deletes the ref directly.
  try {
    await deleteBranch(repoPath, branch, env)
  } catch {
    try {
      await forceDeleteBranchRef(repoPath, branch, env)
    } catch (forceDeleteErr) {
      log.warn(
        `[worktree] forceDeleteBranchRef also failed for branch ${branch} in ${repoPath}: ${forceDeleteErr instanceof Error ? forceDeleteErr.message : String(forceDeleteErr)}`
      )
    }
  }
}

export async function setupWorktree(
  opts: SetupWorktreeOpts & { logger?: Logger | undefined }
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
  // Includes in-flight reservations so concurrent spawns don't all see "5 GB
  // free" simultaneously and over-commit the disk (F-t1-sre-5).
  const pending = getPendingReservation(worktreeBase)
  await ensureFreeDiskSpace(worktreeBase, MIN_FREE_DISK_BYTES + pending, log)

  // Reserve disk for this worktree. Released in the finally block regardless
  // of success or failure so subsequent spawns see accurate headroom.
  reserveDisk(worktreeBase)
  try {
    // Step 1: Fetch latest main OUTSIDE the per-repo lock.
    // git fetch is safe to run concurrently from multiple processes — git
    // handles locking on its own packed-refs / fetch-head writes. Holding our
    // own lock through 30s of network I/O fully serialized worktree setup
    // for multiple agents on the same repo (10 tasks → 5+ minute startup).
    try {
      await fetchMain(repoPath, env, log, GIT_FETCH_TIMEOUT_MS)
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
      await cleanupStaleWorktrees(repoPath, worktreePath, branch, env, log)

      // Fast-forward local main to match origin so the new worktree branches
      // off the latest commit. Non-destructive — only succeeds for true ff.
      //
      // Guards: ffMergeMain is the first writer against the MAIN repo's working
      // tree in the whole worktree-setup flow. A timeout or race here can leave
      // `.git/MERGE_HEAD` and modified files in the main checkout, which is the
      // root cause of the agent-edit-leak bug. Assert cleanliness before and
      // after, and on any post-condition breach abort + refuse to proceed.
      await assertRepoCleanOrAbort(repoPath, env, log, 'pre-ffMergeMain')
      try {
        await ffMergeMain(repoPath, env, log, GIT_FF_MERGE_TIMEOUT_MS)
      } catch (err) {
        log.warn(`[worktree] Failed to ff-merge origin/main (proceeding anyway): ${err}`)
      }
      await assertRepoCleanOrAbort(repoPath, env, log, 'post-ffMergeMain')

      // Create fresh worktree + branch
      await addWorktree(repoPath, branch, worktreePath, env)

      // Symlink node_modules from the main checkout so agents skip npm install.
      // Saves ~75s per task. better-sqlite3 ABI is not a concern for renderer
      // tests (agents no longer run test:main). If the symlink already exists
      // (e.g. from a stale worktree path collision), skip silently.
      const worktreeNodeModules = path.join(worktreePath, 'node_modules')
      const repoNodeModules = path.join(repoPath, 'node_modules')
      if (!existsSync(worktreeNodeModules) && existsSync(repoNodeModules)) {
        try {
          symlinkSync(repoNodeModules, worktreeNodeModules)
          log.info(`[worktree] Symlinked node_modules for task ${taskId}`)
        } catch (symlinkErr) {
          log.warn(
            `[worktree] Failed to symlink node_modules (agents will npm install): ${symlinkErr}`
          )
        }
      }
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
  } finally {
    // Always release the disk reservation whether setup succeeded or failed.
    releaseDisk(worktreeBase)
  }
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
    await removeWorktreeForce(repoPath, worktreePath, env)
  } catch (err) {
    log.warn(`[worktree] Failed to remove worktree ${worktreePath}: ${err}`)
  }

  try {
    await pruneWorktrees(repoPath, env)
  } catch (err) {
    log.warn(`[worktree] Failed to prune worktrees: ${err}`)
  }

  try {
    await deleteBranch(repoPath, branch, env)
  } catch (err) {
    log.warn(`[worktree] Failed to delete branch ${branch}: ${err}`)
  }
}

/**
 * UUID v4 / v5 format that BDE uses for sprint task IDs (and therefore
 * for the leaf directory name of every BDE-created worktree). The pruner
 * uses this to filter out anything that doesn't look like a task ID, so
 * it never deletes human-created worktrees, source directories, etc.
 *
 * Pattern: 8-4-4-4-12 hex with dashes, case-insensitive.
 */
const TASK_ID_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Returns true if the given path looks like a real git worktree:
 * it must contain a `.git` entry (file or directory). BDE-created
 * worktrees always have a `.git` *file* (added by `git worktree add`),
 * so this rules out plain non-worktree directories that just happen
 * to have a UUID-shaped name.
 */
function looksLikeWorktree(dirPath: string): boolean {
  return existsSync(path.join(dirPath, '.git'))
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
      // Safety: only consider directories whose name matches BDE's task-ID
      // UUID format. The default `worktreeBase` (`~/worktrees/bde/`) is
      // shared with human-created git worktrees per the documented
      // ~/worktrees/<project>/<branch> convention, so we MUST NOT delete
      // anything that doesn't look like a BDE-managed task directory.
      // Without this guard the pruner would `rm -rf` `src/`, `docs/`, etc.
      // inside human worktree branches.
      if (!TASK_ID_UUID_PATTERN.test(taskId)) continue

      const worktreePath = path.join(repoDir, taskId)

      // Defense-in-depth: a UUID-named directory that has no `.git` is not
      // a worktree we created — refuse to delete it.
      if (!looksLikeWorktree(worktreePath)) {
        log.warn(
          `[worktree] Skipping prune of ${worktreePath}: UUID-named but not a git worktree (no .git entry)`
        )
        continue
      }

      if (isActive(taskId)) continue
      // Skip worktrees belonging to tasks in review status
      if (isReview?.(taskId)) {
        log.info(`[worktree] Skipping prune of review worktree for task ${taskId}`)
        continue
      }
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
