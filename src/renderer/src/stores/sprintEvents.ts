import { create } from 'zustand'
import type { TaskOutputEvent } from '../../../shared/queue-api-contract'

export interface QueueHealth {
  queue: Record<string, number>
  doneToday: number
  connectedRunners: number
}

interface SprintEventsState {
  // --- State ---
  taskEvents: Record<string, TaskOutputEvent[]>
  latestEvents: Record<string, TaskOutputEvent>
  queueHealth: QueueHealth | null

  // --- Actions ---
  initTaskOutputListener: () => () => void
  fetchQueueHealth: () => Promise<void>
  clearTaskEvents: (taskId: string) => void
}

export const useSprintEvents = create<SprintEventsState>((set) => ({
  taskEvents: {},
  latestEvents: {},
  queueHealth: null,

  initTaskOutputListener: (): (() => void) => {
    // Legacy path: task:output events from queue API
    const cleanupLegacy = window.api.onTaskOutput(({ taskId, events }) => {
      set((s) => {
        const existing = s.taskEvents[taskId] ?? []
        const updated = [...existing, ...events]
        const latest = events[events.length - 1]
        return {
          taskEvents: { ...s.taskEvents, [taskId]: updated },
          latestEvents: { ...s.latestEvents, [taskId]: latest },
        }
      })
    })

    // Phase 2 dual-write: agent:event stream populates legacy fields
    const cleanupAgent = window.api.agentEvents?.onEvent(({ agentId, event }) => {
      set((s) => ({
        taskEvents: {
          ...s.taskEvents,
          [agentId]: [...(s.taskEvents[agentId] ?? []), event as never],
        },
        latestEvents: {
          ...s.latestEvents,
          [agentId]: event as never,
        },
      }))
    })

    return () => {
      cleanupLegacy()
      cleanupAgent?.()
    }
  },

  fetchQueueHealth: async (): Promise<void> => {
    try {
      const health = await window.api.queue.health()
      set({ queueHealth: health })
    } catch {
      set({ queueHealth: null })
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
