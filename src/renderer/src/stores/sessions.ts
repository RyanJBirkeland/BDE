import { create } from 'zustand'
import { invokeTool } from '../lib/rpc'
import { toast } from './toasts'

export interface AgentSession {
  key: string
  sessionId: string
  model: string
  displayName: string
  channel: string
  lastChannel: string
  updatedAt: number
  totalTokens: number
  contextTokens: number
  abortedLastRun: boolean
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
      const data = (await invokeTool('sessions_list')) as {
        sessions: AgentSession[]
        count: number
      }
      const sessions = data.sessions ?? []
      const fiveMinAgo = Date.now() - 5 * 60 * 1000
      set({
        sessions,
        runningCount: sessions.filter((s) => s.updatedAt > fiveMinAgo).length,
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
