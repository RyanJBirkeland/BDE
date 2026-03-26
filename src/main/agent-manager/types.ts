import { join } from 'node:path'
import { homedir } from 'node:os'
export interface AgentManagerConfig {
  maxConcurrent: number
  worktreeBase: string
  maxRuntimeMs: number
  idleTimeoutMs: number
  pollIntervalMs: number
  defaultModel: string
}

export const DEFAULT_CONFIG: AgentManagerConfig = {
  maxConcurrent: 2,
  worktreeBase: join(homedir(), 'worktrees', 'bde'),
  maxRuntimeMs: 60 * 60 * 1000,
  idleTimeoutMs: 15 * 60 * 1000,
  pollIntervalMs: 30_000,
  defaultModel: 'claude-sonnet-4-5'
}

export const EXECUTOR_ID = 'bde-embedded'
export const MAX_RETRIES = 3
export const MAX_FAST_FAILS = 3
export const FAST_FAIL_THRESHOLD_MS = 30_000
export const RATE_LIMIT_LOOP_THRESHOLD = 10
export const WATCHDOG_INTERVAL_MS = 10_000
export const SIGTERM_GRACE_MS = 5_000
export const RATE_LIMIT_COOLDOWN_MS = 60_000
export const ORPHAN_CHECK_INTERVAL_MS = 60_000
export const WORKTREE_PRUNE_INTERVAL_MS = 5 * 60 * 1000
export const SPAWN_TIMEOUT_MS = 60_000
export const QUEUE_TIMEOUT_MS = 10_000
export const INITIAL_DRAIN_DEFER_MS = 5_000
export const BRANCH_SLUG_MAX_LENGTH = 40
export const LAST_OUTPUT_MAX_LENGTH = 500
export const AGENT_SUMMARY_MAX_LENGTH = 300
export const NOTES_MAX_LENGTH = 500

export interface SteerResult {
  delivered: boolean
  error?: string
}

export interface AgentHandle {
  messages: AsyncIterable<unknown>
  sessionId: string
  abort(): void
  steer(message: string): Promise<SteerResult>
  /** Optional callback invoked with each line of stderr output. */
  onStderr?: (line: string) => void
}

export interface ActiveAgent {
  taskId: string
  agentRunId: string
  handle: AgentHandle
  model: string
  startedAt: number
  lastOutputAt: number
  rateLimitCount: number
  costUsd: number
  tokensIn: number
  tokensOut: number
  maxRuntimeMs: number | null
}

export interface Logger {
  info(msg: string): void
  warn(msg: string): void
  error(msg: string): void
}
