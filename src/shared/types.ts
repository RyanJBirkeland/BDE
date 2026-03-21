/**
 * Shared types used across main, preload, and renderer processes.
 * Single source of truth — do not redefine these elsewhere.
 */

export interface AgentMeta {
  id: string
  pid: number | null
  bin: string
  model: string
  repo: string
  repoPath: string
  task: string
  startedAt: string
  finishedAt: string | null
  exitCode: number | null
  status: 'running' | 'done' | 'failed' | 'cancelled' | 'unknown'
  logPath: string
  source: 'bde' | 'external'
}

export interface SprintTask {
  id: string
  title: string
  repo: string
  prompt: string | null
  priority: number
  status: 'backlog' | 'queued' | 'active' | 'done' | 'cancelled' | 'failed' | 'error'
  notes: string | null
  spec: string | null
  retry_count: number
  fast_fail_count: number
  agent_run_id: string | null
  pr_number: number | null
  pr_status: 'open' | 'merged' | 'closed' | 'draft' | null
  pr_mergeable_state?: 'clean' | 'dirty' | 'blocked' | 'behind' | 'unstable' | 'unknown' | null
  pr_url: string | null
  claimed_by: string | null
  started_at: string | null
  completed_at: string | null
  template_name: string | null
  updated_at: string
  created_at: string
}

/** Task template — named prompt prefix resolved at claim time. */
export interface TaskTemplate {
  name: string
  promptPrefix: string
  isBuiltIn?: boolean
}

/** A claimed task with an optional template prompt prefix. */
export interface ClaimedTask extends SprintTask {
  templatePromptPrefix: string | null
}

export interface SpawnLocalAgentArgs {
  task: string
  repoPath: string
  model?: string
}

export interface SpawnLocalAgentResult {
  pid: number
  logPath: string
  id: string
  interactive: boolean
}

/** Row shape for agent runs with cost data (DB query result). */
export interface AgentRunCostRow {
  id: string
  task: string
  repo: string
  status: string
  cost_usd: number | null
  tokens_in: number | null
  tokens_out: number | null
  cache_read: number | null
  cache_create: number | null
  duration_ms: number | null
  num_turns: number | null
  started_at: string
  finished_at: string | null
  pr_url: string | null
}

/** Aggregated cost summary for the Claude Code panel. */
export interface CostSummary {
  tasksToday: number
  tasksThisWeek: number
  tasksAllTime: number
  totalTokensThisWeek: number
  avgCostPerTask: number | null
  mostExpensiveTask: { task: string; costUsd: number } | null
}

/** Camel-cased agent cost record returned by cost:getAgentHistory IPC. */
export interface AgentCostRecord {
  id: string
  model: string | null
  startedAt: string
  finishedAt: string | null
  costUsd: number | null
  tokensIn: number | null
  tokensOut: number | null
  cacheRead: number | null
  cacheCreate: number | null
  durationMs: number | null
  numTurns: number | null
  taskTitle: string | null
  prUrl: string | null
  repo: string | null
}

/** Open PR returned by the main-process PR poller. */
export interface OpenPr {
  number: number
  title: string
  html_url: string
  state: string
  draft: boolean
  created_at: string
  updated_at: string
  head: { ref: string; sha: string }
  base: { ref: string }
  user: { login: string }
  merged: boolean
  merged_at: string | null
  repo: string
}

export type CheckStatus = 'pending' | 'pass' | 'fail'

export interface CheckRunSummary {
  status: CheckStatus
  total: number
  passed: number
  failed: number
  pending: number
}

export interface PrListPayload {
  prs: OpenPr[]
  checks: Record<string, CheckRunSummary>
}

/** Source of a unified agent — used by the unified agents store. */
export type UnifiedAgentSource = 'local' | 'history'

/** Status of a unified agent. */
export type UnifiedAgentStatus = 'running' | 'done' | 'failed' | 'cancelled' | 'timeout' | 'unknown'

/** Normalized agent representation across all sources. */
export interface UnifiedAgent {
  id: string
  label: string
  source: UnifiedAgentSource
  status: UnifiedAgentStatus
  model: string
  updatedAt: number
  startedAt: number
  canSteer: boolean
  canKill: boolean
  isBlocked?: boolean
  task?: string
  pid?: number
  sessionKey?: string
  historyId?: string
}

/** A file attachment queued for sending with a chat message. */
export interface Attachment {
  path: string
  name: string
  type: 'image' | 'text'
  /** base64 data URL for image thumbnails / inline rendering */
  preview?: string
  /** Raw base64 data (no data-url prefix) for images */
  data?: string
  /** MIME type for images (e.g. image/png) */
  mimeType?: string
  /** Text content for text files */
  content?: string
}

/** Lightweight result type for expected failures. */
export type Result<T> = { ok: true; data: T } | { ok: false; error: string }
