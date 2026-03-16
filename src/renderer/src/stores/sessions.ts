/**
 * Sessions store — agent session lifecycle management.
 * Fetches session list from the gateway via RPC (sessions_list), tracks
 * selection state, and provides spawn/run/kill actions for agent sessions.
 */
import { create } from 'zustand'
import { invokeTool } from '../lib/rpc'
import { toast } from './toasts'
import { SESSION_ACTIVE_THRESHOLD, KILL_UNDO_WINDOW } from '../lib/constants'

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

export type SplitMode = 'single' | '2-pane' | 'grid-4'

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
  splitMode: SplitMode
  splitPanes: [string | null, string | null, string | null, string | null]
  focusedPaneIndex: number
  fetchSessions: () => Promise<void>
  selectSession: (key: string | null) => void
  setFollowMode: (on: boolean) => void
  setSplitMode: (mode: SplitMode) => void
  setPaneSession: (paneIndex: number, sessionKey: string | null) => void
  setFocusedPane: (index: number) => void
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
  splitMode: 'single',
  splitPanes: [null, null, null, null],
  focusedPaneIndex: 0,

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
      const fiveMinAgo = Date.now() - SESSION_ACTIVE_THRESHOLD
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
    const { followMode, subAgents, focusedPaneIndex, splitPanes } = get()
    if (followMode && key) {
      const isFollowTarget = subAgents.some((a) => a._isActive && a.sessionKey === key)
      if (!isFollowTarget) {
        set({ followMode: false })
      }
    }
    // Also populate the focused split pane
    const panes = [...splitPanes] as [string | null, string | null, string | null, string | null]
    panes[focusedPaneIndex] = key
    set({ selectedSessionKey: key, splitPanes: panes })
  },

  setFollowMode: (on): void => {
    set({ followMode: on })
  },

  setSplitMode: (mode): void => {
    const { selectedSessionKey, splitPanes } = get()
    if (mode === 'single') {
      // Keep splitPanes[0] synced with the current selection
      const panes: [string | null, string | null, string | null, string | null] = [
        splitPanes[0] ?? selectedSessionKey,
        null,
        null,
        null
      ]
      set({ splitMode: mode, splitPanes: panes, focusedPaneIndex: 0 })
    } else {
      // When switching to multi-pane, seed pane 0 from selectedSessionKey if empty
      const panes = [...splitPanes] as [string | null, string | null, string | null, string | null]
      if (!panes[0] && selectedSessionKey) {
        panes[0] = selectedSessionKey
      }
      set({ splitMode: mode, splitPanes: panes })
    }
  },

  setPaneSession: (paneIndex, sessionKey): void => {
    const panes = [...get().splitPanes] as [string | null, string | null, string | null, string | null]
    panes[paneIndex] = sessionKey
    set({ splitPanes: panes })
  },

  setFocusedPane: (index): void => {
    set({ focusedPaneIndex: index })
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
    }, KILL_UNDO_WINDOW)

    // Delay actual API call
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
    }, KILL_UNDO_WINDOW)

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
