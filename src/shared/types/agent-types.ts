/**
 * Agent-related types — spawning, lifecycle, events, and status.
 */

export type AgentType = 'pipeline' | 'assistant' | 'adhoc' | 'copilot' | 'synthesizer' | 'reviewer'

export type PlaygroundContentType = 'html' | 'svg' | 'markdown' | 'json'

export const PLAYGROUND_CONTENT_TYPE_LABELS: Record<PlaygroundContentType, string> = {
  html: 'HTML',
  svg: 'SVG',
  markdown: 'Markdown',
  json: 'JSON'
}

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
  cacheRead?: number | null
  cacheCreate?: number | null
  sprintTaskId: string | null
  /**
   * Absolute path to the agent's git worktree.
   * - Adhoc agents: always set (every adhoc spawn creates a worktree).
   * - Pipeline agents: set to the pipeline worktree.
   * - Legacy / external imports: undefined.
   *
   * Optional in the type so older test fixtures and JSON imports don't have
   * to be backfilled — `agent-queries.rowToMeta` always normalizes the DB
   * column to `string | null`, but constructors may omit it.
   */
  worktreePath?: string | null
  /** Git branch the agent is committing to. Same optionality rules as `worktreePath`. */
  branch?: string | null
}

export interface SpawnLocalAgentArgs {
  task: string
  repoPath: string
  assistant?: boolean | undefined
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

/** Camel-cased summary of an agent run with cost data, returned by cost:getRecentRuns IPC. */
export interface AgentRunSummary {
  id: string
  task: string
  repo: string
  status: string
  costUsd: number | null
  tokensIn: number | null
  tokensOut: number | null
  cacheRead: number | null
  cacheCreate: number | null
  durationMs: number | null
  numTurns: number | null
  startedAt: string
  finishedAt: string | null
  prUrl: string | null
}

/** Aggregated cost summary for the Claude Code panel. */
export interface CostSummary {
  tasksToday: number
  tasksThisWeek: number
  tasksAllTime: number
  totalTokensThisWeek: number
  avgTokensPerTask: number | null
  mostTokenIntensiveTask: { task: string; totalTokens: number } | null
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
  sprintTaskId: string | null
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
  isBlocked?: boolean | undefined
  task?: string | undefined
}

/** An agent from CLI history (past or remote). */
export interface HistoryAgent extends UnifiedAgentBase {
  source: 'history'
  historyId: string
  sessionKey?: string | undefined
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

// --- Agent Manager status types (shared so renderer can read typed status) ---

export interface AgentManagerConcurrencyState {
  maxSlots: number
  capacityAfterBackpressure: number
  activeCount: number
  recoveryScheduledAt: number | null
  consecutiveRateLimits: number
  atMinimumCapacity: boolean
}

export interface AgentManagerActiveAgent {
  taskId: string
  agentRunId: string
  model: string
  startedAt: number
  lastOutputAt: number
  rateLimitCount: number
  costUsd: number
  tokensIn: number
  tokensOut: number
}

export interface AgentManagerStatus {
  running: boolean
  shuttingDown: boolean
  concurrency: AgentManagerConcurrencyState
  activeAgents: AgentManagerActiveAgent[]
}

export interface MetricsSnapshot {
  drainLoopCount: number
  agentsSpawned: number
  agentsCompleted: number
  agentsFailed: number
  retriesQueued: number
  watchdogVerdicts: Record<string, number>
  lastDrainDurationMs: number
  uptimeMs: number
}

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
      contentType: PlaygroundContentType
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
