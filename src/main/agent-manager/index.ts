import type { AgentManagerConfig, ActiveAgent, SteerResult, Logger } from './types'
import {
  EXECUTOR_ID,
  WATCHDOG_INTERVAL_MS,
  ORPHAN_CHECK_INTERVAL_MS,
  WORKTREE_PRUNE_INTERVAL_MS,
  INITIAL_DRAIN_DEFER_MS,
  NOTES_MAX_LENGTH
} from './types'
import {
  makeConcurrencyState,
  availableSlots,
  applyBackpressure,
  tryRecover,
  type ConcurrencyState
} from './concurrency'
import { checkAgent } from './watchdog'
import { setupWorktree, pruneStaleWorktrees } from './worktree'
import { recoverOrphans } from './orphan-recovery'
import { createDependencyIndex } from './dependency-index'
import { formatBlockedNote } from './dependency-helpers'
import { resolveDependents } from './resolve-dependents'
import { runAgent as _runAgent, type RunAgentDeps, type RunAgentTask } from './run-agent'
import { setSprintQueriesLogger } from '../data/sprint-queries'
import type { ISprintTaskRepository } from '../data/sprint-task-repository'
import { getRepoPaths } from '../paths'
import { refreshOAuthTokenFromKeychain, invalidateOAuthToken } from '../env-utils'

// ---------------------------------------------------------------------------
// Logger helper — callers can supply their own or fall back to console
// ---------------------------------------------------------------------------

import { appendFileSync, readFileSync, statSync, renameSync, rmSync } from 'node:fs'
import { join as joinPath } from 'node:path'
import { homedir as home } from 'node:os'
import { BDE_AGENT_LOG_PATH } from '../paths'
const LOG_PATH = BDE_AGENT_LOG_PATH
const AM_MAX_LOG_SIZE = 10 * 1024 * 1024 // 10MB
let amWriteCount = 0
let fileLogFailureCount = 0

function rotateAmLogIfNeeded(): void {
  try {
    const stats = statSync(LOG_PATH)
    if (stats.size > AM_MAX_LOG_SIZE) {
      const oldPath = LOG_PATH + '.old'
      try { rmSync(oldPath) } catch { /* may not exist */ }
      renameSync(LOG_PATH, oldPath)
    }
  } catch { /* file doesn't exist yet */ }
}

function fileLog(level: string, m: string): void {
  try {
    appendFileSync(LOG_PATH, `[${new Date().toISOString()}] [${level}] ${m}\n`)
    fileLogFailureCount = 0 // Reset on successful write
    if (++amWriteCount >= 500) {
      amWriteCount = 0
      rotateAmLogIfNeeded()
    }
  } catch (err) {
    // Count consecutive failures and log to stderr after threshold
    fileLogFailureCount++
    if (fileLogFailureCount === 5) {
      console.error(`[agent-manager] File logging failed 5 times consecutively: ${err}`)
      console.error(`[agent-manager] Log path: ${LOG_PATH} — check disk space and permissions`)
    }
  }
}

const defaultLogger: Logger = {
  info: (m) => {
    console.log(m)
    fileLog('INFO', m)
  },
  warn: (m) => {
    console.warn(m)
    fileLog('WARN', m)
  },
  error: (m) => {
    console.error(m)
    fileLog('ERROR', m)
  }
}

// ---------------------------------------------------------------------------
// Extracted pure functions (testable independently)
// ---------------------------------------------------------------------------

/**
 * Check whether the OAuth token file exists and contains a valid token.
 * Returns true if the drain loop should proceed, false if it should skip.
 */
export async function checkOAuthToken(logger: Logger): Promise<boolean> {
  try {
    const tokenPath = joinPath(home(), '.bde', 'oauth-token')
    const token = readFileSync(tokenPath, 'utf-8').trim()
    if (!token || token.length < 20) {
      const refreshed = await refreshOAuthTokenFromKeychain()
      if (refreshed) {
        logger.info('[agent-manager] OAuth token auto-refreshed from Keychain')
        return true
      } else {
        logger.warn(
          '[agent-manager] OAuth token file missing/empty and keychain refresh failed — skipping drain cycle'
        )
        return false
      }
    }

    // Proactively refresh if token file is older than 45 minutes
    // (Claude OAuth tokens expire after ~1 hour)
    try {
      const stat = statSync(tokenPath)
      const ageMs = Date.now() - stat.mtimeMs
      if (ageMs > 45 * 60 * 1000) {
        logger.info('[agent-manager] Token file older than 45min — proactively refreshing')
        const refreshed = await refreshOAuthTokenFromKeychain()
        if (refreshed) {
          invalidateOAuthToken()
          logger.info('[agent-manager] OAuth token proactively refreshed from Keychain')
        }
      }
    } catch {
      /* stat failed — continue with existing token */
    }

    return true
  } catch {
    logger.warn('[agent-manager] Cannot read OAuth token file — skipping drain cycle')
    return false
  }
}

export type WatchdogVerdict = 'max-runtime' | 'idle' | 'rate-limit-loop'

/**
 * Handle a watchdog verdict by updating the task and optionally applying backpressure.
 * Returns the (possibly updated) concurrency state.
 */
export function handleWatchdogVerdict(
  verdict: WatchdogVerdict,
  taskId: string,
  concurrency: ConcurrencyState,
  now: string,
  updateTaskFn: (id: string, patch: Record<string, unknown>) => unknown,
  onTerminal: (id: string, status: string) => Promise<void>,
  logger: Logger,
  maxRuntimeMs?: number
): ConcurrencyState {
  if (verdict === 'max-runtime') {
    const runtimeMinutes = maxRuntimeMs ? Math.round(maxRuntimeMs / 60000) : 60
    try {
      updateTaskFn(taskId, {
        status: 'error',
        completed_at: now,
        notes: `Agent exceeded the maximum runtime of ${runtimeMinutes} minutes. The task may be too large for a single agent session. Consider breaking it into smaller subtasks.`,
        needs_review: true
      })
      onTerminal(taskId, 'error').catch((err) =>
        logger.warn(
          `[agent-manager] Failed onTerminal for task ${taskId} after max-runtime kill: ${err}`
        )
      )
    } catch (err) {
      logger.warn(
        `[agent-manager] Failed to update task ${taskId} after max-runtime kill: ${err}`
      )
    }
  } else if (verdict === 'idle') {
    try {
      updateTaskFn(taskId, {
        status: 'error',
        completed_at: now,
        notes: 'Agent produced no output for 15 minutes. The agent may be stuck or rate-limited. Check agent events for the last activity. To retry: reset task status to \'queued\'.',
        needs_review: true
      })
      onTerminal(taskId, 'error').catch((err) =>
        logger.warn(`[agent-manager] Failed onTerminal for task ${taskId} after idle kill: ${err}`)
      )
    } catch (err) {
      logger.warn(`[agent-manager] Failed to update task ${taskId} after idle kill: ${err}`)
    }
  } else if (verdict === 'rate-limit-loop') {
    concurrency = applyBackpressure(concurrency, Date.now())
    try {
      updateTaskFn(taskId, {
        status: 'queued',
        claimed_by: null,
        notes: 'Rate-limit loop — re-queued'
      })
    } catch (err) {
      logger.warn(`[agent-manager] Failed to requeue rate-limited task ${taskId}: ${err}`)
    }
  }
  return concurrency
}

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface AgentManagerStatus {
  running: boolean
  shuttingDown: boolean
  concurrency: ConcurrencyState
  activeAgents: Array<{
    taskId: string
    agentRunId: string
    model: string
    startedAt: number
    lastOutputAt: number
    rateLimitCount: number
    costUsd: number
    tokensIn: number
    tokensOut: number
  }>
}

export interface AgentManager {
  start(): void
  stop(timeoutMs?: number): Promise<void>
  getStatus(): AgentManagerStatus
  steerAgent(taskId: string, message: string): Promise<SteerResult>
  killAgent(taskId: string): void
  onTaskTerminal(taskId: string, status: string): Promise<void>
}

// ---------------------------------------------------------------------------
// Class implementation
// ---------------------------------------------------------------------------

import type { DependencyIndex } from './dependency-index'

export class AgentManagerImpl implements AgentManager {
  // Exposed state (testable via _ prefix)
  _concurrency: ConcurrencyState
  readonly _activeAgents = new Map<string, ActiveAgent>()
  readonly _processingTasks = new Set<string>()
  _running = false
  _shuttingDown = false
  _drainInFlight: Promise<void> | null = null
  readonly _agentPromises = new Set<Promise<void>>()
  readonly _depIndex: DependencyIndex

  // Private timers
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private watchdogTimer: ReturnType<typeof setInterval> | null = null
  private orphanTimer: ReturnType<typeof setInterval> | null = null
  private pruneTimer: ReturnType<typeof setInterval> | null = null

  // Injected deps
  private readonly runAgentDeps: RunAgentDeps

  constructor(
    readonly config: AgentManagerConfig,
    readonly repo: ISprintTaskRepository,
    readonly logger: Logger = defaultLogger
  ) {
    rotateAmLogIfNeeded()

    this._concurrency = makeConcurrencyState(config.maxConcurrent)
    this._depIndex = createDependencyIndex()

    // Wire sprint-queries to use the same structured file logger as the agent manager
    setSprintQueriesLogger(logger)

    // Build runAgentDeps with bound onTaskTerminal
    this.runAgentDeps = {
      activeAgents: this._activeAgents,
      defaultModel: config.defaultModel,
      logger,
      onTaskTerminal: this.onTaskTerminal.bind(this),
      repo
    }
  }

  // ---- Helpers ----

  private fetchQueuedTasks(limit: number): Array<Record<string, unknown>> {
    return this.repo.getQueuedTasks(limit) as unknown as Array<Record<string, unknown>>
  }

  private claimTaskViaApi(taskId: string): boolean {
    return this.repo.claimTask(taskId, EXECUTOR_ID) !== null
  }

  async onTaskTerminal(taskId: string, status: string): Promise<void> {
    if (this.config.onStatusTerminal) {
      this.config.onStatusTerminal(taskId, status)
    } else {
      try {
        resolveDependents(taskId, status, this._depIndex, this.repo.getTask, this.repo.updateTask, this.logger)
      } catch (err) {
        this.logger.error(`[agent-manager] resolveDependents failed for ${taskId}: ${err}`)
      }
    }
  }

  private resolveRepoPath(repoSlug: string): string | null {
    const repoPaths = getRepoPaths()
    return repoPaths[repoSlug.toLowerCase()] ?? null
  }

  // ---- processQueuedTask helpers ----

  /**
   * Map Queue API camelCase response to local task shape.
   * Ensures retry_count and fast_fail_count default to 0, prompt and spec default to null.
   */
  _mapQueuedTask(raw: Record<string, unknown>) {
    return {
      id: raw.id as string,
      title: raw.title as string,
      prompt: (raw.prompt as string) ?? null,
      spec: (raw.spec as string) ?? null,
      repo: raw.repo as string,
      retry_count: Number(raw.retryCount) || 0,
      fast_fail_count: Number(raw.fastFailCount) || 0,
      playground_enabled: Boolean(raw.playgroundEnabled),
      max_runtime_ms: Number(raw.maxRuntimeMs) || null
    }
  }

  /**
   * Defense-in-depth: check dependencies before claiming.
   * Tasks created via direct API may be 'queued' with unsatisfied deps.
   * Returns true if the task was blocked (caller should return early), false to continue.
   */
  _checkAndBlockDeps(
    taskId: string,
    rawDeps: unknown,
    taskStatusMap: Map<string, string>
  ): boolean {
    try {
      const deps = typeof rawDeps === 'string' ? JSON.parse(rawDeps) : rawDeps
      if (Array.isArray(deps) && deps.length > 0) {
        const { satisfied, blockedBy } = this._depIndex.areDependenciesSatisfied(
          taskId,
          deps,
          (depId: string) => taskStatusMap.get(depId)
        )
        if (!satisfied) {
          this.logger.info(
            `[agent-manager] Task ${taskId} has unsatisfied deps [${blockedBy.join(', ')}] — auto-blocking`
          )
          try {
            this.repo.updateTask(taskId, {
              status: 'blocked',
              notes: formatBlockedNote(blockedBy)
            })
          } catch { /* best-effort */ }
          return true
        }
      }
    } catch {
      // If dep parsing fails, proceed without blocking
    }
    return false
  }

  /**
   * Fire-and-forget agent spawn — errors logged inside runAgent.
   */
  _spawnAgent(
    task: RunAgentTask,
    wt: { worktreePath: string; branch: string },
    repoPath: string
  ): void {
    const p = _runAgent(task, wt, repoPath, this.runAgentDeps)
      .catch((err) => {
        this.logger.error(`[agent-manager] runAgent failed for task ${task.id}: ${err}`)
      })
      .finally(() => {
        this._agentPromises.delete(p)
      })
    this._agentPromises.add(p)
  }

  // ---- processQueuedTask ----

  async _processQueuedTask(
    raw: Record<string, unknown>,
    taskStatusMap: Map<string, string>
  ): Promise<void> {
    const taskId = raw.id as string
    if (this._processingTasks.has(taskId)) return
    this._processingTasks.add(taskId)
    try {
      const task = this._mapQueuedTask(raw)

      const rawDeps = raw.dependsOn ?? raw.depends_on
      if (rawDeps && this._checkAndBlockDeps(task.id, rawDeps, taskStatusMap)) return

      const repoPath = this.resolveRepoPath(task.repo)
      if (!repoPath) {
        this.logger.warn(`[agent-manager] No repo path for "${task.repo}" — skipping task ${task.id}`)
        return
      }

      const claimed = this.claimTaskViaApi(task.id)
      if (!claimed) {
        this.logger.info(`[agent-manager] Task ${task.id} already claimed — skipping`)
        return
      }

      let wt: { worktreePath: string; branch: string }
      try {
        wt = await setupWorktree({
          repoPath,
          worktreeBase: this.config.worktreeBase,
          taskId: task.id,
          title: task.title,
          logger: this.logger
        })
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        this.logger.error(`[agent-manager] setupWorktree failed for task ${task.id}: ${errMsg}`)
        // For git errors, keep the tail of the message (contains key diagnostic info)
        const fullNote = `Worktree setup failed: ${errMsg}`
        const notes = fullNote.length > NOTES_MAX_LENGTH
          ? '...' + fullNote.slice(-(NOTES_MAX_LENGTH - 3))
          : fullNote
        this.repo.updateTask(task.id, {
          status: 'error',
          completed_at: new Date().toISOString(),
          notes,
          claimed_by: null
        })
        await this.onTaskTerminal(task.id, 'error')
        return
      }

      this._spawnAgent(task, wt, repoPath)
    } finally {
      this._processingTasks.delete(taskId)
    }
  }

  // ---- drainLoop ----

  async _drainLoop(): Promise<void> {
    // Note: concurrency guard is handled by caller via _drainInFlight check
    this.logger.info(
      `[agent-manager] Drain loop starting (shuttingDown=${this._shuttingDown}, slots=${availableSlots(this._concurrency, this._activeAgents.size)})`
    )
    if (this._shuttingDown) return

    // Refresh dependency index each drain cycle to pick up tasks created
    // since startup or since the last drain. Rebuild is O(n) and cheap.
    let taskStatusMap = new Map<string, string>()
    try {
      const allTasks = this.repo.getTasksWithDependencies()
      this._depIndex.rebuild(allTasks)
      taskStatusMap = new Map(allTasks.map((t) => [t.id, t.status]))
    } catch (err) {
      this.logger.warn(`[agent-manager] Failed to refresh dependency index: ${err}`)
    }

    const available = availableSlots(this._concurrency, this._activeAgents.size)
    if (available <= 0) return

    try {
      const tokenOk = await checkOAuthToken(this.logger)
      if (!tokenOk) return

      this.logger.info(`[agent-manager] Fetching queued tasks via Queue API (limit=${available})...`)
      const queued = this.fetchQueuedTasks(available)
      this.logger.info(`[agent-manager] Found ${queued.length} queued tasks`)
      for (const raw of queued) {
        if (this._shuttingDown) break
        // Re-check slots before each task — an earlier iteration may have filled a slot
        if (availableSlots(this._concurrency, this._activeAgents.size) <= 0) {
          this.logger.info('[agent-manager] No slots available — stopping drain iteration')
          break
        }
        try {
          await this._processQueuedTask(raw, taskStatusMap)
        } catch (err) {
          this.logger.error(
            `[agent-manager] Failed to process task ${(raw as Record<string, unknown>).id}: ${err}`
          )
        }
      }
    } catch (err) {
      this.logger.error(`[agent-manager] Drain loop error: ${err}`)
    }

    this._concurrency = tryRecover(this._concurrency, Date.now())
  }

  // ---- watchdogLoop ----

  _watchdogLoop(): void {
    for (const agent of this._activeAgents.values()) {
      if (this._processingTasks.has(agent.taskId)) continue
      const verdict = checkAgent(agent, Date.now(), this.config)
      if (verdict === 'ok') continue

      this.logger.warn(`[agent-manager] Watchdog killing task ${agent.taskId}: ${verdict}`)
      try {
        agent.handle.abort()
      } catch (err) {
        this.logger.warn(`[agent-manager] Failed to abort agent ${agent.taskId}: ${err}`)
      }

      // Delete agent — activeCount is derived from activeAgents.size
      this._activeAgents.delete(agent.taskId)

      // Update task based on verdict
      const now = new Date().toISOString()
      const maxRuntimeMs = agent.maxRuntimeMs ?? this.config.maxRuntimeMs
      this._concurrency = handleWatchdogVerdict(
        verdict,
        agent.taskId,
        this._concurrency,
        now,
        this.repo.updateTask,
        this.onTaskTerminal.bind(this),
        this.logger,
        maxRuntimeMs
      )
    }
  }

  // ---- orphanLoop ----

  private async _orphanLoop(): Promise<void> {
    try {
      await recoverOrphans((id: string) => this._activeAgents.has(id), this.repo, this.logger)
    } catch (err) {
      this.logger.error(`[agent-manager] Orphan recovery error: ${err}`)
    }
  }

  // ---- pruneLoop ----

  private async _pruneLoop(): Promise<void> {
    try {
      await pruneStaleWorktrees(this.config.worktreeBase, (id: string) => this._activeAgents.has(id), this.logger)
    } catch (err) {
      this.logger.error(`[agent-manager] Worktree prune error: ${err}`)
    }
  }

  // ---- Public methods ----

  start(): void {
    if (this._running) return
    this._running = true
    this._shuttingDown = false
    this._concurrency = makeConcurrencyState(this.config.maxConcurrent)

    // Initial orphan recovery (fire-and-forget)
    recoverOrphans((id: string) => this._activeAgents.has(id), this.repo, this.logger).catch((err) => {
      this.logger.error(`[agent-manager] Initial orphan recovery error: ${err}`)
    })

    // Build dependency index
    try {
      const tasks = this.repo.getTasksWithDependencies()
      this._depIndex.rebuild(tasks)
      this.logger.info(`[agent-manager] Dependency index built with ${tasks.length} tasks`)
    } catch (err) {
      this.logger.error(`[agent-manager] Failed to build dependency index: ${err}`)
    }

    // Initial worktree prune (fire-and-forget)
    pruneStaleWorktrees(this.config.worktreeBase, (id: string) => this._activeAgents.has(id), this.logger).catch((err) => {
      this.logger.error(`[agent-manager] Initial worktree prune error: ${err}`)
    })

    // Start periodic loops
    this.pollTimer = setInterval(() => {
      if (this._drainInFlight) return // skip if previous drain still running
      this._drainInFlight = this._drainLoop()
        .catch((err) => this.logger.warn(`[agent-manager] Drain loop error: ${err}`))
        .finally(() => {
          this._drainInFlight = null
        })
    }, this.config.pollIntervalMs)
    this.watchdogTimer = setInterval(() => this._watchdogLoop(), WATCHDOG_INTERVAL_MS)
    this.orphanTimer = setInterval(() => {
      this._orphanLoop().catch((err) => this.logger.warn(`[agent-manager] Orphan loop error: ${err}`))
    }, ORPHAN_CHECK_INTERVAL_MS)
    this.pruneTimer = setInterval(() => {
      this._pruneLoop().catch((err) => this.logger.warn(`[agent-manager] Prune loop error: ${err}`))
    }, WORKTREE_PRUNE_INTERVAL_MS)

    // Defer initial drain to let the event loop settle
    setTimeout(() => {
      this._drainInFlight = this._drainLoop()
        .catch((err) => this.logger.warn(`[agent-manager] Initial drain error: ${err}`))
        .finally(() => {
          this._drainInFlight = null
        })
    }, INITIAL_DRAIN_DEFER_MS)

    this.logger.info('[agent-manager] Started')
  }

  async stop(timeoutMs = 10_000): Promise<void> {
    this._shuttingDown = true

    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer)
      this.watchdogTimer = null
    }
    if (this.orphanTimer) {
      clearInterval(this.orphanTimer)
      this.orphanTimer = null
    }
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer)
      this.pruneTimer = null
    }

    // Wait for any in-flight drain to complete before aborting agents
    if (this._drainInFlight) {
      await this._drainInFlight.catch(() => {})
      this._drainInFlight = null
    }

    // Abort all active agents
    for (const agent of this._activeAgents.values()) {
      try {
        agent.handle.abort()
      } catch (err) {
        this.logger.warn(`[agent-manager] Failed to abort agent ${agent.taskId} during shutdown: ${err}`)
      }
    }

    // Wait for all agent promises to settle (with timeout)
    if (this._agentPromises.size > 0) {
      const allSettled = Promise.allSettled([...this._agentPromises])
      const timeout = new Promise<void>((r) => setTimeout(r, timeoutMs))
      await Promise.race([allSettled, timeout])
    }

    // Re-queue any tasks that are still active after agent shutdown
    for (const agent of this._activeAgents.values()) {
      try {
        this.repo.updateTask(agent.taskId, {
          status: 'queued',
          claimed_by: null,
          started_at: null,
          notes: 'Task was re-queued due to BDE shutdown while agent was running.'
        })
        this.logger.info(`[agent-manager] Re-queued task ${agent.taskId} during shutdown`)
      } catch (err) {
        this.logger.warn(`[agent-manager] Failed to re-queue task ${agent.taskId}: ${err}`)
      }
    }
    this._activeAgents.clear()

    this._running = false
    this.logger.info('[agent-manager] Stopped')
  }

  getStatus(): AgentManagerStatus {
    return {
      running: this._running,
      shuttingDown: this._shuttingDown,
      concurrency: { ...this._concurrency, activeCount: this._activeAgents.size },
      activeAgents: [...this._activeAgents.values()].map((a) => ({
        taskId: a.taskId,
        agentRunId: a.agentRunId,
        model: a.model,
        startedAt: a.startedAt,
        lastOutputAt: a.lastOutputAt,
        rateLimitCount: a.rateLimitCount,
        costUsd: a.costUsd,
        tokensIn: a.tokensIn,
        tokensOut: a.tokensOut
      }))
    }
  }

  async steerAgent(taskId: string, message: string): Promise<SteerResult> {
    // Validate message size (max 10KB)
    if (message.length > 10_000) {
      return { delivered: false, error: 'Message exceeds 10KB limit' }
    }

    const agent = this._activeAgents.get(taskId)
    if (!agent) return { delivered: false, error: 'Agent not found' }
    return agent.handle.steer(message)
  }

  killAgent(taskId: string): void {
    const agent = this._activeAgents.get(taskId)
    if (!agent) throw new Error(`No active agent for task ${taskId}`)
    agent.handle.abort()
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createAgentManager(
  config: AgentManagerConfig,
  repo: ISprintTaskRepository,
  logger: Logger = defaultLogger
): AgentManager {
  return new AgentManagerImpl(config, repo, logger)
}
