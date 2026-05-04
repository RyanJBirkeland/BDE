/**
 * Capture a diff snapshot for a completed agent worktree, suitable for
 * persisting to `sprint_tasks.review_diff_snapshot`. This lets the Code
 * Review UI show changes even after the worktree is cleaned up.
 */
import type { ReviewDiffSnapshot } from '../../shared/types'
import { execFileAsync } from '../lib/async-utils'
import { buildAgentEnv } from '../env-utils'
import type { Logger } from '../logger'
import { getErrorMessage } from '../../shared/errors'
import { nowIso } from '../../shared/time'

/** Max total characters of full-patch content we're willing to store. */
const MAX_SNAPSHOT_CHARS = 500_000

export async function captureDiffSnapshot(
  worktreePath: string,
  base: string,
  logger: Logger
): Promise<ReviewDiffSnapshot | null> {
  const env = buildAgentEnv()
  try {
    const { stdout: numstatOut } = await execFileAsync(
      'git',
      ['diff', '--numstat', `${base}...HEAD`],
      {
        cwd: worktreePath,
        env,
        maxBuffer: 10 * 1024 * 1024
      }
    )

    const { stdout: statusOut } = await execFileAsync(
      'git',
      ['diff', '--name-status', `${base}...HEAD`],
      { cwd: worktreePath, env, maxBuffer: 10 * 1024 * 1024 }
    )

    const statusMap = new Map<string, string>()
    for (const line of statusOut.split('\n').filter(Boolean)) {
      const parts = line.split('\t')
      if (parts.length >= 2 && parts[0]) {
        const statusCode = parts[0].trim()
        const filePath = parts.slice(1).join('\t').trim()
        statusMap.set(filePath, statusCode)
      }
    }

    const files = numstatOut
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const parts = line.split('\t')
        const additionsText = parts[0] ?? ''
        const deletionsText = parts[1] ?? ''
        const additions = additionsText === '-' ? 0 : parseInt(additionsText, 10) || 0
        const deletions = deletionsText === '-' ? 0 : parseInt(deletionsText, 10) || 0
        const path = parts.slice(2).join('\t')
        return {
          path,
          status: statusMap.get(path) ?? 'M',
          additions,
          deletions
        } as ReviewDiffSnapshot['files'][number]
      })

    if (files.length === 0) return null

    const totals = {
      additions: files.reduce((s, f) => s + f.additions, 0),
      deletions: files.reduce((s, f) => s + f.deletions, 0),
      files: files.length
    }

    // Fetch all per-file patches in a single git call, then distribute them.
    // A loop of N per-file diffs costs N+2 subprocesses; this collapses to 3.
    const { truncated, patchedFiles } = await fetchAndDistributePatches(
      files,
      base,
      worktreePath,
      env,
      logger
    )

    return {
      capturedAt: nowIso(),
      totals,
      files: patchedFiles,
      ...(truncated ? { truncated: true } : {})
    }
  } catch (err) {
    logger.warn(`[diff-snapshot] capture failed: ${getErrorMessage(err)}`)
    return null
  }
}

/**
 * Fetches all file patches in a single `git diff` call and distributes them
 * to the matching file entries by path. Splitting on `diff --git` headers
 * avoids the N+2 subprocess cost of the previous per-file loop.
 *
 * Budget accounting mirrors the original: files whose patch would exceed the
 * remaining character budget are skipped (stats kept), and `truncated` is set.
 *
 * Returns a new array of file objects — the input array is never mutated.
 */
async function fetchAndDistributePatches(
  files: ReviewDiffSnapshot['files'],
  base: string,
  worktreePath: string,
  env: NodeJS.ProcessEnv,
  logger: Logger
): Promise<{ truncated: boolean; patchedFiles: ReviewDiffSnapshot['files'] }> {
  let combinedDiff: string
  try {
    const { stdout } = await execFileAsync('git', ['diff', `${base}...HEAD`], {
      cwd: worktreePath,
      env,
      maxBuffer: 50 * 1024 * 1024
    })
    combinedDiff = stdout
  } catch (err) {
    logger.warn(`[diff-snapshot] Combined diff failed: ${getErrorMessage(err)}`)
    return { truncated: false, patchedFiles: files }
  }

  const patchByPath = splitCombinedDiffByFile(combinedDiff)

  let budget = MAX_SNAPSHOT_CHARS
  let truncated = false
  const patchedFiles: ReviewDiffSnapshot['files'] = []

  for (const file of files) {
    const patch = patchByPath.get(file.path)
    if (patch === undefined || patch.length > budget) {
      if (patch !== undefined) truncated = true
      patchedFiles.push(file)
      continue
    }
    patchedFiles.push({ ...file, patch })
    budget -= patch.length
  }

  return { truncated, patchedFiles }
}

/**
 * Splits a combined `git diff` output into a map of file path → patch block.
 * Each block starts at `diff --git a/<path> b/<path>` and runs to the next
 * such header (or end of string). The file path is extracted from the
 * `--- a/<path>` line within the block, which matches the unescaped path that
 * `numstat` and `name-status` report.
 */
function splitCombinedDiffByFile(combinedDiff: string): Map<string, string> {
  const result = new Map<string, string>()
  if (!combinedDiff) return result

  // Split on the `diff --git` header — keep the delimiter by using a lookahead.
  const blocks = combinedDiff.split(/(?=^diff --git )/m).filter(Boolean)

  for (const block of blocks) {
    // The `--- a/<path>` line gives us the path that matches numstat output.
    // New files show `--- /dev/null`; in that case fall back to the `+++ b/` line.
    const minusMatch = block.match(/^--- a\/(.+)$/m)
    const plusMatch = block.match(/^\+\+\+ b\/(.+)$/m)
    const path = minusMatch?.[1] ?? plusMatch?.[1]
    if (path) {
      result.set(path, block)
    }
  }

  return result
}
