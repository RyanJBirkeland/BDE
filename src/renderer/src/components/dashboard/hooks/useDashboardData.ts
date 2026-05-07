import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useNow } from '../../../hooks/useNow'
import { useSprintTasks } from '../../../stores/sprintTasks'
import { useCostDataStore } from '../../../stores/costData'
import {
  useSprintEvents,
  latestEventForTask,
  type AnyTaskEvent
} from '../../../stores/sprintEvents'
import { useDashboardDataStore } from '../../../stores/dashboardData'
import { useDrainStatus } from '../../../hooks/useDrainStatus'
import { useDashboardMetrics } from '../../../hooks/useDashboardMetrics'
import { useAgentManagerStatus } from '../../../hooks/useAgentManagerStatus'
import { partitionSprintTasks } from '../../../lib/partitionSprintTasks'
import { MS_PER_DAY } from '../../../lib/constants'
import { useDashboardActions, type DashboardActions } from './useDashboardActions'
import {
  buildBriefHeadlineParts,
  deriveActiveAgents,
  deriveAttentionItems,
  deriveAvgCostPerTask,
  derivePerAgentStats,
  derivePerRepoStats,
  type ActiveAgent,
  type AttentionItem,
  type BriefHeadlinePart,
  type PerAgentRow,
  type PerRepoRow
} from './dashboard-derivations'
import type { SprintTask } from '../../../../../shared/types'
import type { DashboardStats, ChartBar } from '../../../lib/dashboard-types'
import type { CompletionBucket, DailySuccessRate } from '../../../../../shared/ipc-channels'
import type { SprintPartition } from '../../../lib/partitionSprintTasks'
import type { DrainPausedState } from '../../../hooks/useDrainStatus'

const SEVEN_DAYS_MS = 7 * MS_PER_DAY

// Re-exports preserve the public API for components and tests that still
// import these symbols from `useDashboardData`.
export type { DashboardActions } from './useDashboardActions'
export {
  buildBriefHeadlineParts,
  deriveAttentionItems,
  derivePerAgentStats,
  derivePerRepoStats
} from './dashboard-derivations'
export type {
  ActiveAgent,
  AttentionItem,
  BriefHeadlinePart,
  PerAgentRow,
  PerRepoRow
} from './dashboard-derivations'

export interface DashboardMetrics {
  partitions: SprintPartition
  activeAgents: ActiveAgent[]
  attentionItems: AttentionItem[]
  stats: DashboardStats
  recentCompletions: SprintTask[]
  tokens24h: number
  tokenTrendData: ChartBar[]
  tokenAvg: string | null
  taskTokenMap: Map<string, number>
  stuckCount: number
  loadSaturated: { load1: number; cpuCount: number } | null
  successRate7dAvg: number | null
  successRateWeekDelta: number | null
  avgDuration: number | null
  avgTaskDuration: number | null
  throughputData: CompletionBucket[]
  successTrendData: DailySuccessRate[]
  avgCostPerTask: number | null
  failureRate: number | null
  perAgentStats: PerAgentRow[]
  perRepoStats: PerRepoRow[]
  briefHeadlineParts: BriefHeadlinePart[]
  capacity: number
  drainStatus: DrainPausedState | null
}

export interface DashboardData {
  metrics: DashboardMetrics
  actions: DashboardActions
}

/**
 * Stable fingerprint for the tasks array — only changes string value when a task id
 * or updated_at timestamp changes. Zustand compares with `===` so polls that find
 * identical data will NOT trigger re-renders in useDashboardData.
 */
function selectTasksFingerprint(s: { tasks: SprintTask[] }): string {
  return s.tasks.map((t) => `${t.id}:${t.updated_at}`).join(',')
}

/**
 * Snaps a timestamp to the start of its UTC day, then subtracts 7 days. The
 * returned cutoff changes only when the day boundary crosses, which keeps
 * downstream stats memos stable across the 10-second `useNow` ticks.
 */
function sevenDayCutoffFromDayStart(now: number): number {
  const startOfDay = Math.floor(now / MS_PER_DAY) * MS_PER_DAY
  return startOfDay - SEVEN_DAYS_MS
}

export function useDashboardData(): DashboardData {
  const taskFingerprint = useSprintTasks(selectTasksFingerprint)
  const allTasks = useSprintTasks((s) => s.tasks)

  // Re-use the tasks reference only when the fingerprint changes, so the seven
  // downstream useMemo chains do not recompute on every background poll.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tasks = useMemo(() => allTasks, [taskFingerprint])

  const localAgents = useCostDataStore((s) => s.localAgents)
  const drainStatus = useDrainStatus()

  const { throughputData, successTrendData } = useDashboardDataStore(
    useShallow((s) => ({ throughputData: s.throughputData, successTrendData: s.successTrendData }))
  )

  const {
    stats,
    tokenTrendData,
    tokenAvg,
    recentCompletions,
    tokens24h,
    taskTokenMap,
    stuckCount,
    loadSaturated,
    successRate7dAvg,
    successRateWeekDelta,
    avgDuration,
    avgTaskDuration
  } = useDashboardMetrics()

  const { maxSlots: capacity } = useAgentManagerStatus()

  const now = useNow()

  // Snap the 7-day window to a day boundary so it does not change every 10s
  // and re-trigger the per-agent / per-repo / avg-cost memos below.
  const sevenDaysCutoff = useMemo(() => sevenDayCutoffFromDayStart(now), [now])

  const partitions = useMemo(() => partitionSprintTasks(tasks), [tasks])

  // Only the first 5 inProgress tasks render as ActiveAgent rows, so we only
  // need to subscribe to events for those task ids. `useShallow` keeps the
  // reference stable when none of the watched events have moved.
  const activeAgentTaskIds = useMemo(
    () => partitions.inProgress.slice(0, 5).map((t) => t.id),
    [partitions.inProgress]
  )

  const latestEventByActiveTaskId = useSprintEvents(
    useShallow((s) => {
      const result: Record<string, AnyTaskEvent | undefined> = {}
      for (const id of activeAgentTaskIds) {
        result[id] = latestEventForTask(s.taskEvents, id)
      }
      return result
    })
  )

  const activeAgents = useMemo(
    () => deriveActiveAgents(partitions.inProgress, taskTokenMap, latestEventByActiveTaskId, now),
    [partitions.inProgress, taskTokenMap, latestEventByActiveTaskId, now]
  )

  const attentionItems = useMemo(
    () => deriveAttentionItems(partitions, now),
    [partitions, now]
  )

  const taskQualityMap = useMemo(() => {
    const map = new Map<string, number>()
    for (const task of tasks) {
      if (task.quality_score != null) map.set(task.id, task.quality_score)
    }
    return map
  }, [tasks])

  const perAgentStats = useMemo(
    () => derivePerAgentStats(localAgents, taskQualityMap, sevenDaysCutoff),
    [localAgents, taskQualityMap, sevenDaysCutoff]
  )
  const perRepoStats = useMemo(
    () => derivePerRepoStats(localAgents, sevenDaysCutoff),
    [localAgents, sevenDaysCutoff]
  )
  const avgCostPerTask = useMemo(
    () => deriveAvgCostPerTask(localAgents, sevenDaysCutoff),
    [localAgents, sevenDaysCutoff]
  )
  const failureRate = useMemo(() => {
    const terminal = stats.done + stats.actualFailed
    if (terminal === 0) return null
    return Math.round((stats.actualFailed / terminal) * 100)
  }, [stats])

  const briefHeadlineParts = useMemo(
    () => buildBriefHeadlineParts(stats.active, stats.review, stats.actualFailed),
    [stats.active, stats.review, stats.actualFailed]
  )

  const actions = useDashboardActions()

  const metrics: DashboardMetrics = {
    partitions,
    activeAgents,
    attentionItems,
    stats,
    recentCompletions,
    tokens24h,
    tokenTrendData,
    tokenAvg,
    taskTokenMap,
    stuckCount,
    loadSaturated,
    successRate7dAvg,
    successRateWeekDelta,
    avgDuration,
    avgTaskDuration,
    throughputData,
    successTrendData,
    avgCostPerTask,
    failureRate,
    perAgentStats,
    perRepoStats,
    briefHeadlineParts,
    capacity,
    drainStatus
  }

  return { metrics, actions }
}
