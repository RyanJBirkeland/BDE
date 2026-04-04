/**
 * Webhook management IPC handlers
 */
import { safeHandle } from '../ipc-utils'
import { getDb } from '../db'
import { createLogger } from '../logger'

const logger = createLogger('webhook-handlers')

export interface WebhookRow {
  id: string
  url: string
  events: string
  secret: string | null
  enabled: number
  created_at: string
  updated_at: string
}

export interface Webhook {
  id: string
  url: string
  events: string[]
  secret: string | null
  enabled: boolean
  created_at: string
  updated_at: string
}

function rowToWebhook(row: WebhookRow): Webhook {
  return {
    ...row,
    events: JSON.parse(row.events) as string[],
    enabled: row.enabled === 1
  }
}

export function registerWebhookHandlers(): void {
  safeHandle('webhook:list', async (_e) => {
    const db = getDb()
    const rows = db.prepare('SELECT * FROM webhooks ORDER BY created_at DESC').all() as WebhookRow[]
    return rows.map(rowToWebhook)
  })

  safeHandle(
    'webhook:create',
    async (_e, payload: { url: string; events: string[]; secret?: string }) => {
      if (!payload.url) throw new Error('URL is required')
      if (!payload.url.startsWith('http://') && !payload.url.startsWith('https://')) {
        throw new Error('URL must start with http:// or https://')
      }

      const db = getDb()
      const stmt = db.prepare(`
      INSERT INTO webhooks (url, events, secret, enabled)
      VALUES (?, ?, ?, 1)
      RETURNING *
    `)
      const row = stmt.get(
        payload.url,
        JSON.stringify(payload.events || []),
        payload.secret || null
      ) as WebhookRow

      logger.info(`Created webhook ${row.id} for ${payload.url}`)
      return rowToWebhook(row)
    }
  )

  safeHandle(
    'webhook:update',
    async (
      _e,
      payload: {
        id: string
        url?: string
        events?: string[]
        secret?: string | null
        enabled?: boolean
      }
    ) => {
      if (!payload.id) throw new Error('Webhook ID is required')

      const updates: string[] = []
      const params: unknown[] = []

      if (payload.url !== undefined) {
        if (!payload.url.startsWith('http://') && !payload.url.startsWith('https://')) {
          throw new Error('URL must start with http:// or https://')
        }
        updates.push('url = ?')
        params.push(payload.url)
      }

      if (payload.events !== undefined) {
        updates.push('events = ?')
        params.push(JSON.stringify(payload.events))
      }

      if (payload.secret !== undefined) {
        updates.push('secret = ?')
        params.push(payload.secret)
      }

      if (payload.enabled !== undefined) {
        updates.push('enabled = ?')
        params.push(payload.enabled ? 1 : 0)
      }

      if (updates.length === 0) {
        throw new Error('No fields to update')
      }

      params.push(payload.id)

      const db = getDb()
      const stmt = db.prepare(`
      UPDATE webhooks
      SET ${updates.join(', ')}
      WHERE id = ?
      RETURNING *
    `)
      const row = stmt.get(...params) as WebhookRow | undefined

      if (!row) {
        throw new Error(`Webhook ${payload.id} not found`)
      }

      logger.info(`Updated webhook ${payload.id}`)
      return rowToWebhook(row)
    }
  )

  safeHandle('webhook:delete', async (_e, payload: { id: string }) => {
    if (!payload.id) throw new Error('Webhook ID is required')

    const db = getDb()
    const stmt = db.prepare('DELETE FROM webhooks WHERE id = ?')
    const result = stmt.run(payload.id)

    if (result.changes === 0) {
      throw new Error(`Webhook ${payload.id} not found`)
    }

    logger.info(`Deleted webhook ${payload.id}`)
    return { success: true }
  })

  safeHandle('webhook:test', async (_e, payload: { id: string }) => {
    if (!payload.id) throw new Error('Webhook ID is required')

    const db = getDb()
    const row = db.prepare('SELECT * FROM webhooks WHERE id = ?').get(payload.id) as
      | WebhookRow
      | undefined

    if (!row) {
      throw new Error(`Webhook ${payload.id} not found`)
    }

    // Fire a test event
    const testPayload = {
      event: 'webhook.test',
      timestamp: new Date().toISOString(),
      task: null
    }

    try {
      const body = JSON.stringify(testPayload)
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-BDE-Event': 'webhook.test',
        'X-BDE-Delivery': crypto.randomUUID()
      }

      if (row.secret) {
        const crypto = await import('crypto')
        const signature = crypto.createHmac('sha256', row.secret).update(body).digest('hex')
        headers['X-BDE-Signature'] = signature
      }

      const response = await fetch(row.url, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(10000)
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      logger.info(`Test webhook sent to ${row.url}`)
      return { success: true, status: response.status }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.warn(`Test webhook failed for ${row.url}: ${msg}`)
      throw new Error(`Test failed: ${msg}`)
    }
  })
}
