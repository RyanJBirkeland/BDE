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

export interface SprintPrPollerDeps {
  listTasksWithOpenPrs: () => SprintTaskPR[]
  pollPrStatuses: (prs: PrStatusInput[]) => Promise<PrStatusResult[]>
  markTaskDoneByPrNumber: (prNumber: number) => string[]
  markTaskCancelledByPrNumber: (prNumber: number) => string[]
  updateTaskMergeableState: (prNumber: number, state: string | null) => void
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

/**
 * Attempts to notify terminal status for each task id. Returns the ids that
 * failed so callers can enqueue them for retry.
 */
async function attemptTerminalNotifications(
  ids: string[],
  status: TaskStatus,
  onTaskTerminal: (taskId: string, status: TaskStatus) => void
): Promise<string[]> {
  if (ids.length === 0) return []
  const results = await Promise.allSettled(
    ids.map((id) => Promise.resolve(onTaskTerminal(id, status)))
  )
  return results
    .map((result, index) => (result.status === 'rejected' ? ids[index] : null))
    .filter((id): id is string => id !== null)
}

export function createSprintPrPoller(deps: SprintPrPollerDeps): SprintPrPollerInstance {
  if (!deps.onTaskTerminal) {
    throw new Error(
      '[createSprintPrPoller] onTaskTerminal is required — dependency resolution will not fire without it.'
    )
  }

  const log: Logger = deps.logger ?? {
    info: (m) => console.log(m),
    warn: (m) => console.warn(m),
    error: (m) => console.error(m),
    debug: (m) => console.debug(m),
    event: () => undefined
  }

  let timer: ReturnType<typeof setInterval> | null = null
  let pollInProgress = false
  const pendingTerminalRetries = new Map<string, PendingTerminalRetry>()

  async function flushPendingRetries(): Promise<void> {
    if (pendingTerminalRetries.size === 0) return

    for (const [taskId, pending] of Array.from(pendingTerminalRetries.entries())) {
      try {
        await Promise.resolve(deps.onTaskTerminal(taskId, pending.status))
        pendingTerminalRetries.delete(taskId)
        log.info(`[sprint-pr-poller] retry succeeded for task ${taskId}`)
      } catch {
        const nextAttempts = pending.attempts + 1
        if (nextAttempts >= MAX_TERMINAL_RETRY_ATTEMPTS) {
          log.error(
            `[sprint-pr-poller] terminal notify for task ${taskId} failed after ${nextAttempts} attempts — dropping`
          )
          log.event('terminal-retry.exhausted', {
            taskId,
            status: pending.status,
            attempts: nextAttempts
          })
          pendingTerminalRetries.delete(taskId)
        } else {
          pendingTerminalRetries.set(taskId, { status: pending.status, attempts: nextAttempts })
          log.warn(
            `[sprint-pr-poller] terminal notify retry ${nextAttempts}/${MAX_TERMINAL_RETRY_ATTEMPTS} failed for task ${taskId}`
          )
        }
      }
    }
  }

  function enqueueRetry(id: string, entry: PendingTerminalRetry): void {
    if (!pendingTerminalRetries.has(id) && pendingTerminalRetries.size >= MAX_PENDING_TASKS) {
      const oldestKey = pendingTerminalRetries.keys().next().value
      if (oldestKey !== undefined) {
        const evicted = pendingTerminalRetries.get(oldestKey)
        pendingTerminalRetries.delete(oldestKey)
        log.error(
          `[sprint-pr-poller] retry queue full (cap=${MAX_PENDING_TASKS}); evicted oldest task ${oldestKey}`
        )
        log.event('terminal-retry.evicted', {
          taskId: oldestKey,
          status: evicted?.status,
          attempts: evicted?.attempts ?? 0,
          cap: MAX_PENDING_TASKS
        })
      }
    }
    pendingTerminalRetries.set(id, entry)
  }

  async function notifyTaskTerminalBatch(ids: string[], status: TaskStatus): Promise<void> {
    if (ids.length === 0) return
    const failedIds = await attemptTerminalNotifications(ids, status, deps.onTaskTerminal)
    for (const id of failedIds) {
      const prior = pendingTerminalRetries.get(id)
      enqueueRetry(id, { status, attempts: (prior?.attempts ?? 0) + 1 })
    }
    if (failedIds.length > 0) {
      log.warn(
        `[sprint-pr-poller] onTaskTerminal failed; will retry next cycle: ${JSON.stringify(failedIds.map((id) => ({ id })))}`
      )
    }
  }

  async function poll(): Promise<void> {
    await flushPendingRetries()

    const tasks = deps.listTasksWithOpenPrs()
    if (tasks.length === 0) {
      log.event('pr-poller.tick.idle', { taskCount: 0 })
      return
    }

    const inputs: PrStatusInput[] = tasks
      .map((t) => ({ taskId: t.id, prUrl: t.pr_url! }))
      .filter((t) => t.prUrl)

    if (inputs.length === 0) return

    const results = await deps.pollPrStatuses(inputs)

    // Pre-build a taskId → input map so the join below is O(1) per result
    // instead of O(N) per result (was O(N²) over the open-PR set).
    const inputByTaskId = new Map(inputs.map((input) => [input.taskId, input]))

    for (const result of results) {
      const input = inputByTaskId.get(result.taskId)
      const prNumber = input ? parsePrUrl(input.prUrl)?.number : undefined
      if (!prNumber) continue

      if (result.merged) {
        const ids = deps.markTaskDoneByPrNumber(prNumber)
        log.info(formatMergedLogLine(prNumber, ids, result.mergedAt))
        ids.forEach((id) => log.info(`[sprint-pr-poller] Calling onTaskTerminal(${id}, 'done')`))
        await notifyTaskTerminalBatch(ids, 'done')
      } else if (result.state === 'CLOSED') {
        const ids = deps.markTaskCancelledByPrNumber(prNumber)
        if (ids.length > 0) {
          log.info(
            `[sprint-pr-poller] PR #${prNumber} closed — cancelled ${ids.length} task(s): ${ids.join(', ')}`
          )
          await notifyTaskTerminalBatch(ids, 'cancelled')
        }
      }
      deps.updateTaskMergeableState(prNumber, result.mergeableState)
    }
  }

  async function safePoll(): Promise<void> {
    if (pollInProgress) {
      log.debug('[sprint-pr-poller] poll already in progress, skipping')
      return
    }
    pollInProgress = true
    try {
      await Promise.race([
        poll(),
        sleep(POLL_TIMEOUT_MS).then(() => {
          throw new PollTimeoutError()
        })
      ])
    } catch (err) {
      if (err instanceof PollTimeoutError) {
        log.warn('[sprint-pr-poller] poll timed out after 30s — will retry next cycle')
      } else if (isAuthOrRateLimitError(err)) {
        const message = err instanceof Error ? err.message : String(err)
        log.warn(`[sprint-pr-poller] auth/rate-limit error: ${message}`)
        broadcast('manager:warning', {
          message: `GitHub PR poll failed: ${message}. Check your GitHub token in Settings.`
        })
      } else {
        log.warn(`[sprint-pr-poller] poll error: ${err}`)
      }
    } finally {
      pollInProgress = false
    }
  }

  let initialDelayTimer: ReturnType<typeof setTimeout> | null = null
  const initialDelay = deps.initialDelayMs ?? POLL_INITIAL_DELAY_MS

  return {
    start() {
      // Delay first poll so we don't fire simultaneously
      // with the GitHub PR poller and drain loop on app startup.
      // initialDelay=0 fires immediately (used by tests with fake timers).
      if (initialDelay <= 0) {
        safePoll()
        timer = setInterval(safePoll, POLL_INTERVAL_MS)
        return
      }
      initialDelayTimer = setTimeout(() => {
        initialDelayTimer = null
        safePoll()
        timer = setInterval(safePoll, POLL_INTERVAL_MS)
      }, initialDelay)
    },
    stop() {
      if (initialDelayTimer) {
        clearTimeout(initialDelayTimer)
        initialDelayTimer = null
      }
      if (timer) {
        clearInterval(timer)
        timer = null
      }
    }
  }
}
