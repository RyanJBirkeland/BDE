/**
 * Webhook management IPC handlers
 */
import { safeHandle } from '../ipc-utils'
import { createLogger } from '../logger'
import { getErrorMessage } from '../../shared/errors'
import { nowIso } from '../../shared/time'
import {
  listWebhooks,
  createWebhook,
  updateWebhook,
  deleteWebhook,
  getWebhookById
} from '../data/webhook-queries'

const logger = createLogger('webhook-handlers')

export function registerWebhookHandlers(): void {
  safeHandle('webhook:list', async (_e) => {
    return listWebhooks()
  })

  safeHandle('webhook:create', async (_e, payload: { url: string; events: string[]; secret?: string }) => {
      const webhook = createWebhook(payload)
      logger.info(`Created webhook ${webhook.id} for ${payload.url}`)
      return webhook
    }
  )

  safeHandle('webhook:update', async (
      _e,
      payload: {
        id: string
        url?: string
        events?: string[]
        secret?: string | null
        enabled?: boolean
      }
    ) => {
      const webhook = updateWebhook(payload)
      logger.info(`Updated webhook ${payload.id}`)
      return webhook
    }
  )

  safeHandle('webhook:delete', async (_e, payload: { id: string }) => {
    const result = deleteWebhook(payload.id)
    logger.info(`Deleted webhook ${payload.id}`)
    return result
  })

  safeHandle('webhook:test', async (_e, payload: { id: string }) => {
    const webhook = getWebhookById(payload.id)

    if (!webhook) {
      throw new Error(`Webhook ${payload.id} not found`)
    }

    // Fire a test event
    const testPayload = {
      event: 'webhook.test',
      timestamp: nowIso(),
      task: null
    }

    try {
      const body = JSON.stringify(testPayload)
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-BDE-Event': 'webhook.test',
        'X-BDE-Delivery': crypto.randomUUID()
      }

      if (webhook.secret) {
        const crypto = await import('crypto')
        const signature = crypto.createHmac('sha256', webhook.secret).update(body).digest('hex')
        headers['X-BDE-Signature'] = signature
      }

      const response = await fetch(webhook.url, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(10000)
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      logger.info(`Test webhook sent to ${webhook.url}`)
      return { success: true, status: response.status }
    } catch (err) {
      const msg = getErrorMessage(err)
      logger.warn(`Test webhook failed for ${webhook.url}: ${msg}`)
      throw new Error(`Test failed: ${msg}`)
    }
  })
}
