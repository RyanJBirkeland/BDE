import { create } from 'zustand'
import { invokeTool } from '../lib/rpc'
import { toast } from './toasts'

export interface AgentSession {
  key: string
  status: 'running' | 'idle' | 'completed' | 'error'
  model: string
  label: string
  startedAt: string
  updatedAt: string
}

interface SessionsStore {
  sessions: AgentSession[]
  selectedSessionKey: string | null
  runningCount: number
  fetchSessions: () => Promise<void>
  selectSession: (key: string | null) => void
  spawnSession: (params: {
    template: string
    repo: string
    title: string
    description: string
    model: string
  }) => Promise<void>
}

export const useSessionsStore = create<SessionsStore>((set, get) => ({
  sessions: [],
  selectedSessionKey: null,
  runningCount: 0,

  fetchSessions: async (): Promise<void> => {
    try {
      const result = (await invokeTool('sessions_list')) as AgentSession[]
      const sessions = Array.isArray(result) ? result : []
      set({
        sessions,
        runningCount: sessions.filter((s) => s.status === 'running').length
      })
    } catch {
      toast.error('Failed to fetch sessions')
    }
  },

  selectSession: (key): void => {
    set({ selectedSessionKey: key })
  },

  spawnSession: async (params): Promise<void> => {
    try {
      await invokeTool('sessions_spawn', {
        template: params.template,
        repo: params.repo,
        title: params.title,
        description: params.description,
        model: params.model
      })
      await get().fetchSessions()
    } catch (err) {
      console.error('Failed to spawn session:', err)
      toast.error('Failed to spawn session')
    }
  }
}))
