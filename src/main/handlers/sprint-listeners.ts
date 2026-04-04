/**
 * Sprint mutation observer — pub/sub for task CRUD events.
 * Extracted from sprint-local.ts to decouple SSE broadcasting
 * and event-store cleanup from handler registration.
 */
import type { SprintTask } from '../../shared/types'
import { BrowserWindow } from 'electron'
import { createLogger } from '../logger'
import {
  createWebhookService,
  getWebhookEventName,
  type WebhookConfig
} from '../services/webhook-service'
import { getDb } from '../db'

const logger = createLogger('sprint-listeners')

export type SprintMutationEvent = {
  type: 'created' | 'updated' | 'deleted'
  task: SprintTask
}
export type SprintMutationListener = (event: SprintMutationEvent) => void

const listeners: Set<SprintMutationListener> = new Set()

// Initialize webhook service
function getWebhooks(): WebhookConfig[] {
  const db = getDb()
  const rows = db.prepare('SELECT * FROM webhooks').all() as Array<{
    id: string
    url: string
    events: string
    secret: string | null
    enabled: number
  }>

  return rows.map((row) => ({
    id: row.id,
    url: row.url,
    events: JSON.parse(row.events) as string[],
    secret: row.secret,
    enabled: row.enabled === 1
  }))
}

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
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('sprint:externalChange')
  }

  // Fire webhooks for external integrations
  try {
    const webhookEvent = getWebhookEventName(type, task)
    webhookService.fireWebhook(webhookEvent, task)
  } catch (err) {
    logger.error(`[webhook] ${err}`)
  }
}
