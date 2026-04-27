import { join } from 'node:path'
import { homedir } from 'node:os'
import type { IAgentTaskRepository } from '../data/sprint-task-repository'
import type { Logger } from '../logger'
import type { TaskStatus } from '../../shared/task-state-machine'

/**
 * Conceptual parameters for resolveDependents() orchestration.
 * Used to document the coupling between agent-manager and task-terminal-service.
 * Both modules resolve blocked dependents but with different orchestration strategies.
 */
export interface ResolveDependentsParams {
  taskId: string
  terminalStatus: TaskStatus
  repo: IAgentTaskRepository
  logger: Logger
}

export interface AgentManagerConfig {
  maxConcurrent: number
  worktreeBase: string
  maxRuntimeMs: number
  idleTimeoutMs: number
  pollIntervalMs: number
  defaultModel: string
  onStatusTerminal?: (taskId: string, status: TaskStatus) => void
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
export const RETRY_BACKOFF_BASE_MS = 30_000
export const RETRY_BACKOFF_CAP_MS = 5 * 60_000
export const GIT_FETCH_TIMEOUT_MS = 30_000
export const GIT_FF_MERGE_TIMEOUT_MS = 10_000
export const BRANCH_SLUG_MAX_LENGTH = 40
export const LAST_OUTPUT_MAX_LENGTH = 500
export const AGENT_SUMMARY_MAX_LENGTH = 300
export const NOTES_MAX_LENGTH = 500

/**
 * How long the drain loop pauses after an environmental failure
 * (main-repo dirty, auth missing, network). A pause buys the user
 * time to fix the environment without the scheduler burning every
 * queued task to `error` status.
 */
export const DRAIN_PAUSE_ON_ENV_ERROR_MS = 30_000

export interface SteerResult {
  delivered: boolean
  error?: string
}

export interface AgentHandle {
  messages: AsyncIterable<unknown>
  sessionId: string
  abort(): void
  /**
   * Force-terminate the agent immediately, bypassing the soft-abort
   * graceful-exit window. Optional: spawn paths that have a process handle
   * (CLI, opencode) implement SIGKILL; SDK paths fall back to abort().
   * The watchdog escalates to forceKill after a soft-kill grace window —
   * see `killAgentWithEscalation` in `watchdog-loop.ts`.
   */
  forceKill?(): void
  steer(message: string): Promise<SteerResult>
  /** Optional callback invoked with each line of stderr output. */
  onStderr?: (line: string) => void
  /**
   * Populated by `spawnAgent` to record which backend actually ran this
   * session: `'claude'` for the built-in SDK/CLI path, `'local'` when
   * routed through the rbt-coding-agent framework. Persisted to agent_runs
   * + agent_events so the UI can display the real backend rather than a
   * hardcoded default.
   */
  readonly backend?: 'claude' | 'local'
  /**
   * The model string actually passed to the underlying backend, which may
   * differ from the caller-supplied value when the backend-selector
   * overrides per-agent-type settings.
   */
  readonly resolvedModel?: string
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
  maxCostUsd: number | null
  worktreePath: string
  branch: string
}

/**
 * Describes which transport will execute the agent spawn.
 * The SDK path is preferred; the CLI path is a fallback when the SDK package
 * is absent from the runtime environment.
 */
export type SpawnStrategy = { type: 'sdk' } | { type: 'cli'; claudePath: string }

// Watchdog verdict types
export type WatchdogCheck =
  | 'ok'
  | 'idle'
  | 'max-runtime'
  | 'rate-limit-loop'
  | 'cost-budget-exceeded'
export type WatchdogAction = Exclude<WatchdogCheck, 'ok'>
