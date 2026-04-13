/**
 * Main-process timer that polls PR statuses for sprint tasks.
 * Runs independently of the renderer — ensures PR merges/closes
 * are detected even when no BDE window is open.
 */
import { parsePrUrl } from '../shared/github'
import type { SprintTask } from '../shared/types'
import type { PrStatusInput, PrStatusResult } from './github-pr-status'

const POLL_INTERVAL_MS = 60_000

// F-t1-concur-5: Stagger start by half the interval so the sprint PR poller
// doesn't fire in lockstep with the GitHub PR poller (also 60s) and the drain
// loop tick. Reduces SQLite + GitHub API contention by spreading work across
// the 60s window.
const POLL_INITIAL_DELAY_MS = 30_000

export interface SprintPrPollerDeps {
  listTasksWithOpenPrs: () => SprintTask[]
  pollPrStatuses: (prs: PrStatusInput[]) => Promise<PrStatusResult[]>
  markTaskDoneByPrNumber: (prNumber: number) => string[]
  markTaskCancelledByPrNumber: (prNumber: number) => string[]
  updateTaskMergeableState: (prNumber: number, state: string | null) => void
  /** Required: called after PR merge/close to trigger dependency resolution. */
  onTaskTerminal: (taskId: string, status: string) => void
  logger?: { info: (msg: string) => void; warn: (msg: string) => void }
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

export function createSprintPrPoller(deps: SprintPrPollerDeps): SprintPrPollerInstance {
  if (!deps.onTaskTerminal) {
    throw new Error(
      '[createSprintPrPoller] onTaskTerminal is required — dependency resolution will not fire without it.'
    )
  }

  let timer: ReturnType<typeof setInterval> | null = null

  async function poll(): Promise<void> {
    const tasks = deps.listTasksWithOpenPrs()
    if (tasks.length === 0) return

    const inputs: PrStatusInput[] = tasks
      .map((t) => ({ taskId: t.id, prUrl: t.pr_url! }))
      .filter((t) => t.prUrl)

    if (inputs.length === 0) return

    const results = await deps.pollPrStatuses(inputs)

    const log = deps.logger ?? console
    for (const result of results) {
      const input = inputs.find((i) => i.taskId === result.taskId)
      const prNumber = input ? parsePrUrl(input.prUrl)?.number : undefined
      if (!prNumber) continue

      if (result.merged) {
        const ids = deps.markTaskDoneByPrNumber(prNumber)
        log.info(
          `[sprint-pr-poller] PR #${prNumber} merged — marked ${ids.length} task(s) done: ${ids.join(', ') || '(none)'}`
        )
        {
          const promises = ids.map((id) => {
            log.info(`[sprint-pr-poller] Calling onTaskTerminal(${id}, 'done')`)
            return Promise.resolve(deps.onTaskTerminal(id, 'done'))
          })
          const results = await Promise.allSettled(promises)
          const failed = results
            .map((r, i) =>
              r.status === 'rejected' ? { id: ids[i], reason: String(r.reason) } : null
            )
            .filter(Boolean)
          if (failed.length > 0) {
            log.warn(
              `[sprint-pr-poller] onTaskTerminal failed; will retry next cycle: ${JSON.stringify(failed)}`
            )
          }
        }
      } else if (result.state === 'CLOSED') {
        const ids = deps.markTaskCancelledByPrNumber(prNumber)
        if (ids.length > 0) {
          log.info(
            `[sprint-pr-poller] PR #${prNumber} closed — cancelled ${ids.length} task(s): ${ids.join(', ')}`
          )
          {
            const promises = ids.map((id) =>
              Promise.resolve(deps.onTaskTerminal(id, 'cancelled'))
            )
            const results = await Promise.allSettled(promises)
            const failed = results
              .map((r, i) =>
                r.status === 'rejected' ? { id: ids[i], reason: String(r.reason) } : null
              )
              .filter(Boolean)
            if (failed.length > 0) {
              log.warn(
                `[sprint-pr-poller] onTaskTerminal failed; will retry next cycle: ${JSON.stringify(failed)}`
              )
            }
          }
        }
      }
      deps.updateTaskMergeableState(prNumber, result.mergeableState)
    }
  }

  function safePoll(): void {
    poll().catch((err) => (deps.logger ?? console).warn(`[sprint-pr-poller] poll error: ${err}`))
  }

  let initialDelayTimer: ReturnType<typeof setTimeout> | null = null
  const initialDelay = deps.initialDelayMs ?? POLL_INITIAL_DELAY_MS

  return {
    start() {
      // F-t1-concur-5: Delay first poll so we don't fire simultaneously
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

// --- Legacy API (backwards compat) ---

import { pollPrStatuses } from './github-pr-status'
import {
  listTasksWithOpenPrs,
  markTaskDoneByPrNumber,
  markTaskCancelledByPrNumber,
  updateTaskMergeableState
} from './services/sprint-service'
import { createLogger } from './logger'

let _instance: SprintPrPollerInstance | null = null

export interface SprintPrPollerLegacyDeps {
  onStatusTerminal: (taskId: string, status: string) => void | Promise<void>
}

export function startSprintPrPoller(deps: SprintPrPollerLegacyDeps): void {
  const pollerLogger = createLogger('sprint-pr-poller')
  _instance = createSprintPrPoller({
    listTasksWithOpenPrs,
    pollPrStatuses,
    markTaskDoneByPrNumber,
    markTaskCancelledByPrNumber,
    updateTaskMergeableState,
    onTaskTerminal: deps.onStatusTerminal,
    logger: pollerLogger
  })
  _instance.start()
}

export function stopSprintPrPoller(): void {
  _instance?.stop()
  _instance = null
}
