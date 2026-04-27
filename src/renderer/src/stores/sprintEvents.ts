import { create } from 'zustand'
import type { TaskOutputEvent } from '../../../shared/types'
import type { AgentEvent } from '../../../shared/types'
import { subscribeToAgentEvents } from '../services/agents'
import { createRingBuffer, pushToRingBuffer, readRingBuffer, type RingBuffer } from '../lib/ringBuffer'

/** Union of event sources used in the sprint event pipeline. */
export type AnyTaskEvent = TaskOutputEvent | AgentEvent

/** Maximum number of events to retain per agent to prevent memory leaks. */
export const MAX_EVENTS_PER_AGENT = 500

let unsubscribe: (() => void) | null = null

interface SprintEventsState {
  // --- State ---
  taskEvents: Record<string, RingBuffer<AnyTaskEvent>>

  // --- Actions ---
  initTaskOutputListener: () => () => void
  destroy: () => void
  clearTaskEvents: (taskId: string) => void
}

/**
 * Selector — returns the most recent event for a given agent without
 * storing redundant state. Zustand memoizes selector results automatically.
 *
 * Usage: `const latest = useSprintEvents(selectLatestEvent(taskId))`
 */
export const selectLatestEvent =
  (taskId: string) =>
  (state: SprintEventsState): AnyTaskEvent | undefined => {
    const buf = state.taskEvents[taskId]
    if (!buf || buf.count === 0) return undefined
    // The most recent item sits just before `head` in the circular slot order.
    const lastSlot = (buf.head - 1 + buf.size) % buf.size
    return buf.items[lastSlot]
  }

export const useSprintEvents = create<SprintEventsState>((set) => ({
  taskEvents: {},

  initTaskOutputListener: (): (() => void) => {
    if (unsubscribe) {
      return unsubscribe // already subscribed
    }
    unsubscribe = subscribeToAgentEvents(({ agentId, event }) => {
      set((s) => {
        const existing = s.taskEvents[agentId] ?? createRingBuffer<AnyTaskEvent>(MAX_EVENTS_PER_AGENT)
        pushToRingBuffer(existing, event)
        return {
          taskEvents: {
            ...s.taskEvents,
            [agentId]: existing
          }
        }
      })
    })

    return unsubscribe ?? (() => {})
  },

  destroy: () => {
    unsubscribe?.()
    unsubscribe = null
  },

  clearTaskEvents: (taskId): void => {
    set((s) => {
      const { [taskId]: _buf, ...restEvents } = s.taskEvents
      return { taskEvents: restEvents }
    })
  }
}))

/**
 * Returns all events for an agent in insertion order (oldest first).
 * Use this when you need to render the full event history.
 */
export function readAgentEvents(state: SprintEventsState, agentId: string): AnyTaskEvent[] {
  const buf = state.taskEvents[agentId]
  return buf ? readRingBuffer(buf) : []
}
