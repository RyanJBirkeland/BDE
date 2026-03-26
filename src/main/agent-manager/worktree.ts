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
    // If branch already exists (stale from previous failed run), delete and retry
    const errMsg = err instanceof Error ? err.message : String(err)
    if (errMsg.includes('already exists')) {
      ;(logger ?? console).warn(`[worktree] Stale branch ${branch} — deleting and retrying`)
      try {
        // Force-remove any existing worktree that references this branch
        // This handles the case where worktree dir exists at a different path
        // (e.g., /private/tmp vs /tmp, or leftover from a previous run)
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
              await execFileAsync(
                'git', ['worktree', 'remove', '--force', stalePath],
                { cwd: repoPath, env: buildAgentEnv() }
              ).catch(() => {
                // If git worktree remove fails, try rm -rf + prune
                try { rmSync(stalePath, { recursive: true, force: true }) } catch (rmErr) { ;(logger ?? console).warn(`[worktree] Failed to rm stale worktree path: ${rmErr}`) }
              })
            }
          }
        } catch (listErr) {
          ;(logger ?? console).warn(`[worktree] Failed to list worktrees for stale branch cleanup: ${listErr}`)
        }

        await execFileAsync('git', ['worktree', 'prune'], { cwd: repoPath, env: buildAgentEnv() })

        // Also remove the target worktree path if it exists from a previous run
        if (existsSync(worktreePath)) {
          try {
            await execFileAsync(
              'git', ['worktree', 'remove', '--force', worktreePath],
              { cwd: repoPath, env: buildAgentEnv() }
            )
          } catch (removeErr) {
            ;(logger ?? console).warn(`[worktree] Failed to remove existing worktree path: ${removeErr}`)
            rmSync(worktreePath, { recursive: true, force: true })
          }
          await execFileAsync('git', ['worktree', 'prune'], { cwd: repoPath, env: buildAgentEnv() })
        }

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
        } catch (checkErr) {
          ;(logger ?? console).warn(`[worktree] Failed to check unpushed commits: ${checkErr}`)
        }
        try {
          await execFileAsync('git', ['branch', '-D', branch], { cwd: repoPath, env: buildAgentEnv() })
        } catch (branchErr) {
          ;(logger ?? console).warn(`[worktree] Failed to delete branch (will prune and retry): ${branchErr}`)
          await execFileAsync('git', ['worktree', 'prune'], { cwd: repoPath, env: buildAgentEnv() })
          await execFileAsync('git', ['branch', '-D', branch], { cwd: repoPath, env: buildAgentEnv() })
        }
        await execFileAsync('git', ['worktree', 'add', '-b', branch, worktreePath], { cwd: repoPath, env: buildAgentEnv() })
      } catch (retryErr) {
        // Retry failed — clean up and throw
        try { rmSync(worktreePath, { recursive: true, force: true }) } catch (cleanupErr) { ;(logger ?? console).warn(`[worktree] Failed to cleanup worktree path after retry failure: ${cleanupErr}`) }
        releaseLock(worktreeBase, repoPath)
        throw retryErr
      }
    } else {
      // Non-branch-exists error — clean up and throw
      try {
        await execFileAsync('git', ['worktree', 'remove', worktreePath, '--force'], { cwd: repoPath, env: buildAgentEnv() })
      } catch (removeErr) {
        ;(logger ?? console).warn(`[worktree] Failed to remove worktree after non-branch error: ${removeErr}`)
      }
      try {
        rmSync(worktreePath, { recursive: true, force: true })
      } catch (rmErr) {
        ;(logger ?? console).warn(`[worktree] Failed to remove worktree directory after non-branch error: ${rmErr}`)
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
