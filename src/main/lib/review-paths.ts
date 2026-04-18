import { existsSync } from 'fs'
import { resolve } from 'path'
import { homedir } from 'os'
import { getSetting } from '../settings'
import { ADHOC_WORKTREE_BASE } from '../paths'

/**
 * Safe git ref pattern: commit SHAs, branch names, and remote refs.
 * Allows: a-z A-Z 0-9 / _ . -
 * Rejects: leading dashes (option flags), path traversal (..), shell metacharacters,
 *          tilde (~), caret (^), and other git special syntax.
 * Max length: 200 characters (git itself limits ref names to ~256 bytes).
 */
export const SAFE_REF_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9/_.-]{0,198}$/

export function validateGitRef(ref: string | undefined | null): void {
  if (!ref || !SAFE_REF_PATTERN.test(ref)) {
    throw new Error(`Invalid git ref: "${ref}". Must match pattern [a-zA-Z0-9/_.-], max 200 chars.`)
  }
}

/**
 * Returns the configured pipeline worktree base, defaulting to ~/worktrees/bde.
 * Resolved to an absolute path (no trailing slash). Used by the agent manager
 * and disk-space tracking — they only know about pipeline worktrees.
 */
export function getWorktreeBase(): string {
  const configured = getSetting('agentManager.worktreeBase')
  const raw = configured ?? `${homedir()}/worktrees/bde`
  return resolve(raw)
}

/**
 * Returns every worktree base the review handlers should accept. Pipeline
 * agents and adhoc agents use different bases (see `ADHOC_WORKTREE_BASE`),
 * and a sprint task can be backed by a worktree from either path.
 */
export function getAllowedWorktreeBases(): string[] {
  return [getWorktreeBase(), resolve(ADHOC_WORKTREE_BASE)]
}

/**
 * Validates that a renderer-supplied worktreePath is inside one of the
 * allowed worktree bases (pipeline or adhoc). Throws if not.
 *
 * Security: prevents a compromised renderer from running git commands in
 * arbitrary directories (e.g. /etc, /).
 */
export function validateWorktreePath(worktreePath: string | undefined | null): void {
  if (!worktreePath) {
    throw new Error('Invalid worktree path: must not be empty.')
  }
  const resolved = resolve(worktreePath)
  const allowed = getAllowedWorktreeBases()
  const isInsideAllowed = allowed.some(
    (base) => resolved === base || resolved.startsWith(base + '/')
  )
  if (!isInsideAllowed) {
    throw new Error(
      `Invalid worktree path: "${worktreePath}" is not inside an allowed worktree base ` +
        `(${allowed.join(', ')}).`
    )
  }
}

/**
 * Thrown when a worktree directory has been removed from disk but the
 * sprint task row still references it. Distinguished from generic spawn
 * errors so the renderer can surface a clear message ("Worktree was
 * cleaned up — discard the task or re-run") instead of "git not found".
 */
export class WorktreeMissingError extends Error {
  constructor(public readonly path: string) {
    super(`Worktree directory no longer exists on disk: ${path}`)
    this.name = 'WorktreeMissingError'
  }
}

/**
 * Confirms the worktree directory still exists on disk. Without this check,
 * a follow-on `child_process.spawn(..., { cwd })` call against a deleted
 * worktree returns the misleading `spawn git ENOENT` — Node reports the
 * binary as missing whenever the cwd is missing.
 */
export function assertWorktreeExists(worktreePath: string): void {
  if (!existsSync(worktreePath)) {
    throw new WorktreeMissingError(worktreePath)
  }
}

/**
 * Validates a renderer-supplied file path for use inside a git diff command.
 * Rejects absolute paths and path traversal sequences.
 *
 * Security: git diff with '--' separator passes the file path directly to git;
 * absolute paths or traversal could reference files outside the worktree.
 */
export function validateFilePath(filePath: string | undefined | null): void {
  if (!filePath) {
    throw new Error('Invalid file path: must not be empty.')
  }
  if (filePath.startsWith('/')) {
    throw new Error(`Invalid file path: "${filePath}" must not be an absolute path.`)
  }
  if (filePath.includes('..')) {
    throw new Error(`Invalid file path: "${filePath}" must not contain path traversal sequences.`)
  }
}
