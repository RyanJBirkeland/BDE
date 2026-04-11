/**
 * Sprint service layer — thin wrappers around the sprint task repository that
 * add mutation notifications (SSE broadcast + IPC push).
 *
 * Extracted from handlers/sprint-local.ts so that both IPC handlers
 * and Queue API can share the same notification-aware data access
 * without importing from the handler module.
 *
 * All data access goes through ISprintTaskRepository (createSprintTaskRepository).
 * No direct imports from sprint-queries — the repository is the single abstraction.
 */
import {
  createSprintTaskRepository,
  type ISprintTaskRepository,
  type CreateTaskInput,
  type QueueStats,
  type SpecTypeSuccessRate,
  type DailySuccessRate
} from '../data/sprint-task-repository'
import type { SprintTask } from '../../shared/types'
import { createLogger } from '../logger'
import { broadcast } from '../broadcast'
import { createWebhookService, getWebhookEventName } from './webhook-service'
import { getWebhooks } from '../data/webhook-queries'
import { STUCK_TASK_THRESHOLD_MS } from '../constants'

export type { CreateTaskInput, QueueStats, SpecTypeSuccessRate, DailySuccessRate }

const logger = createLogger('sprint-service')

export type SprintMutationEvent = {
  type: 'created' | 'updated' | 'deleted'
  task: SprintTask
}
export type SprintMutationListener = (event: SprintMutationEvent) => void

const listeners: Set<SprintMutationListener> = new Set()

// Initialize webhook service
const webhookService = createWebhookService({ getWebhooks, logger })

export function onSprintMutation(cb: SprintMutationListener): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

export function notifySprintMutation(type: SprintMutationEvent['type'], task: SprintTask): void {
  const event = { type, task }
  for (const cb of listeners) {
    try {
      cb(event)
    } catch (err) {
      logger.error(`${err}`)
    }
  }

  // Push to renderer windows so Dashboard/SprintCenter refresh immediately
  broadcast('sprint:externalChange')

  // Fire webhooks for external integrations
  try {
    const webhookEvent = getWebhookEventName(type, task)
    webhookService.fireWebhook(webhookEvent, task)
  } catch (err) {
    logger.error(`[webhook] ${err}`)
  }
}

const repo: ISprintTaskRepository = createSprintTaskRepository()

export function getTask(id: string): SprintTask | null {
  return repo.getTask(id)
}

export function listTasks(status?: string): SprintTask[] {
  return repo.listTasks(status)
}

export function listTasksRecent(): SprintTask[] {
  return repo.listTasksRecent()
}

export function createTask(input: CreateTaskInput): SprintTask | null {
  const row = repo.createTask(input)
  if (row) notifySprintMutation('created', row)
  return row
}

export function claimTask(id: string, claimedBy: string): SprintTask | null {
  const result = repo.claimTask(id, claimedBy)
  if (result) notifySprintMutation('updated', result)
  return result
}

export function updateTask(id: string, patch: Record<string, unknown>): SprintTask | null {
  const result = repo.updateTask(id, patch)
  if (result) notifySprintMutation('updated', result)
  return result
}

export function deleteTask(id: string): void {
  const task = repo.getTask(id)
  repo.deleteTask(id)
  if (task) notifySprintMutation('deleted', task)
}

export function releaseTask(id: string, claimedBy: string): SprintTask | null {
  const result = repo.releaseTask(id, claimedBy)
  if (result) notifySprintMutation('updated', result)
  return result
}

export function getQueueStats(): QueueStats {
  return repo.getQueueStats()
}

export function getDoneTodayCount(): number {
  return repo.getDoneTodayCount()
}

export function markTaskDoneByPrNumber(prNumber: number): string[] {
  return repo.markTaskDoneByPrNumber(prNumber)
}

export function markTaskCancelledByPrNumber(prNumber: number): string[] {
  return repo.markTaskCancelledByPrNumber(prNumber)
}

export function listTasksWithOpenPrs(): SprintTask[] {
  return repo.listTasksWithOpenPrs()
}

export function updateTaskMergeableState(prNumber: number, mergeableState: string | null): void {
  repo.updateTaskMergeableState(prNumber, mergeableState)
}

export function flagStuckTasks(): void {
  const allTasks = repo.listTasks()
  const oneHourAgo = Date.now() - STUCK_TASK_THRESHOLD_MS
  const stuck = allTasks.filter(
    (t) =>
      ['error', 'failed'].includes(t.status) &&
      !t.needs_review &&
      new Date(t.updated_at).getTime() < oneHourAgo
  )
  if (stuck.length > 0) {
    for (const t of stuck) {
      repo.updateTask(t.id, { needs_review: true })
    }
  }
}

export function getHealthCheckTasks(): SprintTask[] {
  return repo.getHealthCheckTasks()
}

export function getSuccessRateBySpecType(): SpecTypeSuccessRate[] {
  return repo.getSuccessRateBySpecType()
}

export function createReviewTaskFromAdhoc(input: {
  title: string
  repo: string
  spec: string
  worktreePath: string
  branch: string
}): SprintTask | null {
  const row = repo.createReviewTaskFromAdhoc(input)
  if (row) notifySprintMutation('created', row)
  return row
}

export function getDailySuccessRate(days?: number): DailySuccessRate[] {
  return repo.getDailySuccessRate(days)
}
