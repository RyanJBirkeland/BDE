import { useMemo, useState } from 'react'
import { useSprintTasks } from '../stores/sprintTasks'
import { useCostDataStore } from '../stores/costData'
import { useVisibilityAwareInterval } from './useVisibilityAwareInterval'
import type { ChartBar } from '../components/neon'
import type { SprintTask } from '../../../shared/types'

interface DashboardStats {
  active: number
  queued: number
  blocked: number
  review: number
  done: number
  doneToday: number
  failed: number
  actualFailed: number
}

/** Format token count to compact form (e.g. 1.2M, 45.2K). */
function formatTokensCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

interface DashboardMetrics {
  stats: DashboardStats
  successRate: number | null
  avgDuration: number | null
  avgTaskDuration: number | null
  taskDurationCount: number
  tokenTrendData: ChartBar[]
  tokenAvg: string | null
  recentCompletions: SprintTask[]
  tokens24h: number
  taskTokenMap: Map<string, number>
}

/** Truncate a string to maxLen characters, adding ellipsis if needed. */
function truncate(str: string, maxLen: number): string {
  return str.length <= maxLen ? str : str.slice(0, maxLen) + '…'
}

/** Check if a timestamp (ISO string or epoch) is today in local time. */
function isToday(timestamp: string | number): boolean {
  const date = new Date(timestamp)
  const today = new Date()
  return (
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  )
}

/**
 * Computes derived metrics for the Dashboard view from sprint tasks and usage data.
 * Extracts all metric calculations into a single reusable hook.
 */
export function useDashboardMetrics(): DashboardMetrics {
  const tasks = useSprintTasks((s) => s.tasks)
  const localAgents = useCostDataStore((s) => s.localAgents)

  // Track current time for 24h token calculation (updates every 60s)
  const [now, setNow] = useState(() => Date.now())
  useVisibilityAwareInterval(() => setNow(Date.now()), 60_000)

  // Derived stats (single-pass)
  const stats = useMemo((): DashboardStats => {
    const counts = {
      active: 0,
      queued: 0,
      blocked: 0,
      review: 0,
      done: 0,
      doneToday: 0,
      failed: 0,
      actualFailed: 0
    }
    for (const t of tasks) {
      if (t.status === 'active') counts.active++
      else if (t.status === 'queued') counts.queued++
      else if (t.status === 'blocked') counts.blocked++
      else if (t.status === 'review') counts.review++
      else if (t.status === 'done') {
        counts.done++
        if (t.completed_at && isToday(t.completed_at)) {
          counts.doneToday++
        }
      } else if (t.status === 'failed' || t.status === 'error' || t.status === 'cancelled') {
        counts.failed++
        if (t.status !== 'cancelled') counts.actualFailed++
      }
    }
    return counts
  }, [tasks])

  // Success rate — excludes cancelled tasks (intentional user action, not system failure)
  const successRate = useMemo(() => {
    const terminal = stats.done + stats.actualFailed
    if (terminal === 0) return null
    return Math.round((stats.done / terminal) * 100)
  }, [stats])

  // Average duration from agent cost records
  const avgDuration = useMemo(() => {
    const withDuration = localAgents.filter((a) => a.durationMs != null && a.durationMs > 0)
    if (withDuration.length === 0) return null
    const avg = withDuration.reduce((sum, a) => sum + a.durationMs!, 0) / withDuration.length
    return avg
  }, [localAgents])

  // Average task runtime from sprint_tasks.duration_ms (terminal tasks only)
  const { avgTaskDuration, taskDurationCount } = useMemo(() => {
    const terminalStatuses = new Set(['done', 'failed', 'review'])
    const withDuration = tasks.filter(
      (t) => terminalStatuses.has(t.status) && t.duration_ms != null && t.duration_ms > 0
    )
    if (withDuration.length === 0) {
      return { avgTaskDuration: null, taskDurationCount: 0 }
    }
    const avg = withDuration.reduce((sum, t) => sum + t.duration_ms!, 0) / withDuration.length
    return { avgTaskDuration: avg, taskDurationCount: withDuration.length }
  }, [tasks])

  // Token trend sparkline — last 20 agent runs sorted by start time
  const tokenTrendData = useMemo((): ChartBar[] => {
    const sorted = [...localAgents]
      .filter((a) => (a.tokensIn != null || a.tokensOut != null))
      .sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime())
      .slice(-20)
    return sorted.map((a) => {
      const total = (a.tokensIn ?? 0) + (a.tokensOut ?? 0)
      return {
        value: total,
        accent: 'cyan' as const,
        label: `${formatTokensCompact(total)} — ${truncate(a.taskTitle ?? a.id.slice(0, 8), 40)}`
      }
    })
  }, [localAgents])

  const tokenAvg = useMemo(() => {
    if (tokenTrendData.length === 0) return null
    const avg = tokenTrendData.reduce((s, d) => s + d.value, 0) / tokenTrendData.length
    return formatTokensCompact(Math.round(avg))
  }, [tokenTrendData])

  // Recent completions — last 5 done tasks
  const recentCompletions = useMemo(() => {
    return tasks
      .filter((t) => t.status === 'done' && t.completed_at)
      .sort((a, b) => new Date(b.completed_at!).getTime() - new Date(a.completed_at!).getTime())
      .slice(0, 5)
  }, [tasks])

  // Tokens 24h — sum tokens of agent runs started within last 24 hours
  const tokens24h = useMemo(() => {
    const cutoff = now - 24 * 60 * 60 * 1000
    return localAgents
      .filter((a) => new Date(a.startedAt).getTime() >= cutoff)
      .reduce((sum, a) => sum + (a.tokensIn ?? 0) + (a.tokensOut ?? 0), 0)
  }, [localAgents, now])

  // Task token lookup map — sprintTaskId -> totalTokens
  const taskTokenMap = useMemo(() => {
    const map = new Map<string, number>()
    for (const agent of localAgents) {
      if (agent.sprintTaskId && (agent.tokensIn != null || agent.tokensOut != null)) {
        map.set(agent.sprintTaskId, (agent.tokensIn ?? 0) + (agent.tokensOut ?? 0))
      }
    }
    return map
  }, [localAgents])

  return {
    stats,
    successRate,
    avgDuration,
    avgTaskDuration,
    taskDurationCount,
    tokenTrendData,
    tokenAvg,
    recentCompletions,
    tokens24h,
    taskTokenMap
  }
}
