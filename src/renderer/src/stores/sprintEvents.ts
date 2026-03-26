import { create } from 'zustand'
import type { TaskOutputEvent } from '../../../shared/queue-api-contract'
import type { AgentEvent } from '../../../shared/types'

/** Union of event sources used in the sprint event pipeline. */
export type AnyTaskEvent = TaskOutputEvent | AgentEvent

/** Maximum number of events to retain per agent to prevent memory leaks. */
const MAX_EVENTS_PER_AGENT = 500

interface SprintEventsState {
  // --- State ---
  taskEvents: Record<string, AnyTaskEvent[]>
  latestEvents: Record<string, AnyTaskEvent>

  // --- Actions ---
  initTaskOutputListener: () => () => void
  clearTaskEvents: (taskId: string) => void
}

export const useSprintEvents = create<SprintEventsState>((set) => ({
  taskEvents: {},
  latestEvents: {},

  initTaskOutputListener: (): (() => void) => {
    const cleanup = window.api.agentEvents?.onEvent(({ agentId, event }) => {
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
          },
          latestEvents: {
            ...s.latestEvents,
            [agentId]: event
          }
        }
      })
    })

    return () => {
      cleanup?.()
    }
  },

  clearTaskEvents: (taskId): void => {
    set((s) => {
      const { [taskId]: _events, ...restEvents } = s.taskEvents
      const { [taskId]: _latest, ...restLatest } = s.latestEvents
      return { taskEvents: restEvents, latestEvents: restLatest }
    })
  }
}))
