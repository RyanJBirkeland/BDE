/**
 * Post-merge CSS deduplication orchestrator.
 *
 * After a merge commit lands in the main repo, this module:
 *   1. Identifies CSS files changed by the merge (via git diff HEAD~1)
 *   2. Runs deduplicateCss() on each changed CSS file
 *   3. Writes back any files that were modified
 *   4. Commits the dedup changes as a follow-up commit
 *
 * Always non-fatal — errors are logged but never propagate to callers.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { execFile as execFileCb } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { createLogger } from '../logger'
import { buildAgentEnv } from '../env-utils'
import { deduplicateCss } from './css-dedup'

const execFile = promisify(execFileCb)
const logger = createLogger('post-merge-dedup')

export interface DedupReport {
  filesModified: string[]
  totalRemoved: number
  warnings: string[]
  committed: boolean
}

/**
 * Run post-merge CSS deduplication against the given repo directory.
 *
 * Returns `null` if no CSS files were changed in the most recent commit
 * (HEAD~1..HEAD). Returns a `DedupReport` otherwise, regardless of whether
 * any duplicates were found.
 */
export async function runPostMergeDedup(repoPath: string): Promise<DedupReport | null> {
  const env = buildAgentEnv()

  // Determine which files changed in the merge commit
  let changedFiles: string[] = []
  try {
    const { stdout } = await execFile(
      'git',
      ['diff', '--name-only', '--diff-filter=ACMR', 'HEAD~1', 'HEAD'],
      { cwd: repoPath, env }
    )
    changedFiles = stdout.trim().split('\n').filter(Boolean)
  } catch (err) {
    // HEAD~1 may not exist (initial commit, shallow clone, etc.) — skip gracefully
    logger.warn(`[post-merge-dedup] Could not get changed files from HEAD~1: ${err}`)
    return null
  }

  // Filter to CSS files only
  const cssFiles = changedFiles.filter((f) => f.endsWith('.css'))
  if (cssFiles.length === 0) {
    logger.info('[post-merge-dedup] No CSS files changed — skipping dedup')
    return null
  }

  logger.info(
    `[post-merge-dedup] Processing ${cssFiles.length} CSS file(s): ${cssFiles.join(', ')}`
  )

  const filesModified: string[] = []
  let totalRemoved = 0
  const allWarnings: string[] = []

  for (const relPath of cssFiles) {
    const absPath = join(repoPath, relPath)
    let original: string
    try {
      original = readFileSync(absPath, 'utf8')
    } catch (err) {
      logger.warn(`[post-merge-dedup] Could not read ${relPath}: ${err}`)
      continue
    }

    const result = deduplicateCss(original)
    allWarnings.push(...result.warnings)

    if (result.removed.length > 0) {
      try {
        writeFileSync(absPath, result.deduplicated, 'utf8')
        filesModified.push(relPath)
        totalRemoved += result.removed.length
        logger.info(
          `[post-merge-dedup] Removed ${result.removed.length} duplicate(s) from ${relPath}`
        )
      } catch (err) {
        logger.warn(`[post-merge-dedup] Could not write ${relPath}: ${err}`)
      }
    }
  }

  let committed = false
  if (filesModified.length > 0) {
    try {
      // Stage modified CSS files
      await execFile('git', ['add', ...filesModified], { cwd: repoPath, env })

      // Commit the dedup changes
      const commitMessage = 'chore: deduplicate CSS from merge\n\nAutomated by BDE post-merge dedup'
      await execFile('git', ['commit', '-m', commitMessage], { cwd: repoPath, env })

      committed = true
      logger.info(
        `[post-merge-dedup] Committed dedup of ${filesModified.length} file(s), removed ${totalRemoved} duplicate block(s)`
      )
    } catch (err) {
      logger.warn(`[post-merge-dedup] Failed to commit dedup changes: ${err}`)
    }
  }

  return {
    filesModified,
    totalRemoved,
    warnings: allWarnings,
    committed
  }
}
