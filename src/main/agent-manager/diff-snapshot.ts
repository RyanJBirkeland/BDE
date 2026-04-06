/**
 * Capture a diff snapshot for a completed agent worktree, suitable for
 * persisting to `sprint_tasks.review_diff_snapshot`. This lets the Code
 * Review UI show changes even after the worktree is cleaned up.
 */
import { execFile as execFileCb } from 'node:child_process'
import { promisify } from 'node:util'
import type { ReviewDiffSnapshot } from '../../shared/types'
import { buildAgentEnv } from '../env-utils'
import type { Logger } from './types'

const execFile = promisify(execFileCb)

/** Max total characters of full-patch content we're willing to store. */
const MAX_SNAPSHOT_CHARS = 500_000

export async function captureDiffSnapshot(
  worktreePath: string,
  base: string,
  logger: Logger
): Promise<ReviewDiffSnapshot | null> {
  const env = buildAgentEnv()
  try {
    const { stdout: numstatOut } = await execFile('git', ['diff', '--numstat', `${base}...HEAD`], {
      cwd: worktreePath,
      env,
      maxBuffer: 10 * 1024 * 1024
    })

    const { stdout: statusOut } = await execFile(
      'git',
      ['diff', '--name-status', `${base}...HEAD`],
      { cwd: worktreePath, env, maxBuffer: 10 * 1024 * 1024 }
    )

    const statusMap = new Map<string, string>()
    for (const line of statusOut.split('\n').filter(Boolean)) {
      const parts = line.split('\t')
      if (parts.length >= 2) {
        const s = parts[0].trim()
        const p = parts.slice(1).join('\t').trim()
        statusMap.set(p, s)
      }
    }

    const files = numstatOut
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const parts = line.split('\t')
        const additions = parts[0] === '-' ? 0 : parseInt(parts[0], 10) || 0
        const deletions = parts[1] === '-' ? 0 : parseInt(parts[1], 10) || 0
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

    // Try to attach per-file patches. If a single file's patch would push us
    // over the budget, we *skip that file's patch* but keep going so smaller
    // files later in the list still get their patches attached. Previously
    // a single oversized file would drop every patch in the snapshot.
    let budget = MAX_SNAPSHOT_CHARS
    let truncated = false
    for (const file of files) {
      try {
        const { stdout: patch } = await execFile(
          'git',
          ['diff', `${base}...HEAD`, '--', file.path],
          { cwd: worktreePath, env, maxBuffer: 10 * 1024 * 1024 }
        )
        if (patch.length > budget) {
          // Skip this file's patch — file-level stats remain available.
          truncated = true
          continue
        }
        file.patch = patch
        budget -= patch.length
      } catch (err) {
        logger.warn(
          `[diff-snapshot] Failed to capture patch for ${file.path}: ${
            err instanceof Error ? err.message : String(err)
          }`
        )
      }
    }

    return {
      capturedAt: new Date().toISOString(),
      totals,
      files,
      ...(truncated ? { truncated: true } : {})
    }
  } catch (err) {
    logger.warn(
      `[diff-snapshot] capture failed: ${err instanceof Error ? err.message : String(err)}`
    )
    return null
  }
}
