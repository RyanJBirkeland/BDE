import { useMemo } from 'react'
import { useSprintTasks } from '../stores/sprintTasks'
import { useCostDataStore } from '../stores/costData'
import type { ChartBar } from '../components/neon'
import type { SprintTask } from '../../../shared/types'

interface DashboardStats {
  active: number
  queued: number
  blocked: number
  done: number
  failed: number
  actualFailed: number
}

interface DashboardMetrics {
  stats: DashboardStats
  successRate: number | null
  avgDuration: number | null
  costTrendData: ChartBar[]
  costAvg: string | null
  recentCompletions: SprintTask[]
}

/** Truncate a string to maxLen characters, adding ellipsis if needed. */
function truncate(str: string, maxLen: number): string {
  return str.length <= maxLen ? str : str.slice(0, maxLen) + '…'
}

/**
 * Computes derived metrics for the Dashboard view from sprint tasks and cost data.
 * Extracts all metric calculations into a single reusable hook.
 */
export function useDashboardMetrics(): DashboardMetrics {
  const tasks = useSprintTasks((s) => s.tasks)
  const localAgents = useCostDataStore((s) => s.localAgents)

  // Derived stats (single-pass)
  const stats = useMemo((): DashboardStats => {
    const counts = { active: 0, queued: 0, blocked: 0, done: 0, failed: 0, actualFailed: 0 }
    for (const t of tasks) {
      if (t.status === 'active') counts.active++
      else if (t.status === 'queued') counts.queued++
      else if (t.status === 'blocked') counts.blocked++
      else if (t.status === 'done') counts.done++
      else if (t.status === 'failed' || t.status === 'error' || t.status === 'cancelled') {
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

  // Cost trend sparkline — last 20 agent runs sorted by start time
  const costTrendData = useMemo((): ChartBar[] => {
    const sorted = [...localAgents]
      .filter((a) => a.costUsd != null && a.costUsd > 0)
      .sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime())
      .slice(-20)
    return sorted.map((a) => ({
      value: a.costUsd!,
      accent: 'orange' as const,
      label: `$${a.costUsd!.toFixed(2)} — ${truncate(a.taskTitle ?? a.id.slice(0, 8), 40)}`
    }))
  }, [localAgents])

  const costAvg = useMemo(() => {
    if (costTrendData.length === 0) return null
    return (costTrendData.reduce((s, d) => s + d.value, 0) / costTrendData.length).toFixed(2)
  }, [costTrendData])

  // Recent completions — last 5 done tasks
  const recentCompletions = useMemo(() => {
    return tasks
      .filter((t) => t.status === 'done' && t.completed_at)
      .sort((a, b) => new Date(b.completed_at!).getTime() - new Date(a.completed_at!).getTime())
      .slice(0, 5)
  }, [tasks])

  return {
    stats,
    successRate,
    avgDuration,
    costTrendData,
    costAvg,
    recentCompletions
  }
}
