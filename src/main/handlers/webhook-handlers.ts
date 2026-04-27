/**
 * Webhook management IPC handlers
 */
import { isIPv4, isIPv6 } from 'node:net'
import { safeHandle } from '../ipc-utils'
import { createLogger } from '../logger'
import {
  listWebhooks,
  createWebhook,
  updateWebhook,
  deleteWebhook,
  getWebhookById
} from '../data/webhook-queries'
import { deliverWebhookTestEvent } from '../services/webhook-delivery-service'

const logger = createLogger('webhook-handlers')

function safeWebhookLogTarget(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.origin}${parsed.pathname}`
  } catch {
    return '(invalid URL)'
  }
}

/**
 * Validates a webhook URL is a public HTTP/HTTPS endpoint.
 * Rejects:
 *   - Non-http(s) schemes (ftp://, javascript://, etc.)
 *   - Loopback addresses: localhost, 127.x.x.x, ::1, 0.0.0.0
 *   - RFC 1918 private ranges: 10.x, 172.16-31.x, 192.168.x
 *   - Link-local range: 169.254.x.x (AWS/GCP metadata endpoint)
 *   - IPv6 loopback (::1, ::ffff: mapped, fc/fd ULA, fe80 link-local)
 *
 * Security: prevents SSRF — a compromised renderer could otherwise fire
 * webhooks at internal AWS metadata services, local dev servers, or
 * Kubernetes pod IPs. Uses `net.isIPv4`/`net.isIPv6` to avoid the octal-
 * and decimal-notation bypass vectors that regex-based checks are prone to.
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

  // Explicit string checks for symbolic loopback names (not matched by isIPv4/isIPv6)
  if (hostname === 'localhost' || hostname === '0.0.0.0') {
    throw new Error(`Invalid webhook URL: loopback host "${hostname}" is not allowed.`)
  }

  if (isIPv4(hostname)) {
    rejectPrivateIPv4(hostname)
    return
  }

  if (isIPv6(hostname) || hostname.startsWith('[')) {
    rejectPrivateIPv6(hostname)
  }
}

function rejectPrivateIPv4(hostname: string): void {
  const octets = hostname.split('.').map((octet) => parseInt(octet, 10))
  const [a = 0, b = 0] = octets

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

function rejectPrivateIPv6(hostname: string): void {
  // Strip surrounding brackets if present (e.g. "[::1]" from URL.hostname)
  const addr = hostname.startsWith('[') ? hostname.slice(1, hostname.lastIndexOf(']')) : hostname
  const lower = addr.toLowerCase()

  // Loopback: ::1 and its spelled-out equivalents
  if (lower === '::1' || lower === '0:0:0:0:0:0:0:1') {
    throw new Error(`Invalid webhook URL: IPv6 loopback "${hostname}" is not allowed.`)
  }
  // IPv4-mapped loopback: ::ffff:127.x.x.x (and general ::ffff: range for safety)
  if (lower.startsWith('::ffff:')) {
    throw new Error(`Invalid webhook URL: IPv4-mapped IPv6 address "${hostname}" is not allowed.`)
  }
  // ULA (RFC 4193): fc00::/7 — addresses starting with fc or fd
  if (lower.startsWith('fc') || lower.startsWith('fd')) {
    throw new Error(`Invalid webhook URL: private IPv6 address "${hostname}" is not allowed.`)
  }
  // Link-local (RFC 4291): fe80::/10
  if (lower.startsWith('fe80')) {
    throw new Error(`Invalid webhook URL: link-local IPv6 address "${hostname}" is not allowed.`)
  }
}

export function registerWebhookHandlers(): void {
  safeHandle('webhook:list', async (_e) => {
    return listWebhooks()
  })

  type CreateWebhookInput = { url: string; events: string[]; secret?: string | undefined }
  safeHandle('webhook:create', async (_e, payload: CreateWebhookInput) => {
    validateWebhookUrl(payload.url)
    const webhook = createWebhook(payload)
    logger.info(`Created webhook ${webhook.id} for ${safeWebhookLogTarget(payload.url)}`)
    return webhook
  })

  type UpdateWebhookInput = {
    id: string
    url?: string | undefined
    events?: string[] | undefined
    secret?: string | undefined | null
    enabled?: boolean | undefined
  }
  safeHandle('webhook:update', async (_e, payload: UpdateWebhookInput) => {
    if (payload.url !== undefined) {
      validateWebhookUrl(payload.url)
    }
    const webhook = updateWebhook(payload)
    logger.info(`Updated webhook ${payload.id}`)
    return webhook
  })

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
    return deliverWebhookTestEvent(webhook)
  })
}
