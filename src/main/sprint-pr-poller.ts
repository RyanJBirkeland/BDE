/**
 * Main-process timer that polls PR statuses for sprint tasks.
 * Runs independently of the renderer — ensures PR merges/closes
 * are detected even when no BDE window is open.
 */
import { parsePrUrl } from '../shared/github'
import type { SprintTask } from '../shared/types'
import type { PrStatusInput, PrStatusResult } from './github-pr-status'

const POLL_INTERVAL_MS = 60_000

export interface SprintPrPollerDeps {
  listTasksWithOpenPrs: () => SprintTask[]
  pollPrStatuses: (prs: PrStatusInput[]) => Promise<PrStatusResult[]>
  markTaskDoneByPrNumber: (prNumber: number) => string[]
  markTaskCancelledByPrNumber: (prNumber: number) => string[]
  updateTaskMergeableState: (prNumber: number, state: string | null) => void
  onTaskTerminal?: (taskId: string, status: string) => void
}

export interface SprintPrPollerInstance {
  start: () => void
  stop: () => void
}

export function createSprintPrPoller(deps: SprintPrPollerDeps): SprintPrPollerInstance {
  let timer: ReturnType<typeof setInterval> | null = null

  async function poll(): Promise<void> {
    const tasks = deps.listTasksWithOpenPrs()
    if (tasks.length === 0) return

    const inputs: PrStatusInput[] = tasks
      .map((t) => ({ taskId: t.id, prUrl: t.pr_url! }))
      .filter((t) => t.prUrl)

    if (inputs.length === 0) return

    const results = await deps.pollPrStatuses(inputs)

    for (const result of results) {
      const input = inputs.find((i) => i.taskId === result.taskId)
      const prNumber = input ? parsePrUrl(input.prUrl)?.number : undefined
      if (!prNumber) continue

      if (result.merged) {
        const ids = deps.markTaskDoneByPrNumber(prNumber)
        if (deps.onTaskTerminal) {
          for (const id of ids) deps.onTaskTerminal(id, 'done')
        }
      } else if (result.state === 'CLOSED') {
        const ids = deps.markTaskCancelledByPrNumber(prNumber)
        if (deps.onTaskTerminal) {
          for (const id of ids) deps.onTaskTerminal(id, 'cancelled')
        }
      }
      deps.updateTaskMergeableState(prNumber, result.mergeableState)
    }
  }

  function safePoll(): void {
    poll().catch(err => console.error('[sprint-pr-poller] poll error:', err))
  }

  return {
    start() {
      safePoll()
      timer = setInterval(safePoll, POLL_INTERVAL_MS)
    },
    stop() {
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
} from './handlers/sprint-local'

let _instance: SprintPrPollerInstance | null = null
let _onTaskTerminal: ((taskId: string, status: string) => void) | null = null

export function setOnTaskTerminal(fn: (taskId: string, status: string) => void): void {
  _onTaskTerminal = fn
}

export function startSprintPrPoller(): void {
  _instance = createSprintPrPoller({
    listTasksWithOpenPrs,
    pollPrStatuses,
    markTaskDoneByPrNumber,
    markTaskCancelledByPrNumber,
    updateTaskMergeableState,
    onTaskTerminal: _onTaskTerminal ?? undefined
  })
  _instance.start()
}

export function stopSprintPrPoller(): void {
  _instance?.stop()
  _instance = null
}
