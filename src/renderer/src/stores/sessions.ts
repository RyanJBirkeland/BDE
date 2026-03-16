/**
 * Sessions store — agent session lifecycle management.
 * Fetches session list from the gateway via RPC (sessions_list), tracks
 * selection state, and provides spawn/run/kill actions for agent sessions.
 */
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

export interface SubAgent {
  sessionKey: string
  label: string
  status: 'running' | 'completed' | 'failed' | 'timeout' | string
  model: string
  startedAt: number
  _isActive: boolean
}

interface SessionsStore {
  sessions: AgentSession[]
  subAgents: SubAgent[]
  subAgentsLoading: boolean
  subAgentsError: string | null
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
  runTask: (task: string, opts?: { repo?: string; model?: string }) => Promise<string | null>
  killSession: (sessionKey: string) => Promise<void>
  steerSubAgent: (sessionKey: string, message: string) => Promise<void>
  sendToSubAgent: (sessionKey: string, message: string) => Promise<void>
}

export const useSessionsStore = create<SessionsStore>((set, get) => ({
  sessions: [],
  subAgents: [],
  subAgentsLoading: false,
  subAgentsError: null,
  selectedSessionKey: null,
  runningCount: 0,
  loading: true,
  fetchError: null,

  fetchSessions: async (): Promise<void> => {
    set({ subAgentsLoading: true })

    const [sessionsResult, subAgentsResult] = await Promise.allSettled([
      invokeTool('sessions_list') as Promise<{
        sessions: AgentSession[]
        count: number
      }>,
      invokeTool('subagents', { action: 'list' }) as Promise<{
        active?: { sessionKey: string; label?: string; status: string; model: string; startedAt: number }[]
        recent?: { sessionKey: string; label?: string; status: string; model: string; startedAt: number }[]
      }>
    ])

    // Handle sessions result
    if (sessionsResult.status === 'fulfilled') {
      const sessions = sessionsResult.value.sessions ?? []
      const fiveMinAgo = Date.now() - 5 * 60 * 1000
      set({
        sessions,
        runningCount: sessions.filter((s) => s.updatedAt > fiveMinAgo).length,
        loading: false,
        fetchError: null
      })
    } else {
      set({ loading: false, fetchError: 'Could not reach gateway' })
      toast.error('Failed to fetch sessions')
    }

    // Handle sub-agents result — failure does not block sessions
    if (subAgentsResult.status === 'fulfilled') {
      const subData = subAgentsResult.value
      const deriveLabel = (entry: { label?: string; sessionKey: string }): string => {
        if (entry.label) return entry.label
        const parts = entry.sessionKey.split(':')
        const last = parts[parts.length - 1] ?? entry.sessionKey
        return `subagent-${last.slice(-8)}`
      }
      const active = (subData.active ?? []).map((s) => ({
        ...s,
        label: deriveLabel(s),
        _isActive: true
      }))
      const recent = (subData.recent ?? []).map((s) => ({
        ...s,
        label: deriveLabel(s),
        _isActive: false
      }))
      set({ subAgents: [...active, ...recent], subAgentsError: null, subAgentsLoading: false })
    } else {
      set({ subAgentsError: 'Could not fetch sub-agents', subAgentsLoading: false })
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

  runTask: async (task, opts): Promise<string | null> => {
    try {
      const result = (await invokeTool('sessions_spawn', {
        task,
        mode: 'run',
        runtime: 'subagent',
        ...opts
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
  },

  steerSubAgent: async (sessionKey, message): Promise<void> => {
    try {
      await invokeTool('subagents', { action: 'steer', target: sessionKey, message })
      toast.success('Steering message sent')
    } catch (err) {
      console.error('Failed to steer sub-agent:', err)
      toast.error('Failed to send steering message')
    }
  },

  sendToSubAgent: async (sessionKey, message): Promise<void> => {
    try {
      await invokeTool('sessions_send', { sessionKey, message })
      toast.success('Message sent')
    } catch (err) {
      console.error('Failed to send to sub-agent:', err)
      toast.error('Failed to send message')
    }
  }
}))
