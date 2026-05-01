import fs from 'node:fs'
import { mkdirSync, existsSync, rmSync, symlinkSync } from 'node:fs'
import path from 'node:path'
import { execFileAsync } from '../lib/async-utils'
import { buildAgentEnv } from '../env-utils'
import { assertRepoCleanOrAbort } from '../lib/main-repo-guards'
import { resolveDefaultBranch } from '../lib/default-branch'
import { BRANCH_SLUG_MAX_LENGTH, GIT_FETCH_TIMEOUT_MS, GIT_FF_MERGE_TIMEOUT_MS } from './types'
import { createLogger, type Logger } from '../logger'

const defaultLogger = createLogger('worktree')
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
  InsufficientDiskSpaceError,
  DiskSpaceProbeError
} from './disk-space'
import { acquireLock, releaseLock } from './file-lock'

// Re-export for backward compatibility
export {
  InsufficientDiskSpaceError,
  DiskSpaceProbeError,
  DISK_RESERVATION_BYTES,
  reserveDisk,
  releaseDisk,
  getPendingReservation,
  ensureFreeDiskSpace
}

function buildAgentBranch(title: string, suffix: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, BRANCH_SLUG_MAX_LENGTH)
  // Fallback to 'unnamed-task' if slug is empty (all special chars).
  const finalSlug = slug || 'unnamed-task'
  return `agent/${finalSlug}${suffix}`
}

/** Branch name for a task, scoped by either the task id or its parent group id. */
export function branchNameForTask(title: string, taskId?: string, groupId?: string): string {
  // When groupId is present, the group short-id wins so all tasks in an epic
  // share a single branch name root for grouped review/cleanup.
  if (groupId) return branchNameForTaskGroup(title, groupId)
  if (taskId) return branchNameForTaskId(title, taskId)
  return buildAgentBranch(title, '')
}

export function branchNameForTaskId(title: string, taskId: string): string {
  return buildAgentBranch(title, `-${taskId.slice(0, 8)}`)
}

export function branchNameForTaskGroup(title: string, groupId: string): string {
  return buildAgentBranch(title, `-${groupId.slice(0, 8)}`)
}

export interface SetupWorktreeOpts {
  repoPath: string
  worktreeBase: string
  taskId: string
  title: string
  groupId?: string | undefined
  /** Called when fetchMain fails so the task's notes field records the failure. Optional. */
  appendToNotes?: (text: string) => void
}

export interface SetupWorktreeResult {
  worktreePath: string
  branch: string
}

function repoSlug(repoPath: string): string {
  return repoPath.replace(/[^a-z0-9]/gi, '-').replace(/^-+|-+$/g, '')
}

/**
 * Unconditionally removes any stale worktree path and branch. Idempotent —
 * safe to call even if nothing stale exists. Agent branches are throwaway,
 * so the cleanup never tries to push before deleting.
 */
async function cleanupStaleWorktrees(
  repoPath: string,
  worktreePath: string,
  branch: string,
  env: Record<string, string | undefined>,
  log: Logger
): Promise<void> {
  await removeWorktreesForBranch(repoPath, branch, env, log)
  await removeWorktreeAtPath(repoPath, worktreePath, branch, env, log)
  await pruneOrphanedWorktreeRefs(repoPath, worktreePath, env, log)
  await deleteBranchRobustly(repoPath, worktreePath, branch, env, log)
}

/**
 * Walk `git worktree list --porcelain`, find any worktree pointing at
 * `branch`, and remove it. A removeForce failure falls back to `rmSync`
 * because git refuses to drop a worktree whose dir already vanished.
 */
async function removeWorktreesForBranch(
  repoPath: string,
  branch: string,
  env: Record<string, string | undefined>,
  log: Logger
): Promise<void> {
  let stalePaths: string[]
  try {
    const listing = await listWorktrees(repoPath, env)
    stalePaths = parseWorktreePathsForBranch(listing, branch)
  } catch (listErr) {
    log.warn(
      `[worktree] listWorktrees failed for ${repoPath} (branch ${branch}): ${asMessage(listErr)} — skipping stale worktree removal`
    )
    return
  }
  for (const stalePath of stalePaths) {
    log.warn(`[worktree] Removing stale worktree at ${stalePath} for branch ${branch}`)
    await removeWorktreeWithRmFallback(repoPath, stalePath, branch, env, log)
  }
}

function parseWorktreePathsForBranch(listing: string | undefined | null, branch: string): string[] {
  if (!listing) return []
  const paths: string[] = []
  for (const block of listing.split('\n\n')) {
    const stalePath = extractWorktreePathForBranch(block, branch)
    if (stalePath) paths.push(stalePath)
  }
  return paths
}

function extractWorktreePathForBranch(block: string, branch: string): string | null {
  if (!block.includes(`branch refs/heads/${branch}`)) return null
  const pathLine = block.split('\n').find((l) => l.startsWith('worktree '))
  return pathLine ? pathLine.replace('worktree ', '') : null
}

async function removeWorktreeAtPath(
  repoPath: string,
  worktreePath: string,
  branch: string,
  env: Record<string, string | undefined>,
  log: Logger
): Promise<void> {
  if (!existsSync(worktreePath)) return
  await removeWorktreeWithRmFallback(repoPath, worktreePath, branch, env, log)
}

async function removeWorktreeWithRmFallback(
  repoPath: string,
  targetPath: string,
  branch: string,
  env: Record<string, string | undefined>,
  log: Logger
): Promise<void> {
  try {
    await removeWorktreeForce(repoPath, targetPath, env)
  } catch (removeErr) {
    log.warn(
      `[worktree] removeWorktreeForce failed for ${targetPath} (branch ${branch}): ${asMessage(removeErr)} — falling back to rmSync`
    )
    try {
      rmSync(targetPath, { recursive: true, force: true })
    } catch (rmErr) {
      log.warn(`[worktree] rmSync fallback also failed for ${targetPath}: ${asMessage(rmErr)}`)
    }
  }
}

async function pruneOrphanedWorktreeRefs(
  repoPath: string,
  worktreePath: string,
  env: Record<string, string | undefined>,
  log: Logger
): Promise<void> {
  try {
    await pruneWorktrees(repoPath, env)
  } catch (pruneErr) {
    log.warn(
      `[worktree] pruneWorktrees failed for ${repoPath} (worktreePath=${worktreePath}): ${asMessage(pruneErr)}`
    )
  }
}

/**
 * `git branch -D` can fail when git still considers the branch in use by a
 * worktree whose directory was already removed (via rmSync) but whose
 * `.git/worktrees/<hash>` entry has not been pruned yet. Falls back to the
 * lower-level `git update-ref -d` which bypasses the in-use check.
 */
async function deleteBranchRobustly(
  repoPath: string,
  worktreePath: string,
  branch: string,
  env: Record<string, string | undefined>,
  log: Logger
): Promise<void> {
  try {
    await deleteBranch(repoPath, branch, env)
    return
  } catch {
    /* fall through to forceDeleteBranchRef */
  }
  try {
    await forceDeleteBranchRef(repoPath, branch, env)
  } catch (forceDeleteErr) {
    log.warn(
      `[worktree] forceDeleteBranchRef also failed for branch ${branch} in ${repoPath} (worktreePath=${worktreePath}): ${asMessage(forceDeleteErr)}`
    )
  }
}

function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export async function setupWorktree(
  opts: SetupWorktreeOpts & { logger?: Logger | undefined }
): Promise<SetupWorktreeResult> {
  const { repoPath, worktreeBase, taskId, title, groupId, logger, appendToNotes } = opts
  const branch = branchNameForTask(title, taskId, groupId)
  const repoDir = path.join(worktreeBase, repoSlug(repoPath))
  const worktreePath = path.join(repoDir, taskId)
  const env = buildAgentEnv()
  const log = logger ?? defaultLogger

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
    const defaultBranch = await resolveDefaultBranch(repoPath)
    try {
      await fetchMain(repoPath, env, log, GIT_FETCH_TIMEOUT_MS)
      log.info(`[worktree] Fetched origin/${defaultBranch} for task ${taskId}`)
    } catch (err) {
      // Non-fatal — proceed with whatever local HEAD we have
      const stderr = err instanceof Error ? err.message : String(err)
      log.warn(`[worktree] Failed to fetch origin/${defaultBranch} (proceeding anyway): ${stderr}`)
      appendToNotes?.(`[worktree] fetchMain failed: ${stderr}`)
    }

    // Step 2: Acquire the per-repo lock for the conflict-sensitive operations.
    // The lock guards `git worktree add`, branch creation, and the merge --ff-only
    // (which mutates the main checkout's HEAD) — these races corrupted state in
    // testing when multiple agents started simultaneously on the same repo.
    await acquireLock(worktreeBase, repoPath, log)

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
        const { stdout: branchOut } = await execFileAsync(
          'git',
          ['rev-parse', '--abbrev-ref', 'HEAD'],
          { cwd: repoPath, env }
        )
        const currentBranch = branchOut.trim()
        if (currentBranch !== defaultBranch) {
          log.warn(
            `[worktree] Main repo is on branch "${currentBranch}", not "${defaultBranch}" — skipping ff-merge to avoid corrupting unrelated branch`
          )
        } else {
          await ffMergeMain(repoPath, env, log, GIT_FF_MERGE_TIMEOUT_MS)
        }
      } catch (err) {
        log.warn(
          `[worktree] Failed to ff-merge origin/${defaultBranch} (proceeding anyway): ${err}`
        )
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
      // Clean up the worktree directory on setup failure (best effort).
      // The lock is released in the finally block below.
      try {
        rmSync(worktreePath, { recursive: true, force: true })
      } catch {
        /* best effort */
      }
      throw err
    } finally {
      releaseLock(worktreeBase, repoPath, log)
    }

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
  const log = logger ?? defaultLogger

  try {
    await removeWorktreeForce(repoPath, worktreePath, env)
  } catch (err) {
    log.warn(`[worktree] Failed to remove worktree (worktreePath=${worktreePath}): ${err}`)
  }

  try {
    await pruneWorktrees(repoPath, env)
  } catch (err) {
    log.warn(`[worktree] Failed to prune worktrees (worktreePath=${worktreePath}): ${err}`)
  }

  try {
    await deleteBranch(repoPath, branch, env)
  } catch (err) {
    log.warn(`[worktree] Failed to delete branch ${branch} (worktreePath=${worktreePath}): ${err}`)
  }
}

/**
 * Matches the FLEET task ID format: a 32-character lowercase hex string
 * produced by SQLite's `lower(hex(randomblob(16)))` — no dashes. The
 * pruner uses this to filter out anything that doesn't look like a task
 * ID, so it never deletes human-created worktrees, source directories, etc.
 */
const TASK_ID_HEX_PATTERN = /^[0-9a-f]{32}$/i

/**
 * Returns true if the given path looks like a real git worktree:
 * it must contain a `.git` entry (file or directory). FLEET-created
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
  if (!existsSync(worktreeBase)) return 0
  const log = logger ?? defaultLogger
  let pruned = 0
  const candidates = await enumeratePruneCandidates(worktreeBase, log)
  for (const candidate of candidates) {
    if (!isPrunableCandidate(candidate, isActive, isReview, log)) continue
    if (await deleteWorktreeDir(candidate.worktreePath, log)) pruned++
  }
  return pruned
}

interface PruneCandidate {
  taskId: string
  worktreePath: string
}

async function enumeratePruneCandidates(
  worktreeBase: string,
  log: Logger
): Promise<PruneCandidate[]> {
  const entries = await fs.promises.readdir(worktreeBase, { withFileTypes: true })
  const repoDirs = entries
    .filter((d) => d.isDirectory() && d.name !== '.locks')
    .map((d) => path.join(worktreeBase, d.name))
  const candidateLists = await Promise.all(
    repoDirs.map((repoDir) => enumerateRepoCandidates(repoDir, log))
  )
  return candidateLists.flat()
}

async function enumerateRepoCandidates(repoDir: string, log: Logger): Promise<PruneCandidate[]> {
  let entries: fs.Dirent[]
  try {
    entries = await fs.promises.readdir(repoDir, { withFileTypes: true })
  } catch (err) {
    log.warn(`[worktree] Failed to read repo directory during prune: ${err}`)
    return []
  }
  return entries
    .filter((d) => d.isDirectory())
    .map((d) => ({ taskId: d.name, worktreePath: path.join(repoDir, d.name) }))
}

/**
 * Returns true only when it is safe to delete `candidate.worktreePath`.
 *
 * Safety gates, in order:
 *  1. Directory name must look like a FLEET task id (FLEET hex task ID-shaped —
 *     32-char hex, no dashes). Users may point `worktreeBase` at a directory
 *     they share with human worktrees, so we must not delete anything that
 *     doesn't look like our own.
 *  2. The directory must contain a `.git` entry — defense-in-depth in case a
 *     hex-named directory exists that we did not create.
 *  3. The task must not be currently active or in review.
 */
function isPrunableCandidate(
  candidate: PruneCandidate,
  isActive: (taskId: string) => boolean,
  isReview: ((taskId: string) => boolean) | undefined,
  log: Logger
): boolean {
  if (!TASK_ID_HEX_PATTERN.test(candidate.taskId)) return false
  if (!looksLikeWorktree(candidate.worktreePath)) {
    log.warn(
      `[worktree] Skipping prune of ${candidate.worktreePath}: FLEET task ID-named but not a git worktree (no .git entry)`
    )
    return false
  }
  if (isActive(candidate.taskId)) return false
  if (isReview?.(candidate.taskId)) {
    log.info(`[worktree] Skipping prune of review worktree for task ${candidate.taskId}`)
    return false
  }
  return true
}

async function deleteWorktreeDir(worktreePath: string, log: Logger): Promise<boolean> {
  try {
    // Use shell `rm -rf` instead of rmSync to avoid Electron's ASAR
    // interception, which treats .asar files as directories and fails with
    // ENOTDIR when trying to rmdir them.
    const env = buildAgentEnv()
    await execFileAsync('rm', ['-rf', worktreePath], { env })
    return true
  } catch (err) {
    log.warn(
      `[worktree] Failed to remove stale worktree directory (worktreePath=${worktreePath}): ${err}`
    )
    return false
  }
}
