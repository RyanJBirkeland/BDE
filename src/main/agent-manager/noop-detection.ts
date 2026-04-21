/**
 * Detects when an agent "succeeded" (exited cleanly, produced commits) but
 * in fact did no semantic work. Observed during M8 dogfood: Aider hit a
 * token-limit wall, exited 0, and the only artefact was a `.gitignore`
 * auto-added by Aider to ignore its own `.aider.*` scratch files. BDE
 * then auto-committed that single file and transitioned the task to
 * `review` as if the agent had delivered.
 *
 * A no-op run is one where every file in the commit diff is either:
 * - An Aider scratch path (`.aider*`, `.aider.tags.cache.v4/`).
 * - A `.gitignore` whose content is nothing but Aider-scratch patterns,
 *   comments, or blank lines.
 *
 * This check is conservative: any file outside those patterns is treated
 * as real work, so it never misclassifies a legitimate run.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const AIDER_SCRATCH_PATH_PATTERN = /^\.aider($|\.|\/)/
const AIDER_GITIGNORE_PATTERN_PREFIX = /^\.aider/

export interface NoOpDetectionDeps {
  readonly readFile?: (path: string) => string
}

export function detectNoOpRun(
  changedFiles: readonly string[],
  worktreePath: string,
  deps: NoOpDetectionDeps = {}
): boolean {
  // An empty change list is ambiguous: either `hasCommitsAheadOfMain` already
  // caught it (in which case we never reach here), or `git diff` failed in a
  // test / sandbox where the command can't run. Either way, the safer answer
  // is "not a no-op" — false-positive fail-instead-of-review is worse than a
  // false-negative review of an empty diff (the existing hasCommits gate
  // covers that path).
  if (changedFiles.length === 0) return false
  return changedFiles.every((path) => looksLikeAiderScratch(path, worktreePath, deps))
}

function looksLikeAiderScratch(
  path: string,
  worktreePath: string,
  deps: NoOpDetectionDeps
): boolean {
  if (AIDER_SCRATCH_PATH_PATTERN.test(path)) return true
  if (path === '.gitignore')
    return gitignoreContainsOnlyAiderPatterns(join(worktreePath, path), deps)
  return false
}

function gitignoreContainsOnlyAiderPatterns(
  absolutePath: string,
  deps: NoOpDetectionDeps
): boolean {
  const read = deps.readFile ?? ((p: string) => readFileSync(p, 'utf-8'))
  let contents: string
  try {
    contents = read(absolutePath)
  } catch {
    return false
  }
  const meaningfulLines = contents
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
  if (meaningfulLines.length === 0) return false
  return meaningfulLines.every((line) => AIDER_GITIGNORE_PATTERN_PREFIX.test(line))
}
