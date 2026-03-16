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
  task: string
  status: 'running' | 'completed' | 'failed' | 'timeout' | 'done' | string
  model: string
  startedAt: number
  endedAt?: number
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
  pendingKills: Record<string, ReturnType<typeof setTimeout>>
  followMode: boolean
  fetchSessions: () => Promise<void>
  selectSession: (key: string | null) => void
  setFollowMode: (on: boolean) => void
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
  isSubAgent: (sessionKey: string) => boolean
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
  pendingKills: {},
  followMode: false,

  fetchSessions: async (): Promise<void> => {
    set({ subAgentsLoading: true })

    const [sessionsResult, subAgentsResult] = await Promise.allSettled([
      invokeTool('sessions_list') as Promise<{
        sessions: AgentSession[]
        count: number
      }>,
      invokeTool('subagents', { action: 'list' }) as Promise<{
        active?: { sessionKey: string; label?: string; task?: string; status: string; model: string; startedAt: number; endedAt?: number }[]
        recent?: { sessionKey: string; label?: string; task?: string; status: string; model: string; startedAt: number; endedAt?: number }[]
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
        task: s.task ?? '',
        _isActive: true
      }))
      const recent = (subData.recent ?? []).map((s) => ({
        ...s,
        label: deriveLabel(s),
        task: s.task ?? '',
        _isActive: false
      }))
      set({ subAgents: [...active, ...recent], subAgentsError: null, subAgentsLoading: false })
    } else {
      set({ subAgentsError: 'Could not fetch sub-agents', subAgentsLoading: false })
    }

    // Auto-follow: switch to most recently started active sub-agent
    if (get().followMode) {
      const mostRecent = get()
        .subAgents.filter((a) => a._isActive)
        .sort((a, b) => b.startedAt - a.startedAt)[0]
      if (mostRecent && mostRecent.sessionKey !== get().selectedSessionKey) {
        set({ selectedSessionKey: mostRecent.sessionKey })
      }
    }
  },

  selectSession: (key): void => {
    // Auto-disable follow if user manually selects a non-follow-target session
    const { followMode, subAgents } = get()
    if (followMode && key) {
      const isFollowTarget = subAgents.some((a) => a._isActive && a.sessionKey === key)
      if (!isFollowTarget) {
        set({ followMode: false })
      }
    }
    set({ selectedSessionKey: key })
  },

  setFollowMode: (on): void => {
    set({ followMode: on })
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
    // Optimistically remove from sessions/subAgents list
    set((s) => ({
      sessions: s.sessions.filter((sess) => sess.key !== sessionKey),
      subAgents: s.subAgents.filter((a) => a.sessionKey !== sessionKey)
    }))

    // Show undo toast for 5s
    toast.undoable('Session killed', () => {
      // Undo: clear timer, re-fetch to restore list
      const timer = get().pendingKills[sessionKey]
      if (timer) clearTimeout(timer)
      set((s) => {
        const { [sessionKey]: _, ...rest } = s.pendingKills
        return { pendingKills: rest }
      })
      get().fetchSessions()
      toast.info('Kill cancelled')
    }, 5000)

    // Delay actual API call by 5s
    const timer = setTimeout(async () => {
      try {
        await invokeTool('subagents', { action: 'kill', target: sessionKey })
      } catch {
        toast.error('Failed to stop session')
        get().fetchSessions()
      }
      set((s) => {
        const { [sessionKey]: _, ...rest } = s.pendingKills
        return { pendingKills: rest }
      })
    }, 5000)

    set((s) => ({ pendingKills: { ...s.pendingKills, [sessionKey]: timer } }))
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
  },

  isSubAgent: (sessionKey): boolean => {
    return get().subAgents.some((a) => a.sessionKey === sessionKey)
  }
}))
