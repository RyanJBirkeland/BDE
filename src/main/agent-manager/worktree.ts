import { execFile } from 'node:child_process'
import { mkdirSync, existsSync, readdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { promisify } from 'node:util'
import path from 'node:path'

const execFileAsync = promisify(execFile)

// Ensure git/gh are findable in Electron's minimal PATH
const EXEC_ENV = {
  ...process.env,
  PATH: ['/usr/local/bin', '/opt/homebrew/bin', `${process.env.HOME}/.local/bin`, process.env.PATH].filter(Boolean).join(':'),
}

export function branchNameForTask(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
  return `agent/${slug}`
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

function acquireLock(worktreeBase: string, repoPath: string): void {
  const locksDir = path.join(worktreeBase, '.locks')
  mkdirSync(locksDir, { recursive: true })

  const lockFile = lockPath(worktreeBase, repoPath)

  if (existsSync(lockFile)) {
    const raw = readFileSync(lockFile, 'utf-8').trim()
    const pid = parseInt(raw, 10)
    if (!isNaN(pid)) {
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

export async function setupWorktree(opts: SetupWorktreeOpts): Promise<SetupWorktreeResult> {
  const { repoPath, worktreeBase, taskId, title } = opts
  const branch = branchNameForTask(title)
  const repoDir = path.join(worktreeBase, repoSlug(repoPath))
  const worktreePath = path.join(repoDir, taskId)

  mkdirSync(repoDir, { recursive: true })

  acquireLock(worktreeBase, repoPath)

  try {
    await execFileAsync('git', ['worktree', 'add', '-b', branch, worktreePath], { cwd: repoPath, env: EXEC_ENV })
  } catch (err) {
    // Clean up partial worktree on failure
    try {
      await execFileAsync('git', ['worktree', 'remove', worktreePath, '--force'], { cwd: repoPath, env: EXEC_ENV })
    } catch {
      // best-effort
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
