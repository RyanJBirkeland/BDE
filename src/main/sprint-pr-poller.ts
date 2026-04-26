/**
 * Main-process timer that polls PR statuses for sprint tasks.
 * Runs independently of the renderer — ensures PR merges/closes
 * are detected even when no BDE window is open.
 */
import { parsePrUrl } from '../shared/github'
import type { SprintTaskPR } from '../shared/types'
import type { PrStatusInput, PrStatusResult } from './github-pr-status'
import type { TaskStatus } from '../shared/task-state-machine'
import { sleep } from './lib/async-utils'
import { broadcast } from './broadcast'
import { createLogger } from './logger'

const POLL_INTERVAL_MS = 60_000
const POLL_TIMEOUT_MS = 30_000

// Stagger start by half the interval so the sprint PR poller
// doesn't fire in lockstep with the GitHub PR poller (also 60s) and the drain
// loop tick. Reduces SQLite + GitHub API contention by spreading work across
// the 60s window.
const POLL_INITIAL_DELAY_MS = 30_000

const MAX_TERMINAL_RETRY_ATTEMPTS = 5
/**
 * Upper bound on the in-memory retry queue size. If GitHub stays unhealthy
 * long enough to fill this, the oldest entry is evicted and a structured
 * `terminal-retry.evicted` event fires so the loss is observable.
 */
const MAX_PENDING_TASKS = 500
const TERMINAL_RETRY_BASE_DELAY_MS = 30_000
const TERMINAL_RETRY_MAX_DELAY_MS = 300_000

const moduleLogger = createLogger('sprint-pr-poller')

export interface SprintPrPollerDeps {
  listTasksWithOpenPrs: () => SprintTaskPR[]
  pollPrStatuses: (prs: PrStatusInput[]) => Promise<PrStatusResult[]>
  markTaskDoneByPrNumber: (prNumber: number) => Promise<string[]>
  markTaskCancelledByPrNumber: (prNumber: number) => Promise<string[]>
  updateTaskMergeableState: (prNumber: number, state: string | null) => Promise<void>
  /** Required: called after PR merge/close to trigger dependency resolution. */
  onTaskTerminal: (taskId: string, status: TaskStatus) => void
  logger?: {
    info: (msg: string) => void
    warn: (msg: string) => void
    error: (msg: string) => void
    debug: (msg: string) => void
    event: (name: string, fields: Record<string, unknown>) => void
  }
  /**
   * F-t1-concur-5: Optional override for the startup delay. Production passes
   * undefined to use the staggered default (30s). Tests can pass 0 to fire
   * immediately on start() so vi.useFakeTimers() works without additional
   * advance calls.
   */
  initialDelayMs?: number
}

export interface SprintPrPollerInstance {
  start: () => void
  stop: () => void
}

type Logger = NonNullable<SprintPrPollerDeps['logger']>

interface PendingTerminalRetry {
  status: TaskStatus
  attempts: number
  nextRetryAt: number
}

class PollTimeoutError extends Error {
  constructor() {
    super('poll timed out after 30s')
    this.name = 'PollTimeoutError'
  }
}

/**
 * Formats the merge log line. Includes `mergedAt` when available so audits
 * can correlate "task marked done" events with the GitHub merge timestamp
 * without a separate API call. SHA + PR title are not yet on PrStatusResult;
 * surfacing those requires extending github-pr-status.ts (out of scope here).
 */
function formatMergedLogLine(prNumber: number, taskIds: string[], mergedAt: string | null): string {
  const idsLabel = taskIds.join(', ') || '(none)'
  const mergedAtSuffix = mergedAt ? ` mergedAt=${mergedAt}` : ''
  return `[sprint-pr-poller] PR #${prNumber} merged${mergedAtSuffix} — marked ${taskIds.length} task(s) done: ${idsLabel}`
}

function isAuthOrRateLimitError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  const lowered = message.toLowerCase()
  return (
    lowered.includes('401') ||
    lowered.includes('403') ||
    lowered.includes('rate limit') ||
    lowered.includes('rate-limit') ||
    lowered.includes('ratelimit') ||
    ('status' in (err as object) &&
      ((err as { status: number }).status === 401 || (err as { status: number }).status === 403))
  )
}

function isServerError(err: unknown): boolean {
  if (err instanceof Error && /5\d\d/.test(err.message)) return true
  if (
    err !== null &&
    typeof err === 'object' &&
    'status' in err &&
    typeof (err as { status: unknown }).status === 'number'
  ) {
    const status = (err as { status: number }).status
    return status >= 500 && status < 600
  }
  return false
}

/**
 * Attempts to notify terminal status for each task id. Returns the ids that
 * failed — with the rejection reason — so callers can enqueue them for retry.
 */
async function attemptTerminalNotifications(
  ids: string[],
  status: TaskStatus,
  onTaskTerminal: (taskId: string, status: TaskStatus) => void
): Promise<Array<{ id: string; reason: string }>> {
  if (ids.length === 0) return []
  const results = await Promise.allSettled(
    ids.map((id) => Promise.resolve(onTaskTerminal(id, status)))
  )
  return results
    .map((result, index) =>
      result.status === 'rejected' ? { id: ids[index], reason: String(result.reason) } : null
    )
    .filter((entry): entry is { id: string; reason: string } => entry !== null)
}

export class SprintPrPoller implements SprintPrPollerInstance {
  private readonly deps: SprintPrPollerDeps
  private readonly log: Logger
  private readonly initialDelay: number

  private timer: ReturnType<typeof setInterval> | null = null
  private initialDelayTimer: ReturnType<typeof setTimeout> | null = null
  private pollInProgress = false
  private readonly pendingTerminalRetries = new Map<string, PendingTerminalRetry>()

  private errorCount = 0
  private nextPollAt = 0

  constructor(deps: SprintPrPollerDeps) {
    if (!deps.onTaskTerminal) {
      throw new Error(
        '[SprintPrPoller] onTaskTerminal is required — dependency resolution will not fire without it.'
      )
    }
    this.deps = deps
    this.log = deps.logger ?? moduleLogger
    this.initialDelay = deps.initialDelayMs ?? POLL_INITIAL_DELAY_MS
  }

  start(): void {
    // Delay first poll so we don't fire simultaneously
    // with the GitHub PR poller and drain loop on app startup.
    // initialDelay=0 fires immediately (used by tests with fake timers).
    if (this.initialDelay <= 0) {
      this.safePoll()
      this.timer = setInterval(() => this.safePoll(), POLL_INTERVAL_MS)
      return
    }
    this.initialDelayTimer = setTimeout(() => {
      this.initialDelayTimer = null
      this.safePoll()
      this.timer = setInterval(() => this.safePoll(), POLL_INTERVAL_MS)
    }, this.initialDelay)
  }

  stop(): void {
    if (this.initialDelayTimer) {
      clearTimeout(this.initialDelayTimer)
      this.initialDelayTimer = null
    }
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  private async safePoll(): Promise<void> {
    if (Date.now() < this.nextPollAt) {
      this.log.debug('[sprint-pr-poller] skipping tick — within backoff window')
      return
    }
    if (this.pollInProgress) {
      this.log.debug('[sprint-pr-poller] poll already in progress, skipping')
      return
    }
    this.pollInProgress = true
    try {
      await Promise.race([
        this.poll(),
        sleep(POLL_TIMEOUT_MS).then(() => {
          throw new PollTimeoutError()
        })
      ])
      this.errorCount = 0
      this.nextPollAt = 0
    } catch (err) {
      if (err instanceof PollTimeoutError) {
        this.log.warn('[sprint-pr-poller] poll timed out after 30s — will retry next cycle')
      } else if (isAuthOrRateLimitError(err)) {
        const message = err instanceof Error ? err.message : String(err)
        this.log.warn(`[sprint-pr-poller] auth/rate-limit error: ${message}`)
        broadcast('manager:warning', {
          message: `GitHub PR poll failed: ${message}. Check your GitHub token in Settings.`
        })
      } else if (isServerError(err)) {
        this.errorCount++
        const backoffMs = Math.min(POLL_INTERVAL_MS * Math.pow(2, this.errorCount - 1), 300_000)
        this.nextPollAt = Date.now() + backoffMs
        this.log.warn(
          `[sprint-pr-poller] 5xx error (count=${this.errorCount}); backing off for ${backoffMs}ms`
        )
      } else {
        this.log.warn(`[sprint-pr-poller] poll error: ${err}`)
      }
    } finally {
      this.pollInProgress = false
    }
  }

  private async poll(): Promise<void> {
    await this.flushPendingRetries()

    const tasks = this.deps.listTasksWithOpenPrs()
    if (tasks.length === 0) {
      this.log.event('pr-poller.tick.idle', { taskCount: 0 })
      return
    }

    const inputs: PrStatusInput[] = tasks
      .map((t) => ({ taskId: t.id, prUrl: t.pr_url! }))
      .filter((t) => t.prUrl)

    if (inputs.length === 0) return

    const results = await this.deps.pollPrStatuses(inputs)

    // Pre-build a taskId → input map so the join below is O(1) per result
    // instead of O(N) per result (was O(N²) over the open-PR set).
    const inputByTaskId = new Map(inputs.map((input) => [input.taskId, input]))

    let mergedCount = 0
    let cancelledCount = 0
    let unchangedCount = 0

    for (const result of results) {
      const input = inputByTaskId.get(result.taskId)
      const prNumber = input ? parsePrUrl(input.prUrl)?.number : undefined
      if (!prNumber) continue

      if (result.merged) {
        const ids = await this.deps.markTaskDoneByPrNumber(prNumber)
        this.log.info(formatMergedLogLine(prNumber, ids, result.mergedAt))
        ids.forEach((id) =>
          this.log.info(`[sprint-pr-poller] Calling onTaskTerminal(${id}, 'done')`)
        )
        await this.notifyTaskTerminalBatch(ids, 'done')
        mergedCount++
      } else if (result.state === 'CLOSED') {
        const ids = await this.deps.markTaskCancelledByPrNumber(prNumber)
        if (ids.length > 0) {
          this.log.info(
            `[sprint-pr-poller] PR #${prNumber} closed — cancelled ${ids.length} task(s): ${ids.join(', ')}`
          )
          await this.notifyTaskTerminalBatch(ids, 'cancelled')
        }
        cancelledCount++
      } else {
        unchangedCount++
      }
      await this.deps.updateTaskMergeableState(prNumber, result.mergeableState)
    }

    this.log.event('pr-poller.tick.complete', {
      taskCount: tasks.length,
      merged: mergedCount,
      cancelled: cancelledCount,
      unchanged: unchangedCount
    })
  }

  private async notifyTaskTerminalBatch(ids: string[], status: TaskStatus): Promise<void> {
    if (ids.length === 0) return
    const failed = await attemptTerminalNotifications(ids, status, this.deps.onTaskTerminal)
    for (const { id, reason } of failed) {
      const prior = this.pendingTerminalRetries.get(id)
      this.enqueueRetry(id, { status, attempts: (prior?.attempts ?? 0) + 1, nextRetryAt: 0 })
      this.log.warn(
        `[sprint-pr-poller] onTaskTerminal failed for ${id}: ${reason}; queued for retry`
      )
    }
    if (failed.length > 0) {
      this.log.warn(
        `[sprint-pr-poller] onTaskTerminal failed; will retry next cycle: ${JSON.stringify(failed.map(({ id }) => ({ id })))}`
      )
    }
  }

  private enqueueRetry(id: string, entry: PendingTerminalRetry): void {
    if (
      !this.pendingTerminalRetries.has(id) &&
      this.pendingTerminalRetries.size >= MAX_PENDING_TASKS
    ) {
      const oldestKey = this.pendingTerminalRetries.keys().next().value
      if (oldestKey !== undefined) {
        const evicted = this.pendingTerminalRetries.get(oldestKey)
        this.pendingTerminalRetries.delete(oldestKey)
        this.log.error(
          `[sprint-pr-poller] retry queue full (cap=${MAX_PENDING_TASKS}); evicted oldest task ${oldestKey}`
        )
        this.log.event('terminal-retry.evicted', {
          taskId: oldestKey,
          status: evicted?.status,
          attempts: evicted?.attempts ?? 0,
          cap: MAX_PENDING_TASKS
        })
      }
    }
    this.pendingTerminalRetries.set(id, entry)
  }

  private async flushPendingRetries(): Promise<void> {
    if (this.pendingTerminalRetries.size === 0) return

    const now = Date.now()
    const entries = Array.from(this.pendingTerminalRetries.entries())
    const dueEntries = entries.filter(([, pending]) => now >= pending.nextRetryAt)

    if (dueEntries.length === 0) return

    const results = await Promise.allSettled(
      dueEntries.map(([taskId, pending]) =>
        Promise.resolve(this.deps.onTaskTerminal(taskId, pending.status))
      )
    )

    for (let i = 0; i < results.length; i++) {
      const entry = dueEntries[i]
      const result = results[i]
      if (!entry || !result) continue

      const [taskId, pending] = entry
      if (result.status === 'fulfilled') {
        this.pendingTerminalRetries.delete(taskId)
        this.log.info(`[sprint-pr-poller] retry succeeded for task ${taskId}`)
      } else {
        const reason = String(result.reason)
        const nextAttempts = pending.attempts + 1
        if (nextAttempts >= MAX_TERMINAL_RETRY_ATTEMPTS) {
          this.log.error(
            `[sprint-pr-poller] terminal notify for task ${taskId} failed after ${nextAttempts} attempts — dropping`
          )
          this.log.event('terminal-retry.exhausted', {
            taskId,
            status: pending.status,
            attempts: nextAttempts
          })
          this.pendingTerminalRetries.delete(taskId)
        } else {
          const backoffMs = Math.min(
            TERMINAL_RETRY_BASE_DELAY_MS * Math.pow(2, nextAttempts - 1),
            TERMINAL_RETRY_MAX_DELAY_MS
          )
          this.pendingTerminalRetries.set(taskId, {
            status: pending.status,
            attempts: nextAttempts,
            nextRetryAt: now + backoffMs
          })
          this.log.warn(
            `[sprint-pr-poller] terminal notify retry ${nextAttempts}/${MAX_TERMINAL_RETRY_ATTEMPTS} failed for ${taskId}: ${reason} — next attempt in ${backoffMs}ms`
          )
        }
      }
    }
  }
}

/** Factory wrapper for backward compatibility with callers that use the function form. */
export function createSprintPrPoller(deps: SprintPrPollerDeps): SprintPrPollerInstance {
  return new SprintPrPoller(deps)
}
