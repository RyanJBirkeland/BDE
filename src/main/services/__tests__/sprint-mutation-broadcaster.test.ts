/**
 * Tests for sprint-mutation-broadcaster callback decoupling (T-41).
 *
 * Verifies that:
 * - notifySprintMutation calls _onBroadcast when registered
 * - notifySprintMutation does not throw when no broadcast callback is registered
 * - notifySprintMutation calls _onWebhook when registered
 * - in-process listeners still fire when neither callback is registered
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Reset module state between tests so registrations don't bleed across tests.
vi.mock('../logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })
}))

vi.mock('../webhook-service', () => ({
  getWebhookEventName: vi.fn((_type: string, _task: unknown) => 'task.updated')
}))

import {
  notifySprintMutation,
  onSprintMutation,
  registerBroadcastCallback,
  registerWebhookCallback
} from '../sprint-mutation-broadcaster'
import type { SprintTask } from '../../../shared/types'

const TASK = { id: 'task-1', title: 'Test', status: 'active', repo: 'fleet' } as SprintTask

describe('sprint-mutation-broadcaster', () => {
  beforeEach(() => {
    // Reset all registered callbacks before each test
    registerBroadcastCallback(() => {})
    registerWebhookCallback(() => {})
    // Clear them by registering no-ops so state is predictable
  })

  describe('in-process listeners', () => {
    it('fires registered listeners with the mutation event', () => {
      const listener = vi.fn()
      const unsubscribe = onSprintMutation(listener)
      notifySprintMutation('updated', TASK)
      expect(listener).toHaveBeenCalledWith({ type: 'updated', task: TASK })
      unsubscribe()
    })

    it('fires listeners when no callbacks are registered', () => {
      // Register null-safe no-ops so the module does not crash
      registerBroadcastCallback(null as unknown as () => void)
      registerWebhookCallback(null as unknown as (e: string, t: SprintTask) => void)

      const listener = vi.fn()
      const unsubscribe = onSprintMutation(listener)
      expect(() => notifySprintMutation('created', TASK)).not.toThrow()
      expect(listener).toHaveBeenCalled()
      unsubscribe()
    })

    it('unsubscribe removes the listener', () => {
      const listener = vi.fn()
      const unsubscribe = onSprintMutation(listener)
      unsubscribe()
      notifySprintMutation('updated', TASK)
      expect(listener).not.toHaveBeenCalled()
    })
  })

  describe('registerBroadcastCallback', () => {
    it('schedules the broadcast callback after a mutation', async () => {
      const broadcastCb = vi.fn()
      registerBroadcastCallback(broadcastCb)
      notifySprintMutation('updated', TASK)
      // The broadcast is scheduled via setTimeout(200ms) — wait for it
      await new Promise((r) => setTimeout(r, 250))
      expect(broadcastCb).toHaveBeenCalled()
    })

    it('does not throw when broadcast callback is null', () => {
      registerBroadcastCallback(null as unknown as () => void)
      expect(() => notifySprintMutation('updated', TASK)).not.toThrow()
    })
  })

  describe('registerWebhookCallback', () => {
    it('calls the webhook callback with the event name and task', () => {
      const webhookCb = vi.fn()
      registerWebhookCallback(webhookCb)
      notifySprintMutation('updated', TASK)
      expect(webhookCb).toHaveBeenCalledWith('task.updated', TASK)
    })

    it('does not throw when webhook callback is null', () => {
      registerWebhookCallback(null as unknown as (e: string, t: SprintTask) => void)
      expect(() => notifySprintMutation('updated', TASK)).not.toThrow()
    })
  })
})
