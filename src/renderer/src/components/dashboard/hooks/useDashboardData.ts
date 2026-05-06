import { useMemo, useCallback } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useNow } from '../../../hooks/useNow'
import { useSprintTasks } from '../../../stores/sprintTasks'
import { useCostDataStore } from '../../../stores/costData'
import { useSprintEvents, latestEventForTask, type SprintEventsState } from '../../../stores/sprintEvents'
import { describeAgentStep } from '../../../lib/describeAgentStep'
import { useDashboardDataStore } from '../../../stores/dashboardData'
import { useSprintFilters, type StatusFilter } from '../../../stores/sprintFilters'
import { usePanelLayoutStore } from '../../../stores/panelLayout'
import { useDrainStatus } from '../../../hooks/useDrainStatus'
import { useDashboardMetrics } from '../../../hooks/useDashboardMetrics'
import { useAgentManagerStatus } from '../../../hooks/useAgentManagerStatus'
import { useTaskWorkbenchModalStore } from '../../../stores/taskWorkbenchModal'
import { partitionSprintTasks } from '../../../lib/partitionSprintTasks'
import type { SprintTask } from '../../../../../shared/types'
import type { AgentCostRecord } from '../../../../../shared/types/agent-types'
import type { DashboardStats, ChartBar } from '../../../lib/dashboard-types'
import type { CompletionBucket, DailySuccessRate } from '../../../../../shared/ipc-channels'
import type { SprintPartition } from '../../../lib/partitionSprintTasks'
import type { DrainPausedState } from '../../../hooks/useDrainStatus'

const STALE_REVIEW_THRESHOLD_MS = 2 * 60 * 60 * 1000 // 2 hours
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

export interface ActiveAgent {
  id: string
  title: string
  repo: string
  tokens: number
  elapsedMs: number
  progressPct: number | null
  startedAt: string | null
  stepDescription: string
}

export interface AttentionItem {
  kind: 'failed' | 'blocked' | 'review'
  task: SprintTask
  ageMs: number
  sub: string
  action: 'Restart' | 'Review' | 'Ping'
}

export interface PerAgentRow {
  name: string
  runs: number
  successPct: number | null
  avgDurationMs: number | null
  totalTokens: number
  quality: number | null
}

export interface PerRepoRow {
  repo: string
  runs: number
  prs: number
  merged: number
  open: number
}

export type BriefHeadlinePart =
  | { kind: 'text'; text: string }
  | { kind: 'count'; text: string; color: string }

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

export interface DashboardActions {
  openAgentsView: () => void
  openPipelineView: (filter?: StatusFilter) => void
  openReviewView: () => void
  openPlannerView: () => void
  openNewTask: () => void
  retryTask: (taskId: string) => Promise<void>
}

export interface DashboardData {
  metrics: DashboardMetrics
  actions: DashboardActions
}

function buildBriefHeadlineParts(
  activeCount: number,
  reviewCount: number,
  failedCount: number
): BriefHeadlinePart[] {
  if (activeCount === 0 && reviewCount === 0 && failedCount === 0) {
    return [{ kind: 'text', text: 'All quiet. No agents running.' }]
  }

  const parts: BriefHeadlinePart[] = []

  if (activeCount > 0) {
    parts.push({ kind: 'count', text: String(activeCount), color: 'var(--st-running)' })
    parts.push({ kind: 'text', text: activeCount === 1 ? ' agent working' : ' agents working' })
  }

  if (reviewCount > 0) {
    if (parts.length > 0) parts.push({ kind: 'text', text: ', ' })
    parts.push({ kind: 'count', text: String(reviewCount), color: 'var(--st-review)' })
    parts.push({ kind: 'text', text: ' review' })
    parts.push({ kind: 'text', text: reviewCount === 1 ? ' waiting on you' : 's waiting on you' })
  }

  if (failedCount > 0) {
    if (parts.length > 0) parts.push({ kind: 'text', text: ', ' })
    parts.push({ kind: 'count', text: String(failedCount), color: 'var(--st-failed)' })
    parts.push({ kind: 'text', text: failedCount === 1 ? ' failure overnight' : ' failures overnight' })
  }

  parts.push({ kind: 'text', text: '.' })
  return parts
}

function deriveAttentionItems(
  partitions: SprintPartition,
  now: number
): AttentionItem[] {
  const items: AttentionItem[] = []

  for (const task of partitions.failed) {
    items.push({
      kind: 'failed',
      task,
      ageMs: task.completed_at ? now - new Date(task.completed_at).getTime() : 0,
      sub: task.failure_reason ?? 'unknown failure',
      action: 'Restart'
    })
  }

  for (const task of partitions.blocked) {
    items.push({
      kind: 'blocked',
      task,
      ageMs: task.updated_at ? now - new Date(task.updated_at).getTime() : 0,
      sub: 'awaiting upstream task',
      action: 'Ping'
    })
  }

  for (const task of partitions.pendingReview) {
    const promotedAt = task.promoted_to_review_at
      ? new Date(task.promoted_to_review_at).getTime()
      : null
    const ageMs = promotedAt ? now - promotedAt : 0
    if (ageMs >= STALE_REVIEW_THRESHOLD_MS) {
      items.push({
        kind: 'review',
        task,
        ageMs,
        sub: `PR waiting ${Math.floor(ageMs / (60 * 60 * 1000))}h, no decision`,
        action: 'Review'
      })
    }
  }

  return items
    .sort((a, b) => {
      const severityOrder = { failed: 0, blocked: 1, review: 2 } as const
      const severityDiff = severityOrder[a.kind] - severityOrder[b.kind]
      if (severityDiff !== 0) return severityDiff
      return b.ageMs - a.ageMs
    })
    .slice(0, 5)
}

function deriveActiveAgents(
  inProgress: SprintTask[],
  taskTokenMap: Map<string, number>,
  taskEvents: SprintEventsState['taskEvents'],
  now: number
): ActiveAgent[] {
  return inProgress.slice(0, 5).map((task) => {
    const startedMs = task.started_at ? new Date(task.started_at).getTime() : now
    const elapsedMs = now - startedMs
    const progressPct =
      task.max_runtime_ms != null
        ? Math.min(100, Math.round((elapsedMs / task.max_runtime_ms) * 100))
        : null
    const latestEvent = latestEventForTask(taskEvents, task.id)
    return {
      id: task.id,
      title: task.title,
      repo: task.repo,
      tokens: taskTokenMap.get(task.id) ?? 0,
      elapsedMs,
      progressPct,
      startedAt: task.started_at ?? null,
      stepDescription: describeAgentStep(latestEvent)
    }
  })
}

function derivePerAgentStats(
  agents: AgentCostRecord[],
  taskQualityMap: Map<string, number>
): PerAgentRow[] {
  const sevenDaysAgo = Date.now() - SEVEN_DAYS_MS

  const recent = agents.filter((a) => new Date(a.startedAt).getTime() >= sevenDaysAgo)

  const byName = new Map<string, AgentCostRecord[]>()
  for (const a of recent) {
    const name = a.taskTitle ?? 'unknown'
    const existing = byName.get(name) ?? []
    existing.push(a)
    byName.set(name, existing)
  }

  return Array.from(byName.entries())
    .map(([name, runs]) => {
      const withDuration = runs.filter(
        (r): r is typeof r & { durationMs: number } => r.durationMs != null && r.durationMs > 0
      )
      const avgDurationMs =
        withDuration.length > 0
          ? withDuration.reduce((s, r) => s + r.durationMs, 0) / withDuration.length
          : null
      const totalTokens = runs.reduce((s, r) => s + (r.tokensIn ?? 0) + (r.tokensOut ?? 0), 0)
      const withCost = runs.filter((r) => r.costUsd != null)
      const successCount = withCost.filter((r) => r.finishedAt != null).length

      const qualityScores = runs
        .filter(
          (r): r is typeof r & { sprintTaskId: string } =>
            r.sprintTaskId != null && taskQualityMap.has(r.sprintTaskId)
        )
        .map((r) => taskQualityMap.get(r.sprintTaskId) ?? 0)
      const quality =
        qualityScores.length > 0
          ? Math.round(qualityScores.reduce((s, q) => s + q, 0) / qualityScores.length)
          : null

      return {
        name,
        runs: runs.length,
        successPct: runs.length > 0 ? Math.round((successCount / runs.length) * 100) : null,
        avgDurationMs,
        totalTokens,
        quality
      }
    })
    .sort((a, b) => b.runs - a.runs)
    .slice(0, 6)
}

function derivePerRepoStats(agents: AgentCostRecord[]): PerRepoRow[] {
  const sevenDaysAgo = Date.now() - SEVEN_DAYS_MS
  const recent = agents.filter(
    (a) => a.repo != null && new Date(a.startedAt).getTime() >= sevenDaysAgo
  )

  const byRepo = new Map<string, AgentCostRecord[]>()
  for (const a of recent) {
    const repo = a.repo!
    const existing = byRepo.get(repo) ?? []
    existing.push(a)
    byRepo.set(repo, existing)
  }

  return Array.from(byRepo.entries())
    .map(([repo, runs]) => {
      const prs = runs.filter((r) => r.prUrl != null).length
      const merged = runs.filter((r) => r.finishedAt != null && r.prUrl != null).length
      const open = prs - merged
      return { repo, runs: runs.length, prs, merged, open: Math.max(0, open) }
    })
    .sort((a, b) => b.runs - a.runs)
    .slice(0, 6)
}

function deriveAvgCostPerTask(agents: AgentCostRecord[]): number | null {
  const sevenDaysAgo = Date.now() - SEVEN_DAYS_MS
  const recent = agents.filter(
    (a): a is typeof a & { costUsd: number } =>
      a.costUsd != null && new Date(a.startedAt).getTime() >= sevenDaysAgo
  )
  if (recent.length === 0) return null
  return recent.reduce((s, a) => s + a.costUsd, 0) / recent.length
}

export function useDashboardData(): DashboardData {
  const tasks = useSprintTasks((s) => s.tasks)
  const localAgents = useCostDataStore((s) => s.localAgents)
  const setStatusFilter = useSprintFilters((s) => s.setStatusFilter)
  const setSearchQuery = useSprintFilters((s) => s.setSearchQuery)
  const setRepoFilter = useSprintFilters((s) => s.setRepoFilter)
  const setTagFilter = useSprintFilters((s) => s.setTagFilter)
  const setView = usePanelLayoutStore((s) => s.setView)
  const openForCreate = useTaskWorkbenchModalStore((s) => s.openForCreate)
  const drainStatus = useDrainStatus()
  const taskEvents = useSprintEvents((s) => s.taskEvents)

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

  const partitions = useMemo(() => partitionSprintTasks(tasks), [tasks])

  const activeAgents = useMemo(
    () => deriveActiveAgents(partitions.inProgress, taskTokenMap, taskEvents, now),
    [partitions.inProgress, taskTokenMap, taskEvents, now]
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
    () => derivePerAgentStats(localAgents, taskQualityMap),
    [localAgents, taskQualityMap]
  )
  const perRepoStats = useMemo(() => derivePerRepoStats(localAgents), [localAgents])
  const avgCostPerTask = useMemo(() => deriveAvgCostPerTask(localAgents), [localAgents])
  const failureRate = useMemo(() => {
    const terminal = stats.done + stats.actualFailed
    if (terminal === 0) return null
    return Math.round((stats.actualFailed / terminal) * 100)
  }, [stats])

  const briefHeadlineParts = useMemo(
    () => buildBriefHeadlineParts(stats.active, stats.review, stats.actualFailed),
    [stats.active, stats.review, stats.actualFailed]
  )

  const openPipelineView = useCallback(
    (filter?: StatusFilter) => {
      setSearchQuery('')
      setRepoFilter(null)
      setTagFilter(null)
      if (filter) setStatusFilter(filter)
      setView('sprint')
    },
    [setStatusFilter, setSearchQuery, setRepoFilter, setTagFilter, setView]
  )

  const retryTask = useCallback(async (taskId: string): Promise<void> => {
    await window.api.sprint.retry(taskId)
  }, [])

  const openAgentsView = useCallback(() => setView('agents'), [setView])
  const openReviewView = useCallback(() => setView('code-review'), [setView])
  const openPlannerView = useCallback(() => setView('planner'), [setView])
  const openNewTask = useCallback(() => openForCreate(), [openForCreate])

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

  const actions: DashboardActions = {
    openAgentsView,
    openPipelineView,
    openReviewView,
    openPlannerView,
    openNewTask,
    retryTask
  }

  return { metrics, actions }
}
