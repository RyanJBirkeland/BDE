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

/**
 * Validates a webhook URL is a public HTTP/HTTPS endpoint.
 * Rejects:
 *   - Non-http(s) schemes (ftp://, javascript://, etc.)
 *   - Loopback addresses: localhost, 127.x.x.x, ::1, 0.0.0.0
 *   - RFC 1918 private ranges: 10.x, 172.16-31.x, 192.168.x
 *   - Link-local range: 169.254.x.x (AWS/GCP metadata endpoint)
 *
 * Security: prevents SSRF — a compromised renderer could otherwise fire
 * webhooks at internal AWS metadata services, local dev servers, or
 * Kubernetes pod IPs.
 */
function validateWebhookUrl(url: string | undefined | null): void {
  if (!url) {
    throw new Error('Invalid webhook URL: URL must not be empty.')
  }

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`Invalid webhook URL: "${url}" is not a valid URL.`)
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(
      `Invalid webhook URL: scheme "${parsed.protocol}" is not allowed. Use http or https.`
    )
  }

  const hostname = parsed.hostname.toLowerCase()

  // Loopback and zero-address
  if (
    hostname === 'localhost' ||
    hostname === '0.0.0.0' ||
    hostname === '::1' ||
    hostname === '[::1]'
  ) {
    throw new Error(`Invalid webhook URL: loopback host "${hostname}" is not allowed.`)
  }

  // IPv4 ranges — only check if it looks like an IPv4 address
  const ipv4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (ipv4) {
    const [, a, b] = ipv4.map(Number)
    // 127.x.x.x — loopback
    if (a === 127) {
      throw new Error(`Invalid webhook URL: loopback address "${hostname}" is not allowed.`)
    }
    // 10.x.x.x — RFC 1918
    if (a === 10) {
      throw new Error(`Invalid webhook URL: private address "${hostname}" is not allowed.`)
    }
    // 172.16.0.0 – 172.31.255.255 — RFC 1918
    if (a === 172 && b >= 16 && b <= 31) {
      throw new Error(`Invalid webhook URL: private address "${hostname}" is not allowed.`)
    }
    // 192.168.x.x — RFC 1918
    if (a === 192 && b === 168) {
      throw new Error(`Invalid webhook URL: private address "${hostname}" is not allowed.`)
    }
    // 169.254.x.x — link-local (AWS/GCP metadata)
    if (a === 169 && b === 254) {
      throw new Error(`Invalid webhook URL: link-local address "${hostname}" is not allowed.`)
    }
  }
}

export function registerWebhookHandlers(): void {
  safeHandle('webhook:list', async (_e) => {
    return listWebhooks()
  })

  safeHandle('webhook:create', async (_e, payload: { url: string; events: string[]; secret?: string }) => {
    validateWebhookUrl(payload.url)
    const webhook = createWebhook(payload)
    logger.info(`Created webhook ${webhook.id} for ${payload.url}`)
    return webhook
  })

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
      if (payload.url !== undefined) {
        validateWebhookUrl(payload.url)
      }
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
