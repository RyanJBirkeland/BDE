import { create } from 'zustand'
import type { TaskOutputEvent } from '../../../shared/queue-api-contract'
import type { AgentEvent } from '../../../main/agents/types'

/** Union of event sources used in the sprint event pipeline. */
export type AnyTaskEvent = TaskOutputEvent | AgentEvent

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
      set((s) => ({
        taskEvents: {
          ...s.taskEvents,
          [agentId]: [...(s.taskEvents[agentId] ?? []), event],
        },
        latestEvents: {
          ...s.latestEvents,
          [agentId]: event,
        },
      }))
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
  },
}))
