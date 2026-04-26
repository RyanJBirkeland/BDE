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
import type { IpcArgsParser } from '../ipc-utils'
import type { IpcChannelMap } from '../../shared/ipc-channels'
import { isValidTaskId } from '../lib/validation'

import { getSettingJson } from '../settings'
import { buildAgentEnv } from '../env-utils'
import { checkAutoReview } from '../services/auto-review-service'
import { getTask } from '../services/sprint-service'
import type { TaskStateService } from '../services/task-state-service'
import type { AutoReviewRule } from '../../shared/types'
import * as reviewOrchestration from '../services/review-orchestration-service'
import {
  getReviewDiff,
  getReviewCommits,
  getReviewFileDiff
} from '../services/review-query-service'
import {
  validateWorktreePath,
  validateFilePath,
  validateGitRef
} from '../lib/review-paths'
import { shipBatch } from '../services/review-ship-batch'
import type { TaskStatus } from '../../shared/task-state-machine'

export function parseReviewWorktreeArgs(
  args: unknown[]
): IpcChannelMap['review:getDiff']['args'] {
  const [payload] = args
  if (payload === null || typeof payload !== 'object') {
    throw new Error('review payload must be an object')
  }
  const p = payload as Record<string, unknown>
  if (typeof p.worktreePath !== 'string') {
    throw new Error('payload.worktreePath must be a string')
  }
  validateWorktreePath(p.worktreePath)
  return [p as IpcChannelMap['review:getDiff']['args'][0]]
}

export function parseReviewFileDiffArgs(
  args: unknown[]
): IpcChannelMap['review:getFileDiff']['args'] {
  const [payload] = args
  if (payload === null || typeof payload !== 'object') {
    throw new Error('review:getFileDiff payload must be an object')
  }
  const p = payload as Record<string, unknown>
  if (typeof p.worktreePath !== 'string') {
    throw new Error('payload.worktreePath must be a string')
  }
  if (typeof p.filePath !== 'string') {
    throw new Error('payload.filePath must be a string')
  }
  if (typeof p.base !== 'string') {
    throw new Error('payload.base must be a string')
  }
  validateWorktreePath(p.worktreePath)
  validateFilePath(p.filePath)
  validateGitRef(p.base)
  return [p as IpcChannelMap['review:getFileDiff']['args'][0]]
}

export interface ReviewHandlersDeps {
  onStatusTerminal: (taskId: string, status: TaskStatus) => void | Promise<void>
  taskStateService: TaskStateService
}

export function registerReviewHandlers(deps: ReviewHandlersDeps): void {
  const env = buildAgentEnv()

  // ============================================================================
  // Query Handlers (delegate to review-query-service)
  // ============================================================================

  safeHandle('review:getDiff', async (_e, payload) => getReviewDiff(payload.worktreePath, payload.base, { env }),
    parseReviewWorktreeArgs as IpcArgsParser<'review:getDiff'>)

  safeHandle('review:getCommits', async (_e, payload) => getReviewCommits(payload.worktreePath, payload.base, { env }),
    parseReviewWorktreeArgs as IpcArgsParser<'review:getCommits'>)

  safeHandle('review:getFileDiff', async (_e, payload) =>
      getReviewFileDiff(payload.worktreePath, payload.filePath, payload.base, { env }),
    parseReviewFileDiffArgs
  )

  // review:checkFreshness — check if task's rebase is current with origin/main
  safeHandle('review:checkFreshness', async (_e, payload) => {
    const { taskId } = payload
    if (!isValidTaskId(taskId)) throw new Error('Invalid task ID format')
    return reviewOrchestration.checkReviewFreshness(taskId, env)
  })

  // review:checkAutoReview — check if task qualifies for auto-review
  safeHandle('review:checkAutoReview', async (_e, payload) => {
    const { taskId } = payload
    if (!isValidTaskId(taskId)) throw new Error('Invalid task ID format')

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

  safeHandle('review:markShippedOutsideBde', async (_e, payload) => {
    const { taskId } = payload
    if (!isValidTaskId(taskId)) throw new Error('Invalid task ID format')
    return reviewOrchestration.markShippedOutsideBde(taskId, { taskStateService: deps.taskStateService })
  })
}
