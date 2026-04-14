import { create } from 'zustand'
import type { TaskOutputEvent } from '../../../shared/types'
import type { AgentEvent } from '../../../shared/types'
import { subscribeToAgentEvents } from '../services/agents'

/** Union of event sources used in the sprint event pipeline. */
export type AnyTaskEvent = TaskOutputEvent | AgentEvent

/** Maximum number of events to retain per agent to prevent memory leaks. */
const MAX_EVENTS_PER_AGENT = 500

let unsubscribe: (() => void) | null = null

interface SprintEventsState {
  // --- State ---
  taskEvents: Record<string, AnyTaskEvent[]>

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
    const events = state.taskEvents[taskId]
    return events && events.length > 0 ? events[events.length - 1] : undefined
  }

export const useSprintEvents = create<SprintEventsState>((set) => ({
  taskEvents: {},

  initTaskOutputListener: (): (() => void) => {
    if (unsubscribe) {
      return unsubscribe // already subscribed
    }
    unsubscribe = subscribeToAgentEvents(({ agentId, event }) => {
      set((s) => {
        const existing = s.taskEvents[agentId] ?? []
        let updated = [...existing, event]
        if (updated.length > MAX_EVENTS_PER_AGENT) {
          updated = updated.slice(updated.length - MAX_EVENTS_PER_AGENT)
        }
        return {
          taskEvents: {
            ...s.taskEvents,
            [agentId]: updated
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
      const { [taskId]: _events, ...restEvents } = s.taskEvents
      return { taskEvents: restEvents }
    })
  }
}))
