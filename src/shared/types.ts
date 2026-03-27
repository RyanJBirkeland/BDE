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
  source: 'bde' | 'external' | 'adhoc'
  costUsd: number | null
  tokensIn: number | null
  tokensOut: number | null
  sprintTaskId: string | null
}

export interface TaskDependency {
  id: string
  type: 'hard' | 'soft'
}

export interface SprintTask {
  id: string
  title: string
  repo: string
  prompt: string | null
  priority: number
  status: 'backlog' | 'queued' | 'blocked' | 'active' | 'done' | 'cancelled' | 'failed' | 'error'
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
  depends_on: TaskDependency[] | null
  playground_enabled?: boolean
  max_runtime_ms?: number | null
  spec_type?: string | null
  needs_review?: boolean
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

export interface PrReview {
  id: number
  user: { login: string; avatar_url: string }
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING'
  body: string | null
  submitted_at: string
  html_url: string
}

export interface PrComment {
  id: number
  user: { login: string; avatar_url: string }
  body: string
  created_at: string
  updated_at: string
  html_url: string
  path?: string
  line?: number | null
  original_line?: number | null
  side?: 'LEFT' | 'RIGHT'
  start_line?: number | null
  start_side?: 'LEFT' | 'RIGHT'
  diff_hunk?: string
  in_reply_to_id?: number | null
  pull_request_review_id?: number | null
}

export interface PrIssueComment {
  id: number
  user: { login: string; avatar_url: string }
  body: string
  created_at: string
  html_url: string
}

/** Source of a unified agent — used by the unified agents store. */
export type UnifiedAgentSource = 'local' | 'history'

/** Status of a unified agent. */
export type UnifiedAgentStatus = 'running' | 'done' | 'failed' | 'cancelled' | 'timeout' | 'unknown'

/** Shared fields across all unified agent variants. */
interface UnifiedAgentBase {
  id: string
  label: string
  status: UnifiedAgentStatus
  model: string
  updatedAt: number
  startedAt: number
}

/** A locally-running agent with a live process. */
export interface LocalAgent extends UnifiedAgentBase {
  source: 'local'
  pid: number
  canSteer: boolean
  canKill: boolean
  isBlocked?: boolean
  task?: string
}

/** An agent from CLI history (past or remote). */
export interface HistoryAgent extends UnifiedAgentBase {
  source: 'history'
  historyId: string
  sessionKey?: string
}

/** Discriminated union — narrow via `agent.source`. */
export type UnifiedAgent = LocalAgent | HistoryAgent

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

// --- Agent Events (unified event stream for local + remote agents) ---

export type AgentEventType =
  | 'agent:started'
  | 'agent:text'
  | 'agent:user_message'
  | 'agent:thinking'
  | 'agent:tool_call'
  | 'agent:tool_result'
  | 'agent:rate_limited'
  | 'agent:error'
  | 'agent:stderr'
  | 'agent:completed'
  | 'agent:playground'

export type AgentEvent =
  | { type: 'agent:started'; model: string; timestamp: number }
  | { type: 'agent:text'; text: string; timestamp: number }
  | { type: 'agent:user_message'; text: string; timestamp: number }
  | { type: 'agent:thinking'; tokenCount: number; text?: string; timestamp: number }
  | { type: 'agent:tool_call'; tool: string; summary: string; input?: unknown; timestamp: number }
  | {
      type: 'agent:tool_result'
      tool: string
      success: boolean
      summary: string
      output?: unknown
      timestamp: number
    }
  | { type: 'agent:rate_limited'; retryDelayMs: number; attempt: number; timestamp: number }
  | { type: 'agent:error'; message: string; timestamp: number }
  | { type: 'agent:stderr'; text: string; timestamp: number }
  | {
      type: 'agent:completed'
      exitCode: number
      costUsd: number
      tokensIn: number
      tokensOut: number
      durationMs: number
      timestamp: number
    }
  | {
      type: 'agent:playground'
      filename: string
      html: string
      sizeBytes: number
      timestamp: number
    }

// --- Agent Provider Interface ---

export interface AgentSpawnOptions {
  prompt: string
  workingDirectory: string
  model?: string
  maxTokens?: number
  templatePrefix?: string
  agentId?: string
}

export interface AgentHandle {
  id: string
  pid?: number
  logPath?: string
  events: AsyncIterable<AgentEvent>
  steer(message: string): Promise<void>
  stop(): Promise<void>
}

export interface AgentProvider {
  spawn(opts: AgentSpawnOptions): Promise<AgentHandle>
}
