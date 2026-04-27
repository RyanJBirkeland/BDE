/**
 * Webhook delivery service — constructs and delivers test webhook events.
 *
 * Handles test event payload construction, HMAC-SHA256 signature computation,
 * and HTTP POST delivery for the webhook:test IPC channel.
 */
import { createLogger } from '../logger'
import { getErrorMessage } from '../../shared/errors'
import { nowIso } from '../../shared/time'
import type { WebhookConfig } from './webhook-service'

const log = createLogger('webhook-delivery-service')

const WEBHOOK_TEST_TIMEOUT_MS = 10000

function safeWebhookLogTarget(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.origin}${parsed.pathname}`
  } catch {
    return '(invalid URL)'
  }
}

export interface WebhookTestResult {
  success: boolean
  status: number
}

/**
 * Sign the request body with HMAC-SHA256 using the webhook secret.
 */
async function computeSignature(body: string, secret: string): Promise<string> {
  const cryptoModule = await import('crypto')
  return cryptoModule.createHmac('sha256', secret).update(body).digest('hex')
}

/**
 * Build the HTTP headers for a test webhook delivery.
 * Includes signature header only when the webhook has a secret configured.
 */
async function buildDeliveryHeaders(
  body: string,
  secret: string | null
): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-BDE-Event': 'webhook.test',
    'X-BDE-Delivery': crypto.randomUUID()
  }

  if (secret) {
    headers['X-BDE-Signature'] = await computeSignature(body, secret)
  }

  return headers
}

/**
 * Deliver a test event to the given webhook endpoint.
 * Throws on delivery failure so the handler can surface the error to the UI.
 */
export async function deliverWebhookTestEvent(
  webhook: WebhookConfig,
  _eventType: string = 'webhook.test'
): Promise<WebhookTestResult> {
  const testPayload = {
    event: 'webhook.test',
    timestamp: nowIso(),
    task: null
  }

  const body = JSON.stringify(testPayload)
  const headers = await buildDeliveryHeaders(body, webhook.secret)

  try {
    const response = await fetch(webhook.url, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(WEBHOOK_TEST_TIMEOUT_MS)
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    log.info(`Test webhook sent to ${safeWebhookLogTarget(webhook.url)}`)
    return { success: true, status: response.status }
  } catch (err) {
    const msg = getErrorMessage(err)
    log.warn(`Test webhook failed for ${safeWebhookLogTarget(webhook.url)}: ${msg}`)
    throw new Error(`Test failed: ${msg}`)
  }
}
