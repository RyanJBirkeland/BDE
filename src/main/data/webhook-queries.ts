/**
 * Webhook query functions — all webhook CRUD operations.
 * Extracted from webhook-handlers.ts to separate data access from IPC handling.
 */
import type Database from 'better-sqlite3'
import { getDb } from '../db'
import { createLogger } from '../logger'
import { encryptSetting, decryptSetting, isEncryptionAvailable } from '../secure-storage'
import type { WebhookConfig } from '../services/webhook-service'

const log = createLogger('webhook-queries')

/**
 * Encrypts the HMAC secret at rest when platform encryption is available.
 * Falls through to plaintext if safeStorage is unavailable (keychain locked,
 * or a rare dev environment) — an explicit warning fires so an operator can
 * tell the difference. Reads use `decryptSetting`, which transparently
 * handles both ENC: and plaintext forms so legacy rows keep working.
 */
function encryptWebhookSecret(secret: string | null | undefined): string | null {
  if (secret == null) return null
  try {
    if (!isEncryptionAvailable()) {
      log.warn('Storing webhook secret in cleartext: safeStorage is unavailable on this host')
      return secret
    }
    return encryptSetting(secret)
  } catch (err) {
    log.warn(
      `safeStorage.encrypt failed; falling back to cleartext: ${err instanceof Error ? err.message : String(err)}`
    )
    return secret
  }
}

function decryptWebhookSecret(stored: string | null): string | null {
  if (stored == null) return null
  return decryptSetting(stored)
}

/**
 * Parse and validate the `events` column from a webhook row. The column is
 * nominally a JSON-encoded `string[]`, but corrupted rows (non-array JSON,
 * mixed element types, malformed JSON, null) must not propagate to callers.
 *
 * Any recoverable anomaly is logged at `warn` and coerced to `[]` or a filtered
 * array of strings. The function never throws.
 */
export function parseWebhookEvents(raw: unknown): string[] {
  if (raw == null) return []

  if (typeof raw === 'string') {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.warn(`Malformed events JSON; coercing to []: ${message}`)
      return []
    }
    return parseWebhookEvents(parsed)
  }

  if (Array.isArray(raw)) {
    const stringEntries = raw.filter((entry): entry is string => typeof entry === 'string')
    if (stringEntries.length !== raw.length) {
      log.warn(
        `Dropped ${raw.length - stringEntries.length} non-string events entry(ies) from webhook row`
      )
    }
    return stringEntries
  }

  log.warn(`Unexpected events type "${typeof raw}"; coercing to []`)
  return []
}

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
    events: parseWebhookEvents(row.events),
    secret: decryptWebhookSecret(row.secret),
    enabled: row.enabled === 1
  }
}

export function listWebhooks(db?: Database.Database): Webhook[] {
  const conn = db ?? getDb()
  const rows = conn.prepare('SELECT * FROM webhooks ORDER BY created_at DESC').all() as WebhookRow[]
  return rows.map(rowToWebhook)
}

export function createWebhook(
  payload: {
    url: string
    events: string[]
    secret?: string | undefined
  },
  db?: Database.Database
): Webhook {
  if (!payload.url) throw new Error('URL is required')
  if (!payload.url.startsWith('http://') && !payload.url.startsWith('https://')) {
    throw new Error('URL must start with http:// or https://')
  }

  const conn = db ?? getDb()
  const stmt = conn.prepare(`
    INSERT INTO webhooks (url, events, secret, enabled)
    VALUES (?, ?, ?, 1)
    RETURNING *
  `)
  const row = stmt.get(
    payload.url,
    JSON.stringify(payload.events || []),
    encryptWebhookSecret(payload.secret || null)
  ) as WebhookRow

  return rowToWebhook(row)
}

export function updateWebhook(
  payload: {
    id: string
    url?: string | undefined
    events?: string[] | undefined
    secret?: string | null | undefined
    enabled?: boolean | undefined
  },
  db?: Database.Database
): Webhook {
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
    params.push(encryptWebhookSecret(payload.secret))
  }

  if (payload.enabled !== undefined) {
    updates.push('enabled = ?')
    params.push(payload.enabled ? 1 : 0)
  }

  if (updates.length === 0) {
    throw new Error('No fields to update')
  }

  params.push(payload.id)

  const conn = db ?? getDb()
  const stmt = conn.prepare(`
    UPDATE webhooks
    SET ${updates.join(', ')}
    WHERE id = ?
    RETURNING *
  `)
  const row = stmt.get(...params) as WebhookRow | undefined

  if (!row) {
    throw new Error(`Webhook ${payload.id} not found`)
  }

  return rowToWebhook(row)
}

export function deleteWebhook(id: string, db?: Database.Database): { success: boolean } {
  if (!id) throw new Error('Webhook ID is required')

  const conn = db ?? getDb()
  const stmt = conn.prepare('DELETE FROM webhooks WHERE id = ?')
  const result = stmt.run(id)

  if (result.changes === 0) {
    throw new Error(`Webhook ${id} not found`)
  }

  return { success: true }
}

export function getWebhookById(id: string, db?: Database.Database): Webhook | null {
  if (!id) throw new Error('Webhook ID is required')

  const conn = db ?? getDb()
  const row = conn.prepare('SELECT * FROM webhooks WHERE id = ?').get(id) as WebhookRow | undefined

  return row ? rowToWebhook(row) : null
}

/**
 * Get all webhooks as WebhookConfig for webhook service.
 * Used by sprint-listeners.ts.
 */
export function getWebhooks(db?: Database.Database): WebhookConfig[] {
  const conn = db ?? getDb()
  const rows = conn.prepare('SELECT * FROM webhooks').all() as Array<{
    id: string
    url: string
    events: string
    secret: string | null
    enabled: number
  }>

  return rows.map((row) => ({
    id: row.id,
    url: row.url,
    events: parseWebhookEvents(row.events),
    secret: decryptWebhookSecret(row.secret),
    enabled: row.enabled === 1
  }))
}
