/**
 * Main-repo state guards used by worktree setup and auto-merge.
 *
 * These helpers detect — and, where possible, repair — the specific failure
 * mode that lets agent edits leak into the main repo's working tree: a
 * `git merge` (either `--ff-only` during worktree setup or `--squash` during
 * auto-merge) that is interrupted mid-sequence and leaves `.git/MERGE_HEAD`
 * or modified files behind. All guards operate against the MAIN repo path,
 * never a worktree.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { execFileAsync } from './async-utils'
import type { Logger } from '../logger'

/**
 * Parse `git status --porcelain=v1` output and decide whether the worktree
 * should be considered dirty for the main-repo-guard check. Returns false
 * (not-dirty) only when every dirty path is a markdown file under docs/ —
 * audit/doc commits in-progress should not scorch pipeline tasks.
 */
export function isRepoDirtyForGuard(porcelainOutput: string): boolean {
  const lines = porcelainOutput.split('\n').filter((l) => l.length > 0)
  if (lines.length === 0) return false
  for (const line of lines) {
    // Porcelain v1 format: 2 status chars, 1 space, path. Untracked looks like "?? path".
    const path = line.slice(3)
    const isDocsMarkdown = /^docs\/.*\.md$/.test(path)
    if (!isDocsMarkdown) return true
  }
  return false
}

/**
 * Runs `git status --porcelain` in `repoPath` and returns the raw output
 * (empty string when the working tree is clean).
 */
export async function getMainRepoPorcelainStatus(
  repoPath: string,
  env: Record<string, string | undefined>
): Promise<string> {
  const { stdout } = await execFileAsync('git', ['status', '--porcelain'], {
    cwd: repoPath,
    env
  })
  return stdout.trim()
}

/**
 * Returns true when `.git/MERGE_HEAD` exists in the main repo — the canonical
 * signal that a merge was started and never completed.
 */
function isMergeInProgress(repoPath: string): boolean {
  return existsSync(path.join(repoPath, '.git', 'MERGE_HEAD'))
}

/**
 * Best-effort abort of an in-progress merge. Never throws — callers have
 * already decided to fail the surrounding operation; this is cleanup only.
 */
async function bestEffortMergeAbort(
  repoPath: string,
  env: Record<string, string | undefined>
): Promise<void> {
  try {
    await execFileAsync('git', ['merge', '--abort'], { cwd: repoPath, env })
  } catch {
    /* best effort */
  }
}

/**
 * Best-effort checkout of the working tree to HEAD. Used as a last-resort
 * cleanup when a stray modified file is detected in the main repo.
 */
async function bestEffortCheckoutHead(
  repoPath: string,
  env: Record<string, string | undefined>
): Promise<void> {
  try {
    await execFileAsync('git', ['checkout', '--', '.'], { cwd: repoPath, env })
  } catch {
    /* best effort */
  }
}

/**
 * Asserts the main repo is clean before or after a write-scope git operation.
 * If `.git/MERGE_HEAD` exists, attempts `git merge --abort` then throws.
 * If the working tree is dirty, attempts abort + checkout cleanup then throws.
 *
 * `phase` is a human-readable label included in the error message so callers
 * can tell pre- from post-operation breaches apart in logs.
 *
 * Special case: if all dirty paths are markdown files under docs/, the guard
 * does not block — docs-only changes are expected during audit periods.
 */
export async function assertRepoCleanOrAbort(
  repoPath: string,
  env: Record<string, string | undefined>,
  logger: Logger | Console,
  phase: string
): Promise<void> {
  if (isMergeInProgress(repoPath)) {
    logger.error(
      `[main-repo-guard] MERGE_HEAD present in ${repoPath} (${phase}) — aborting merge and refusing to proceed`
    )
    await bestEffortMergeAbort(repoPath, env)
    throw new Error(
      `Main repo has an unfinished merge (${phase}) — ran 'git merge --abort' and refusing to proceed`
    )
  }

  const porcelain = await getMainRepoPorcelainStatus(repoPath, env)
  if (porcelain && isRepoDirtyForGuard(porcelain)) {
    logger.error(`[main-repo-guard] Main repo dirty in ${repoPath} (${phase}):\n${porcelain}`)
    await bestEffortMergeAbort(repoPath, env)
    await bestEffortCheckoutHead(repoPath, env)
    throw new Error(
      `Main repo has uncommitted changes (${phase}) — refusing to proceed. Dirty paths:\n${porcelain}`
    )
  }
}
