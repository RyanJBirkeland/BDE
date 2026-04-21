/**
 * test-touch-check.ts — Post-run heuristic that flags changed source files
 * whose sibling tests exist but were not updated.
 *
 * Purpose: pipeline agents often edit a component's code without updating the
 * tests that reference that component's selectors, className, or ARIA shape.
 * A follow-up pre-push or CI run then fails, and the human reviewer loses
 * context on why. Running this check before transitioning to `review` lets
 * us surface the concern directly in the task's advisory notes.
 *
 * This module is advisory only. It does not block the review transition and
 * does not run tests itself.
 */
import { existsSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import { execFileAsync } from '../lib/async-utils'
import type { Logger } from '../logger'

/** File extensions whose changed files warrant a sibling-test lookup. */
const SOURCE_EXTENSIONS: readonly string[] = ['.ts', '.tsx', '.js', '.jsx']

/** Extensions that already identify a test file — never treated as "source missing its test". */
const TEST_PATH_MARKERS: readonly string[] = ['.test.', '.spec.']

export interface TestTouchCheckDeps {
  /** Command runner — override in tests. Defaults to execFileAsync. */
  execFile?: typeof execFileAsync
  /** File existence predicate — override in tests. Defaults to `existsSync`. */
  fileExists?: (path: string) => boolean
  logger?: Logger
}

/**
 * Returns source-file paths (relative to repo root) whose sibling test file
 * exists in the repo but was NOT included in the provided changed-file list.
 *
 * `changedFiles` are expected to be repo-relative paths as emitted by
 * `git diff --name-only`. `repoPath` is the absolute path to the repository
 * checkout — sibling-test existence checks happen on disk against that root.
 */
export function detectUntouchedTests(
  changedFiles: string[],
  repoPath: string,
  deps: TestTouchCheckDeps = {}
): string[] {
  const fileExists = deps.fileExists ?? existsSync
  const changedSet = new Set(changedFiles)
  const untouched: string[] = []

  for (const changed of changedFiles) {
    if (!isSourceFile(changed)) continue
    const candidates = candidateTestPaths(changed)
    const existingCandidate = candidates.find((candidate) => fileExists(join(repoPath, candidate)))
    if (existingCandidate && !changedSet.has(existingCandidate)) {
      untouched.push(changed)
    }
  }

  return untouched
}

/**
 * Runs `git diff --name-only <agentBranch>..origin/main` inside the worktree
 * and returns the list of changed files relative to the repo root.
 */
export async function listChangedFiles(
  agentBranch: string,
  worktreePath: string,
  env: NodeJS.ProcessEnv,
  deps: TestTouchCheckDeps = {}
): Promise<string[]> {
  const exec = deps.execFile ?? execFileAsync
  try {
    const { stdout } = await exec('git', ['diff', '--name-only', `${agentBranch}..origin/main`], {
      cwd: worktreePath,
      env
    })
    return stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
  } catch (err) {
    deps.logger?.warn(
      `[test-touch-check] git diff failed for ${agentBranch} at ${worktreePath}: ${err}`
    )
    return []
  }
}

/**
 * Formats the advisory note appended to the task's `notes` field when
 * sibling tests appear to be out of sync with the agent's source changes.
 */
export function formatAdvisory(untouchedSourcePaths: string[]): string {
  return `\u26A0 no test changes detected for: ${untouchedSourcePaths.join(', ')}`
}

function isSourceFile(path: string): boolean {
  if (TEST_PATH_MARKERS.some((marker) => path.includes(marker))) return false
  const ext = extname(path)
  return SOURCE_EXTENSIONS.includes(ext)
}

/**
 * Returns every sibling test path we consider the conventional location for
 * a given source file: `foo.test.ts` next to it, or `__tests__/foo.test.ts`
 * in the same directory.
 */
function candidateTestPaths(sourcePath: string): string[] {
  const ext = extname(sourcePath)
  const dir = dirname(sourcePath)
  const stem = basename(sourcePath, ext)
  const testFileName = `${stem}.test${ext}`

  const sibling = dir === '.' ? testFileName : `${dir}/${testFileName}`
  const dunderTests = dir === '.' ? `__tests__/${testFileName}` : `${dir}/__tests__/${testFileName}`

  return [sibling, dunderTests]
}
