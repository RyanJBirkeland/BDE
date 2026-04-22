/**
 * Review query service — read-only diff/commit/file inspection used by the
 * Code Review Station.
 *
 * The IPC handler layer (`handlers/review.ts`) supplies the env bag and
 * forwards payload validation; this module owns the git plumbing and the
 * patch-section parsing so the handler stays a thin boundary adapter.
 */

import { execFileAsync } from '../lib/async-utils'
import {
  validateGitRef,
  validateWorktreePath,
  validateFilePath,
  assertWorktreeExists
} from '../lib/review-paths'
import { parseNumstat } from './review-merge-service'

const MAX_DIFF_BUFFER_BYTES = 10 * 1024 * 1024

export interface ReviewQueryEnv {
  env: NodeJS.ProcessEnv
}

export interface DiffFileEntry {
  path: string
  status: string
  additions: number
  deletions: number
  patch: string
}

/**
 * List every file changed between `base` and the worktree's HEAD with
 * line counts and the per-file patch section.
 */
export async function getReviewDiff(
  worktreePath: string,
  base: string,
  deps: ReviewQueryEnv
): Promise<{ files: DiffFileEntry[] }> {
  validateGitRef(base)
  validateWorktreePath(worktreePath)
  assertWorktreeExists(worktreePath)

  const numstatOut = await runGitDiffNumstat(worktreePath, base, deps.env)
  const patchOut = await runGitDiffFull(worktreePath, base, deps.env)
  const patchMap = buildPatchMap(patchOut)
  const files = numstatOut.trim() ? parseNumstat(numstatOut, patchMap) : []
  return { files }
}

/** List commits between `base` and the worktree's HEAD, oldest first. */
export async function getReviewCommits(
  worktreePath: string,
  base: string,
  deps: ReviewQueryEnv
): Promise<{ commits: ReviewCommit[] }> {
  validateGitRef(base)
  validateWorktreePath(worktreePath)
  assertWorktreeExists(worktreePath)

  const { stdout } = await execFileAsync(
    'git',
    ['log', `${base}..HEAD`, '--format=%H%x00%s%x00%an%x00%aI', '--reverse'],
    { cwd: worktreePath, env: deps.env }
  )
  return { commits: parseCommitLog(stdout) }
}

/** Get the unified diff for a single file path between `base` and HEAD. */
export async function getReviewFileDiff(
  worktreePath: string,
  filePath: string,
  base: string,
  deps: ReviewQueryEnv
): Promise<{ diff: string }> {
  validateGitRef(base)
  validateWorktreePath(worktreePath)
  assertWorktreeExists(worktreePath)
  validateFilePath(filePath)

  const { stdout } = await execFileAsync('git', ['diff', `${base}...HEAD`, '--', filePath], {
    cwd: worktreePath,
    env: deps.env,
    maxBuffer: MAX_DIFF_BUFFER_BYTES
  })
  return { diff: stdout }
}

export interface ReviewCommit {
  hash: string
  message: string
  author: string
  date: string
}

async function runGitDiffNumstat(
  worktreePath: string,
  base: string,
  env: NodeJS.ProcessEnv
): Promise<string> {
  const { stdout } = await execFileAsync('git', ['diff', '--numstat', `${base}...HEAD`], {
    cwd: worktreePath,
    env
  })
  return stdout
}

async function runGitDiffFull(
  worktreePath: string,
  base: string,
  env: NodeJS.ProcessEnv
): Promise<string> {
  const { stdout } = await execFileAsync('git', ['diff', `${base}...HEAD`], {
    cwd: worktreePath,
    env,
    maxBuffer: MAX_DIFF_BUFFER_BYTES
  })
  return stdout
}

function buildPatchMap(patchOut: string): Map<string, string> {
  const patchMap = new Map<string, string>()
  const sections = patchOut.split(/^diff --git /m)
  for (const section of sections) {
    if (!section.trim()) continue
    const match = section.match(/^a\/(.+?) b\//)
    if (match?.[1]) {
      patchMap.set(match[1], 'diff --git ' + section)
    }
  }
  return patchMap
}

function parseCommitLog(stdout: string): ReviewCommit[] {
  return stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [hash = '', message = '', author = '', date = ''] = line.split('\x00')
      return { hash, message, author, date }
    })
}
