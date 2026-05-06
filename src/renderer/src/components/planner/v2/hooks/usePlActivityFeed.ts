import { useState, useEffect, useCallback } from 'react'
import type { SprintTask, AgentEvent } from '../../../../../../shared/types'
import { subscribeToAgentEvents, getAgentEventHistory } from '../../../../services/agents'

type TrackedEventType = 'agent:started' | 'agent:completed' | 'agent:error' | 'agent:tool_call'

const TRACKED_EVENTS = new Set<string>([
  'agent:started',
  'agent:completed',
  'agent:error',
  'agent:tool_call'
])

const AGENT_EVENT_TYPES = new Set<string>([
  'agent:started',
  'agent:mcp_disclosure',
  'agent:text',
  'agent:user_message',
  'agent:thinking',
  'agent:tool_call',
  'agent:tool_result',
  'agent:rate_limited',
  'agent:error',
  'agent:stderr',
  'agent:completed',
  'agent:playground'
])

interface ChangeRow {
  id: number
  task_id: string
  field: string
  old_value: string | null
  new_value: string | null
  changed_by: string
  changed_at: string
}

function isChangeRow(value: unknown): value is ChangeRow {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.task_id === 'string' &&
    typeof candidate.field === 'string' &&
    typeof candidate.changed_by === 'string' &&
    typeof candidate.changed_at === 'string'
  )
}

function isAgentEvent(value: unknown): value is AgentEvent {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.type === 'string' &&
    AGENT_EVENT_TYPES.has(candidate.type) &&
    typeof candidate.timestamp === 'number'
  )
}

export function parseChangeRows(raw: unknown): ChangeRow[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(isChangeRow)
}

export function parseAgentEvents(raw: unknown): AgentEvent[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(isAgentEvent)
}

export type FeedEntry =
  | {
      kind: 'change'
      taskId: string
      taskTitle: string
      field: string
      oldValue: string | null
      newValue: string | null
      changedBy: string
      timestamp: string
    }
  | {
      kind: 'agent'
      taskId: string
      taskTitle: string
      eventType: TrackedEventType
      summary: string
      timestamp: string
    }

export function agentEventSummary(event: AgentEvent): string {
  if (event.type === 'agent:started') return 'Agent started'
  if (event.type === 'agent:completed') return 'Agent completed'
  if (event.type === 'agent:error') return event.message.slice(0, 80)
  if (event.type === 'agent:tool_call') return `$ ${event.tool}: ${event.summary}`.slice(0, 60)
  return ''
}

export function buildAgentFeedEntry(
  event: AgentEvent,
  taskId: string,
  taskTitle: string
): FeedEntry | null {
  if (!TRACKED_EVENTS.has(event.type)) return null
  return {
    kind: 'agent',
    taskId,
    taskTitle,
    eventType: event.type as TrackedEventType,
    summary: agentEventSummary(event),
    timestamp: new Date(event.timestamp).toISOString()
  }
}

export function buildChangeFeedEntry(row: ChangeRow, taskTitle: string): FeedEntry {
  return {
    kind: 'change',
    taskId: row.task_id,
    taskTitle,
    field: row.field,
    oldValue: row.old_value,
    newValue: row.new_value,
    changedBy: row.changed_by,
    timestamp: row.changed_at
  }
}

function sortNewestFirst(entries: FeedEntry[]): FeedEntry[] {
  return [...entries].sort((a, b) => b.timestamp.localeCompare(a.timestamp))
}

export function usePlActivityFeed(tasks: SprintTask[]): {
  entries: FeedEntry[]
  loading: boolean
  error: string | null
  reload: () => void
} {
  const [entries, setEntries] = useState<FeedEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Stable fingerprint of task IDs — avoids re-fetching on every 30s poll that
  // delivers a new array reference even when task IDs haven't changed.
  const taskIds = tasks.map((t) => t.id).join(',')

  const fetchAll = useCallback(async () => {
    if (tasks.length === 0) {
      setEntries([])
      return
    }
    setLoading(true)
    setError(null)
    try {
      const perTask = await Promise.all(
        tasks.map(async (task) => {
          const [changes, agentEvents] = await Promise.all([
            window.api.sprint.getChanges(task.id),
            getAgentEventHistory(task.id)
          ])
          const changeEntries = parseChangeRows(changes).map((c) =>
            buildChangeFeedEntry(c, task.title)
          )
          const agentEntries = parseAgentEvents(agentEvents)
            .map((e) => buildAgentFeedEntry(e, task.id, task.title))
            .filter((e): e is FeedEntry => e !== null)
          return [...changeEntries, ...agentEntries]
        })
      )
      setEntries(sortNewestFirst(perTask.flat()))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskIds])

  useEffect(() => {
    void fetchAll()
  }, [fetchAll])

  useEffect(() => {
    const taskIdSet = new Set(tasks.map((t) => t.id))
    const titleByTaskId = new Map(tasks.map((t) => [t.id, t.title]))

    const unsubscribe = subscribeToAgentEvents(({ agentId, event }) => {
      if (!taskIdSet.has(agentId)) return
      const entry = buildAgentFeedEntry(event, agentId, titleByTaskId.get(agentId) ?? agentId)
      if (!entry) return
      // Live events are always newer than existing historical entries, so
      // prepending maintains newest-first order without a full re-sort.
      setEntries((prev) => [entry, ...prev])
    })

    return unsubscribe
  }, [tasks])

  return { entries, loading, error, reload: fetchAll }
}
