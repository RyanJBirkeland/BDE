/**
 * Webhook service — fires HTTP POST to configured URLs on task status changes.
 * Fire-and-forget with HMAC signing for authenticity verification.
 */
import { createHmac } from 'crypto'
import type { Logger } from '../logger'
import type { SprintTask } from '../../shared/types'

export interface WebhookConfig {
  id: string
  url: string
  events: string[] // e.g., ['task.created', 'task.completed', 'task.failed']
  secret: string | null
  enabled: boolean
}

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
 * Map sprint mutation type to webhook event name
 */
function mapEventName(mutationType: 'created' | 'updated' | 'deleted', task: SprintTask): string {
  if (mutationType === 'created') return 'task.created'
  if (mutationType === 'deleted') return 'task.deleted'

  // For updates, emit specific event based on status
  const status = task.status
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
        timestamp: new Date().toISOString(),
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
        signal: AbortSignal.timeout(10000)
      })

      if (!response.ok) {
        deps.logger.warn(
          `[webhook] Failed to deliver ${event} to ${url}: ${response.status} ${response.statusText}`
        )
      } else {
        deps.logger.info(`[webhook] Delivered ${event} to ${url}`)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      deps.logger.warn(`[webhook] Error delivering ${event} to ${url}: ${msg}`)
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
