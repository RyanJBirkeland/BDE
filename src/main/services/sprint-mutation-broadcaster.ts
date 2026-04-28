/**
 * Sprint mutation broadcaster — notification orchestration for sprint task mutations.
 *
 * Handles:
 * - In-process mutation listeners (e.g., dependency resolution)
 * - IPC broadcast to renderer windows (sprint:externalChange)
 * - Webhook dispatch for external integrations
 *
 * Does NOT perform data mutations — see sprint-mutations.ts for that.
 * Does NOT import framework (IPC) or integration (webhook) modules directly —
 * callers register callbacks at startup via registerBroadcastCallback and
 * registerWebhookCallback so service code never depends on transport layers.
 *
 * Usage pattern:
 *   const task = sprintMutations.createTask(input)
 *   if (task) sprintBroadcaster.notifySprintMutation('created', task)
 */
import type { SprintTask } from '../../shared/types'
import { createLogger } from '../logger'
import { getWebhookEventName } from './webhook-service'

const logger = createLogger('sprint-broadcaster')

export type SprintMutationEvent = {
  type: 'created' | 'updated' | 'deleted'
  task: SprintTask
}

export type SprintMutationListener = (event: SprintMutationEvent) => void

const listeners: Set<SprintMutationListener> = new Set()

let _broadcastFn: (() => void) | null = null
let _onBroadcast: (() => void) | null = null
let _onWebhook: ((event: string, task: SprintTask) => void) | null = null
let externalChangeTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Inject the IPC broadcast function used to notify renderer windows.
 * Called once at startup by the composition root before any mutations fire.
 * Matches the established pattern of setSprintQueriesLogger.
 */
export function setSprintBroadcaster(fn: () => void): void {
  _broadcastFn = fn
}

/**
 * Register the callback that fires the IPC external-change broadcast.
 * Called once at startup by the composition root after the IPC adapter is ready.
 * Decouples this module from importing broadcast() (an Electron framework concern).
 */
export function registerBroadcastCallback(fn: () => void): void {
  _onBroadcast = fn
}

/**
 * Register the callback that fires webhooks for external integrations.
 * Called once at startup by the composition root after webhookService is created.
 * Decouples this module from the webhookService singleton.
 */
export function registerWebhookCallback(fn: (event: string, task: SprintTask) => void): void {
  _onWebhook = fn
}

function scheduleExternalChangeBroadcast(): void {
  if (externalChangeTimer !== null) clearTimeout(externalChangeTimer)
  externalChangeTimer = setTimeout(() => {
    externalChangeTimer = null
    _broadcastFn?.()
    _onBroadcast?.()
  }, 200)
}

/**
 * Register a listener for sprint task mutations.
 * Returns an unsubscribe function.
 */
export function onSprintMutation(cb: SprintMutationListener): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

/**
 * Notify all registered listeners of a sprint task mutation.
 * Also schedules a broadcast to renderer windows and fires webhooks via callbacks.
 */
export function notifySprintMutation(type: SprintMutationEvent['type'], task: SprintTask): void {
  const event = { type, task }
  for (const cb of listeners) {
    try {
      cb(event)
    } catch (err) {
      logger.error(`${err}`)
    }
  }

  // Push to renderer windows so Dashboard/SprintCenter refresh — debounced to
  // collapse rapid bursts (e.g. batch creates/updates) into a single round-trip
  scheduleExternalChangeBroadcast()

  // Fire webhooks for external integrations via registered callback
  if (_onWebhook) {
    try {
      const webhookEvent = getWebhookEventName(type, task)
      _onWebhook(webhookEvent, task)
    } catch (err) {
      logger.error(`[webhook] ${err}`)
    }
  }
}
