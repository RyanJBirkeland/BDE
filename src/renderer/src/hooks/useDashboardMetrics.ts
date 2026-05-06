import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useSprintTasks } from '../stores/sprintTasks'
import { useCostDataStore } from '../stores/costData'
import { useDashboardDataStore } from '../stores/dashboardData'
import type { SprintTask } from '../../../shared/types'
import type { DashboardStats, ChartBar } from '../lib/dashboard-types'
import { formatTokensCompact } from '../lib/format'

/** 1 hour — matches agent-manager watchdog default */
export const DEFAULT_STUCK_MS = 60 * 60 * 1000

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
  stuckCount: number
  loadSaturated: { load1: number; cpuCount: number } | null
  successRate7dAvg: number | null
  successRateWeekDelta: number | null
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
  const { loadData, successTrendData } = useDashboardDataStore(
    useShallow((s) => ({
      loadData: s.loadData,
      successTrendData: s.successTrendData
    }))
  )

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
      .filter((a) => a.tokensIn != null || a.tokensOut != null)
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

  // Tokens 24h — sum tokens of agent runs started within last 24 hours.
  // Uses Date.now() inline; recomputes when localAgents changes (on each poll).
  const tokens24h = useMemo(() => {
    // eslint-disable-next-line react-hooks/purity -- Date.now() intentional: recomputes on poll, no ticker needed
    const cutoff = Date.now() - 24 * 60 * 60 * 1000
    return localAgents
      .filter((a) => new Date(a.startedAt).getTime() >= cutoff)
      .reduce((sum, a) => sum + (a.tokensIn ?? 0) + (a.tokensOut ?? 0), 0)
  }, [localAgents])

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

  // Stuck tasks — active tasks that have exceeded their runtime threshold.
  // Uses Date.now() inline; recomputes when tasks changes (on each poll).
  const stuckCount = useMemo(() => {
    // eslint-disable-next-line react-hooks/purity -- Date.now() intentional: recomputes on poll, no ticker needed
    const now = Date.now()
    return tasks.filter((t) => {
      if (t.status !== 'active' || !t.started_at) return false
      const elapsed = now - new Date(t.started_at).getTime()
      const threshold = t.max_runtime_ms ?? DEFAULT_STUCK_MS
      return elapsed > threshold
    }).length
  }, [tasks])

  // Load saturation — null if healthy, populated object if load1 >= 2x CPU count
  const loadSaturated = useMemo(() => {
    if (!loadData || loadData.samples.length === 0) return null
    const latest = loadData.samples[loadData.samples.length - 1]
    if (!latest || latest.load1 < 2 * loadData.cpuCount) return null
    return { load1: latest.load1, cpuCount: loadData.cpuCount }
  }, [loadData])

  // Success rate 7-day average and week-over-week delta
  const { successRate7dAvg, successRateWeekDelta } = useMemo(() => {
    const avg = (arr: Array<number | null>): number | null => {
      const nums = arr.filter((n): n is number => n != null)
      if (nums.length === 0) return null
      return nums.reduce((s, n) => s + n, 0) / nums.length
    }
    const last7 = successTrendData.slice(-7).map((d) => d.successRate)
    const prior7 = successTrendData.slice(-14, -7).map((d) => d.successRate)
    const last7Avg = avg(last7)
    const prior7Avg = avg(prior7)
    return {
      successRate7dAvg: last7Avg,
      successRateWeekDelta: last7Avg != null && prior7Avg != null ? last7Avg - prior7Avg : null
    }
  }, [successTrendData])

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
    taskTokenMap,
    stuckCount,
    loadSaturated,
    successRate7dAvg,
    successRateWeekDelta
  }
}
