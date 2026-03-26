import { execFile } from 'node:child_process'
import { mkdirSync, existsSync, readdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
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
  } catch (err) {
    console.warn(`[worktree] Failed to remove lock file: ${err}`)
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
    const errMsg = err instanceof Error ? err.message : String(err)
    if (!errMsg.includes('already exists')) {
      // Non-recoverable error — clean up and throw
      try { await execFileAsync('git', ['worktree', 'remove', worktreePath, '--force'], { cwd: repoPath, env: buildAgentEnv() }) } catch { /* best effort */ }
      try { rmSync(worktreePath, { recursive: true, force: true }) } catch { /* best effort */ }
      releaseLock(worktreeBase, repoPath)
      throw err
    }

    // Stale worktree or branch from a previous failed run — force-clean everything and retry.
    // Agent branches are throwaway — never try to push before deleting.
    ;(logger ?? console).warn(`[worktree] Stale worktree/branch "${branch}" — force-cleaning and retrying`)

    try {
      // Step 1: Force-remove any worktree referencing this branch (may be at a different path)
      try {
        const { stdout: wtList } = await execFileAsync(
          'git', ['worktree', 'list', '--porcelain'],
          { cwd: repoPath, env: buildAgentEnv() }
        )
        const lines = wtList.split('\n')
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].startsWith('worktree ') && lines[i + 1]?.includes(branch)) {
            const stalePath = lines[i].replace('worktree ', '')
            ;(logger ?? console).warn(`[worktree] Force-removing stale worktree at ${stalePath}`)
            try {
              await execFileAsync('git', ['worktree', 'remove', '--force', stalePath], { cwd: repoPath, env: buildAgentEnv() })
            } catch {
              try { rmSync(stalePath, { recursive: true, force: true }) } catch { /* best effort */ }
            }
          }
        }
      } catch { /* list failed — continue with other cleanup */ }

      // Step 2: Force-remove the target worktree path if it exists
      if (existsSync(worktreePath)) {
        try {
          await execFileAsync('git', ['worktree', 'remove', '--force', worktreePath], { cwd: repoPath, env: buildAgentEnv() })
        } catch {
          rmSync(worktreePath, { recursive: true, force: true })
        }
      }

      // Step 3: Prune all stale worktree references
      await execFileAsync('git', ['worktree', 'prune'], { cwd: repoPath, env: buildAgentEnv() })

      // Step 4: Delete the stale branch (no push — agent branches are throwaway)
      try {
        await execFileAsync('git', ['branch', '-D', branch], { cwd: repoPath, env: buildAgentEnv() })
      } catch {
        // Branch may not exist (only path was stale) — that's fine
      }

      // Step 5: Retry the worktree creation
      await execFileAsync('git', ['worktree', 'add', '-b', branch, worktreePath], { cwd: repoPath, env: buildAgentEnv() })
    } catch (retryErr) {
      try { rmSync(worktreePath, { recursive: true, force: true }) } catch { /* best effort */ }
      releaseLock(worktreeBase, repoPath)
      throw retryErr
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
  const env = buildAgentEnv()

  execFile('git', ['worktree', 'remove', worktreePath, '--force'], { cwd: repoPath, env }, () => {
    // After worktree removed, delete branch and prune
    execFile('git', ['worktree', 'prune'], { cwd: repoPath, env }, () => {
      execFile('git', ['branch', '-D', branch], { cwd: repoPath, env }, () => {
        // best-effort
      })
    })
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
    } catch (err) {
      console.warn(`[worktree] Failed to read repo directory during prune: ${err}`)
      continue
    }

    for (const taskId of taskDirs) {
      if (!isActive(taskId)) {
        const worktreePath = path.join(repoDir, taskId)
        try {
          rmSync(worktreePath, { recursive: true, force: true })
          pruned++
        } catch (err) {
          console.warn(`[worktree] Failed to remove stale worktree directory: ${err}`)
        }
      }
    }
  }

  return pruned
}
