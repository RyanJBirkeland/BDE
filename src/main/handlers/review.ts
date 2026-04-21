/**
 * Review IPC handlers — code review actions for the in-app review station.
 *
 * Provides diff viewing, commit listing, local merge, PR creation,
 * revision requests, and task discard for worktree-based agent tasks.
 *
 * NOTE: These handlers are thin adapters. Business logic lives in
 * review-orchestration-service.ts. Handlers should unpack IPC payloads,
 * call the service, and return results.
 */
import { safeHandle } from '../ipc-utils'
import { isValidTaskId } from '../lib/validation'
import { createLogger } from '../logger'
import { getSettingJson } from '../settings'
import { buildAgentEnv } from '../env-utils'
import { execFileAsync } from '../lib/async-utils'
import {
  validateGitRef,
  validateWorktreePath,
  validateFilePath,
  assertWorktreeExists
} from '../lib/review-paths'
import { checkAutoReview } from '../services/auto-review-service'
import type { AutoReviewRule } from '../../shared/types'
import * as reviewOrchestration from '../services/review-orchestration-service'
import { parseNumstat } from '../services/review-orchestration-service'
import { shipBatch } from '../services/review-ship-batch'

const logger = createLogger('review-handlers')

interface RepoConfig {
  name: string
  localPath: string
  githubOwner?: string
  githubRepo?: string
}

export interface ReviewHandlersDeps {
  onStatusTerminal: (taskId: string, status: string) => void | Promise<void>
}

function getRepoConfig(repoName: string): RepoConfig | null {
  const repos = getSettingJson<RepoConfig[]>('repos')
  const target = repoName.toLowerCase()
  return repos?.find((r) => r.name.toLowerCase() === target) ?? null
}

export function registerReviewHandlers(deps: ReviewHandlersDeps): void {
  const env = buildAgentEnv()

  // ============================================================================
  // Query Handlers (stay here — no orchestration needed)
  // ============================================================================

  // review:getDiff — get file list with additions/deletions for a worktree branch
  safeHandle('review:getDiff', async (_e, payload) => {
    const { worktreePath, base } = payload
    validateGitRef(base)
    validateWorktreePath(worktreePath)
    assertWorktreeExists(worktreePath)

    // Get numstat for structured data
    const { stdout: numstatOut } = await execFileAsync(
      'git',
      ['diff', '--numstat', `${base}...HEAD`],
      { cwd: worktreePath, env }
    )

    // Get full patch for file-level diffs
    const { stdout: patchOut } = await execFileAsync('git', ['diff', `${base}...HEAD`], {
      cwd: worktreePath,
      env,
      maxBuffer: 10 * 1024 * 1024 // 10MB for large diffs
    })

    // Build a map of filepath -> patch section
    const patchMap = new Map<string, string>()
    const patchSections = patchOut.split(/^diff --git /m)
    for (const section of patchSections) {
      if (!section.trim()) continue
      // Extract file path from "a/path b/path" line
      const match = section.match(/^a\/(.+?) b\//)
      if (match?.[1]) {
        patchMap.set(match[1], 'diff --git ' + section)
      }
    }

    const files = numstatOut.trim() ? parseNumstat(numstatOut, patchMap) : []
    return { files }
  })

  // review:getCommits — list commits between base and HEAD
  safeHandle('review:getCommits', async (_e, payload) => {
    const { worktreePath, base } = payload
    validateGitRef(base)
    validateWorktreePath(worktreePath)
    assertWorktreeExists(worktreePath)

    const { stdout } = await execFileAsync(
      'git',
      ['log', `${base}..HEAD`, '--format=%H%x00%s%x00%an%x00%aI', '--reverse'],
      { cwd: worktreePath, env }
    )

    const commits = stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [hash = '', message = '', author = '', date = ''] = line.split('\x00')
        return { hash, message, author, date }
      })

    return { commits }
  })

  // review:getFileDiff — get diff for a single file
  safeHandle('review:getFileDiff', async (_e, payload) => {
    const { worktreePath, filePath, base } = payload
    validateGitRef(base)
    validateWorktreePath(worktreePath)
    assertWorktreeExists(worktreePath)
    validateFilePath(filePath)

    const { stdout } = await execFileAsync('git', ['diff', `${base}...HEAD`, '--', filePath], {
      cwd: worktreePath,
      env,
      maxBuffer: 10 * 1024 * 1024
    })

    return { diff: stdout }
  })

  // review:checkFreshness — check if task's rebase is current with origin/main
  safeHandle('review:checkFreshness', async (_e, payload) => {
    const { taskId } = payload
    if (!isValidTaskId(taskId)) throw new Error('Invalid task ID format')

    // Import task functions inline to avoid top-level coupling
    const { getTask } = await import('../services/sprint-service')
    const task = getTask(taskId)
    if (!task) return { status: 'unknown' as const }
    if (!task.rebase_base_sha) return { status: 'unknown' as const }

    try {
      const repoConfig = getRepoConfig(task.repo)
      if (!repoConfig) return { status: 'unknown' as const }

      await execFileAsync('git', ['fetch', 'origin', 'main'], {
        cwd: repoConfig.localPath,
        env
      })

      const { stdout: currentShaOut } = await execFileAsync('git', ['rev-parse', 'origin/main'], {
        cwd: repoConfig.localPath,
        env
      })
      const currentSha = currentShaOut.trim()

      if (currentSha === task.rebase_base_sha) {
        return { status: 'fresh' as const, commitsBehind: 0 }
      }

      // Count commits between task's base and current origin/main
      const { stdout: countOut } = await execFileAsync(
        'git',
        ['rev-list', '--count', `${task.rebase_base_sha}..origin/main`],
        { cwd: repoConfig.localPath, env }
      )
      const commitsBehind = parseInt(countOut.trim(), 10)

      return { status: 'stale' as const, commitsBehind }
    } catch (err: unknown) {
      logger.warn(`[review:checkFreshness] Error for task ${taskId}: ${err}`)
      return { status: 'unknown' as const }
    }
  })

  // review:generateSummary — AI-generated review summary (stub, not implemented)
  safeHandle('review:generateSummary', async (_e, _payload) => {
    logger.warn('review:generateSummary called but not implemented — returning empty summary')
    return { summary: '' }
  })

  // review:checkAutoReview — check if task qualifies for auto-review
  safeHandle('review:checkAutoReview', async (_e, payload) => {
    const { taskId } = payload
    if (!isValidTaskId(taskId)) throw new Error('Invalid task ID format')

    const { getTask } = await import('../services/sprint-service')
    const task = getTask(taskId)
    if (!task) throw new Error(`Task ${taskId} not found`)
    if (!task.worktree_path) {
      return { shouldAutoMerge: false, shouldAutoApprove: false, matchedRule: null }
    }

    const rules = getSettingJson<AutoReviewRule[]>('autoReview.rules')
    if (!rules || rules.length === 0) {
      return { shouldAutoMerge: false, shouldAutoApprove: false, matchedRule: null }
    }

    return checkAutoReview({ worktreePath: task.worktree_path, rules, env })
  })

  // ============================================================================
  // Action Handlers (thin wrappers to orchestration service)
  // ============================================================================

  safeHandle('review:mergeLocally', async (_e, payload) => {
    if (!isValidTaskId(payload.taskId)) throw new Error('Invalid task ID format')
    return reviewOrchestration.mergeLocally({
      taskId: payload.taskId,
      strategy: payload.strategy,
      env,
      onStatusTerminal: deps.onStatusTerminal
    })
  })

  safeHandle('review:createPr', async (_e, payload) => {
    if (!isValidTaskId(payload.taskId)) throw new Error('Invalid task ID format')
    const result = await reviewOrchestration.createPr({
      taskId: payload.taskId,
      title: payload.title,
      body: payload.body,
      env,
      onStatusTerminal: deps.onStatusTerminal
    })
    if (!result.success || !result.prUrl) {
      throw new Error(result.error || 'PR creation failed')
    }
    return { prUrl: result.prUrl }
  })

  safeHandle('review:requestRevision', async (_e, payload) => {
    if (!isValidTaskId(payload.taskId)) throw new Error('Invalid task ID format')
    return reviewOrchestration.requestRevision({
      taskId: payload.taskId,
      feedback: payload.feedback,
      mode: payload.mode
    })
  })

  safeHandle('review:discard', async (_e, payload) => {
    if (!isValidTaskId(payload.taskId)) throw new Error('Invalid task ID format')
    return reviewOrchestration.discard({
      taskId: payload.taskId,
      env,
      onStatusTerminal: deps.onStatusTerminal
    })
  })

  safeHandle('review:shipIt', async (_e, payload) => {
    if (!isValidTaskId(payload.taskId)) throw new Error('Invalid task ID format')
    return reviewOrchestration.shipIt({
      taskId: payload.taskId,
      strategy: payload.strategy,
      env,
      onStatusTerminal: deps.onStatusTerminal
    })
  })

  safeHandle('review:shipBatch', async (_e, payload) => {
    if (!Array.isArray(payload.taskIds) || payload.taskIds.length === 0) {
      throw new Error('taskIds must be a non-empty array')
    }
    for (const id of payload.taskIds) {
      if (!isValidTaskId(id)) throw new Error(`Invalid task ID format: ${id}`)
    }
    return shipBatch({
      taskIds: payload.taskIds,
      strategy: payload.strategy,
      env,
      onStatusTerminal: deps.onStatusTerminal
    })
  })

  safeHandle('review:rebase', async (_e, payload) => {
    if (!isValidTaskId(payload.taskId)) throw new Error('Invalid task ID format')
    return reviewOrchestration.rebase({
      taskId: payload.taskId,
      env
    })
  })
}
