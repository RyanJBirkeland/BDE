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

interface ChangeRow {
  id: number
  task_id: string
  field: string
  old_value: string | null
  new_value: string | null
  changed_by: string
  changed_at: string
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
          const changeEntries = (changes as ChangeRow[]).map((c) =>
            buildChangeFeedEntry(c, task.title)
          )
          const agentEntries = (agentEvents as AgentEvent[])
            .map((e: AgentEvent) => buildAgentFeedEntry(e, task.id, task.title))
            .filter((e): e is FeedEntry => e !== null)
          return [...changeEntries, ...agentEntries]
        })
      )
      setEntries(sortNewestFirst(perTask.flat()))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [tasks])

  useEffect(() => {
    void fetchAll()
  }, [fetchAll])

  useEffect(() => {
    const taskIds = new Set(tasks.map((t) => t.id))
    const titleByTaskId = new Map(tasks.map((t) => [t.id, t.title]))

    const unsubscribe = subscribeToAgentEvents(({ agentId, event }) => {
      if (!taskIds.has(agentId)) return
      const entry = buildAgentFeedEntry(event, agentId, titleByTaskId.get(agentId) ?? agentId)
      if (!entry) return
      setEntries((prev) => sortNewestFirst([entry, ...prev]))
    })

    return unsubscribe
  }, [tasks])

  return { entries, loading, error, reload: fetchAll }
}
