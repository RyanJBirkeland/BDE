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
  loading: boolean
  fetchError: string | null
  fetchSessions: () => Promise<void>
  selectSession: (key: string | null) => void
  spawnSession: (params: {
    template: string
    repo: string
    title: string
    description: string
    model: string
  }) => Promise<void>
  runTask: (task: string) => Promise<string | null>
  killSession: (sessionKey: string) => Promise<void>
}

export const useSessionsStore = create<SessionsStore>((set, get) => ({
  sessions: [],
  selectedSessionKey: null,
  runningCount: 0,
  loading: true,
  fetchError: null,

  fetchSessions: async (): Promise<void> => {
    try {
      const result = (await invokeTool('sessions_list')) as AgentSession[]
      const sessions = Array.isArray(result) ? result : []
      set({
        sessions,
        runningCount: sessions.filter((s) => s.status === 'running').length,
        loading: false,
        fetchError: null
      })
    } catch {
      set({ loading: false, fetchError: 'Could not reach gateway' })
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
  },

  runTask: async (task): Promise<string | null> => {
    try {
      const result = (await invokeTool('sessions_spawn', {
        task,
        mode: 'run',
        runtime: 'subagent'
      })) as { sessionKey?: string } | undefined
      const sessionKey = result?.sessionKey ?? null
      toast.success(sessionKey ? `Task started: ${sessionKey}` : 'Task started')
      await get().fetchSessions()
      return sessionKey
    } catch (err) {
      console.error('Failed to run task:', err)
      toast.error('Failed to run task')
      return null
    }
  },

  killSession: async (sessionKey): Promise<void> => {
    try {
      await invokeTool('subagents', { action: 'kill', target: sessionKey })
      toast.success('Session stopped')
      await get().fetchSessions()
    } catch (err) {
      console.error('Failed to kill session:', err)
      toast.error('Failed to stop session')
    }
  }
}))
