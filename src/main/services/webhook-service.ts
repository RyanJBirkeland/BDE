/**
 * Webhook service — fires HTTP POST to configured URLs on task status changes.
 * Fire-and-forget with HMAC signing for authenticity verification.
 */
import { createHmac } from 'crypto'
import type { Logger } from '../logger'
import type { SprintTask } from '../../shared/types'
import type { WebhookConfig } from '../../shared/types/webhook'
import { getErrorMessage } from '../../shared/errors'
import { nowIso } from '../../shared/time'
import { WEBHOOK_TIMEOUT_MS } from '../constants'
import type { TaskStatus } from '../../shared/task-state-machine'

export type { WebhookConfig } from '../../shared/types/webhook'

export interface WebhookPayload {
  event: string
  timestamp: string
  task: SprintTask
}

export interface WebhookServiceDeps {
  getWebhooks: () => WebhookConfig[]
  logger: Logger
  // Injected for testing — defaults to global fetch
  fetchFn?: typeof fetch
}

export interface WebhookService {
  fireWebhook: (event: string, task: SprintTask) => void
}

/**
 * Create HMAC-SHA256 signature for webhook payload
 */
function signPayload(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex')
}

/**
 * Map sprint mutation type to webhook event name.
 * Note: Event names are webhook API-specific (e.g., 'task.completed', 'task.failed')
 * and intentionally differ from STATUS_METADATA labels. These names form the public
 * webhook API contract and cannot be changed without breaking existing integrations.
 */
function mapEventName(mutationType: 'created' | 'updated' | 'deleted', task: SprintTask): string {
  if (mutationType === 'created') return 'task.created'
  if (mutationType === 'deleted') return 'task.deleted'

  // For updates, emit specific event based on status
  const status = task.status as TaskStatus
  if (status === 'done') return 'task.completed'
  if (status === 'failed' || status === 'error') return 'task.failed'
  if (status === 'active') return 'task.started'
  if (status === 'review') return 'task.review'

  return 'task.updated'
}

/**
 * Check if webhook should fire for given event
 */
function shouldFireForEvent(webhookEvents: string[], event: string): boolean {
  // If webhook events list is empty, fire for all events
  if (webhookEvents.length === 0) return true

  // Check for exact match or wildcard
  return webhookEvents.includes(event) || webhookEvents.includes('*')
}

function safeWebhookLogTarget(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.origin}${parsed.pathname}`
  } catch {
    return '(invalid URL)'
  }
}

export function createWebhookService(deps: WebhookServiceDeps): WebhookService {
  const fetchFn = deps.fetchFn ?? fetch

  async function fireWebhookAsync(
    url: string,
    event: string,
    task: SprintTask,
    secret: string | null
  ): Promise<void> {
    try {
      const payload: WebhookPayload = {
        event,
        timestamp: nowIso(),
        task
      }

      const body = JSON.stringify(payload)
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-BDE-Event': event,
        'X-BDE-Delivery': crypto.randomUUID()
      }

      if (secret) {
        headers['X-BDE-Signature'] = signPayload(body, secret)
      }

      const response = await fetchFn(url, {
        method: 'POST',
        headers,
        body,
        // 10s timeout
        signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS)
      })

      if (!response.ok) {
        deps.logger.warn(
          `[webhook] Failed to deliver ${event} to ${safeWebhookLogTarget(url)}: ${response.status} ${response.statusText}`
        )
      } else {
        deps.logger.info(`[webhook] Delivered ${event} to ${safeWebhookLogTarget(url)}`)
      }
    } catch (err) {
      const msg = getErrorMessage(err)
      deps.logger.warn(`[webhook] Error delivering ${event} to ${safeWebhookLogTarget(url)}: ${msg}`)
    }
  }

  function fireWebhook(event: string, task: SprintTask): void {
    const webhooks = deps.getWebhooks()

    for (const webhook of webhooks) {
      if (!webhook.enabled) continue
      if (!shouldFireForEvent(webhook.events, event)) continue

      // Fire-and-forget — don't await
      void fireWebhookAsync(webhook.url, event, task, webhook.secret)
    }
  }

  return { fireWebhook }
}

/**
 * Helper to get event name from mutation type and task
 */
export function getWebhookEventName(
  mutationType: 'created' | 'updated' | 'deleted',
  task: SprintTask
): string {
  return mapEventName(mutationType, task)
}
