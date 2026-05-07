// Pure derivation helpers for the Dashboard. No React, no stores — easy to
// unit-test in isolation.

import { describeAgentStep } from '../../../lib/describeAgentStep'
import { MS_PER_HOUR, MS_PER_DAY } from '../../../lib/constants'
import type { AnyTaskEvent } from '../../../stores/sprintEvents'
import type { SprintTask } from '../../../../../shared/types'
import type { AgentCostRecord } from '../../../../../shared/types/agent-types'
import type { SprintPartition } from '../../../lib/partitionSprintTasks'

const STALE_REVIEW_THRESHOLD_MS = 2 * MS_PER_HOUR
const SEVEN_DAYS_MS = 7 * MS_PER_DAY

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

export function buildBriefHeadlineParts(
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

export function deriveAttentionItems(
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
        sub: `PR waiting ${Math.floor(ageMs / MS_PER_HOUR)}h, no decision`,
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

export function deriveActiveAgents(
  inProgress: SprintTask[],
  taskTokenMap: Map<string, number>,
  latestEventByTaskId: Record<string, AnyTaskEvent | undefined>,
  now: number
): ActiveAgent[] {
  return inProgress.slice(0, 5).map((task) => {
    const startedMs = task.started_at ? new Date(task.started_at).getTime() : now
    const elapsedMs = now - startedMs
    const progressPct =
      task.max_runtime_ms != null
        ? Math.min(100, Math.round((elapsedMs / task.max_runtime_ms) * 100))
        : null
    return {
      id: task.id,
      title: task.title,
      repo: task.repo,
      tokens: taskTokenMap.get(task.id) ?? 0,
      elapsedMs,
      progressPct,
      startedAt: task.started_at ?? null,
      stepDescription: describeAgentStep(latestEventByTaskId[task.id])
    }
  })
}

export function derivePerAgentStats(
  agents: AgentCostRecord[],
  taskQualityMap: Map<string, number>,
  cutoffTimestamp: number = Date.now() - SEVEN_DAYS_MS
): PerAgentRow[] {
  const recent = agents.filter((a) => new Date(a.startedAt).getTime() >= cutoffTimestamp)

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

export function derivePerRepoStats(
  agents: AgentCostRecord[],
  cutoffTimestamp: number = Date.now() - SEVEN_DAYS_MS
): PerRepoRow[] {
  const recent = agents.filter(
    (a) => a.repo != null && new Date(a.startedAt).getTime() >= cutoffTimestamp
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

export function deriveAvgCostPerTask(
  agents: AgentCostRecord[],
  cutoffTimestamp: number = Date.now() - SEVEN_DAYS_MS
): number | null {
  const recent = agents.filter(
    (a): a is typeof a & { costUsd: number } =>
      a.costUsd != null && new Date(a.startedAt).getTime() >= cutoffTimestamp
  )
  if (recent.length === 0) return null
  return recent.reduce((s, a) => s + a.costUsd, 0) / recent.length
}
