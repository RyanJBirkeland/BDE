import { resolve } from 'path'
import { homedir } from 'os'
import { getSetting } from '../settings'

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
 * Returns the configured worktree base directory, defaulting to ~/worktrees/bde.
 * Resolved to an absolute path (no trailing slash).
 */
export function getWorktreeBase(): string {
  const configured = getSetting('agentManager.worktreeBase')
  const raw = configured ?? `${homedir()}/worktrees/bde`
  return resolve(raw)
}

/**
 * Validates that a renderer-supplied worktreePath is inside the configured
 * worktree base directory. Throws if not.
 *
 * Security: prevents a compromised renderer from running git commands in
 * arbitrary directories (e.g. /etc, /).
 */
export function validateWorktreePath(worktreePath: string | undefined | null): void {
  if (!worktreePath) {
    throw new Error('Invalid worktree path: must not be empty.')
  }
  const resolved = resolve(worktreePath)
  const base = getWorktreeBase()
  if (!resolved.startsWith(base + '/') && resolved !== base) {
    throw new Error(
      `Invalid worktree path: "${worktreePath}" is not inside the configured worktree base (${base}).`
    )
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
