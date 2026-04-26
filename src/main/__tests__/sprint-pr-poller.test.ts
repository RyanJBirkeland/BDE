import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createSprintPrPoller } from '../sprint-pr-poller'
import type { SprintPrPollerDeps } from '../sprint-pr-poller'

vi.mock('../broadcast', () => ({ broadcast: vi.fn(), broadcastCoalesced: vi.fn() }))

import { broadcast } from '../broadcast'

function makeDeps(overrides: Partial<SprintPrPollerDeps> = {}): SprintPrPollerDeps {
  return {
    listTasksWithOpenPrs: vi.fn().mockReturnValue([]),
    pollPrStatuses: vi.fn().mockResolvedValue([]),
    markTaskDoneByPrNumber: vi.fn().mockResolvedValue([]),
    markTaskCancelledByPrNumber: vi.fn().mockResolvedValue([]),
    updateTaskMergeableState: vi.fn().mockResolvedValue(undefined),
    onTaskTerminal: vi.fn().mockReturnValue(undefined),
    // tests fire poller immediately; production stagger is 30s.
    initialDelayMs: 0,
    ...overrides
  }
}

// A valid GitHub PR URL that parsePrUrl can parse:
// parsePrUrl matches /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/
const PR_URL = 'https://github.com/owner/myrepo/pull/42'

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-1',
    title: 'Test task',
    repo: 'myrepo',
    prompt: null,
    spec: null,
    priority: 1,
    status: 'active' as const,
    notes: null,
    retry_count: 0,
    fast_fail_count: 0,
    agent_run_id: null,
    pr_number: 42,
    pr_status: 'open',
    pr_url: PR_URL,
    claimed_by: null,
    started_at: null,
    completed_at: null,
    template_name: null,
    depends_on: null,
    updated_at: '2026-01-01T00:00:00Z',
    created_at: '2026-01-01T00:00:00Z',
    ...overrides
  }
}

// Flush pending microtasks / resolved promises
async function flush(n = 10): Promise<void> {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0))
}

describe('createSprintPrPoller', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('polls on start and marks merged PRs as done', async () => {
    const task = makeTask()
    const deps = makeDeps({
      listTasksWithOpenPrs: vi.fn().mockReturnValue([task]),
      pollPrStatuses: vi.fn().mockResolvedValue([
        {
          taskId: 'task-1',
          merged: true,
          state: 'MERGED',
          mergedAt: '2026-04-24T10:00:00Z',
          mergeableState: null
        }
      ]),
      markTaskDoneByPrNumber: vi.fn().mockResolvedValue(['task-1'])
    })

    const poller = createSprintPrPoller(deps)
    poller.start()
    poller.stop() // stop immediately so no interval fires

    // Flush the initial poll() promise chain
    for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(1)

    expect(deps.listTasksWithOpenPrs).toHaveBeenCalled()
    expect(deps.pollPrStatuses).toHaveBeenCalledWith([{ taskId: 'task-1', prUrl: PR_URL }])
    expect(deps.markTaskDoneByPrNumber).toHaveBeenCalledWith(42)
    expect(deps.onTaskTerminal).toHaveBeenCalledWith('task-1', 'done')
  })

  it('joins many results to inputs in O(1) per result and notifies each terminal', async () => {
    const taskCount = 12
    const tasks = Array.from({ length: taskCount }, (_, i) =>
      makeTask({
        id: `task-${i}`,
        pr_number: 100 + i,
        pr_url: `https://github.com/owner/myrepo/pull/${100 + i}`
      })
    )
    const results = tasks.map((t) => ({
      taskId: t.id,
      merged: true,
      state: 'MERGED',
      mergedAt: '2026-04-24T10:00:00Z',
      mergeableState: null
    }))
    // Reverse the results so the lookup order doesn't trivially match input order.
    results.reverse()

    const markDone = vi.fn((prNumber: number) => [`task-${prNumber - 100}`])
    const deps = makeDeps({
      listTasksWithOpenPrs: vi.fn().mockReturnValue(tasks),
      pollPrStatuses: vi.fn().mockResolvedValue(results),
      markTaskDoneByPrNumber: markDone
    })

    const poller = createSprintPrPoller(deps)
    poller.start()
    poller.stop()

    for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(1)

    // Every PR number should have been routed to markTaskDoneByPrNumber, and
    // each task should have its terminal notification fired exactly once.
    expect(markDone).toHaveBeenCalledTimes(taskCount)
    for (let i = 0; i < taskCount; i++) {
      expect(markDone).toHaveBeenCalledWith(100 + i)
      expect(deps.onTaskTerminal).toHaveBeenCalledWith(`task-${i}`, 'done')
    }
  })

  it('logs the merged_at timestamp when present on the merge result', async () => {
    const task = makeTask()
    const logInfo = vi.fn()
    const deps = makeDeps({
      listTasksWithOpenPrs: vi.fn().mockReturnValue([task]),
      pollPrStatuses: vi.fn().mockResolvedValue([
        {
          taskId: 'task-1',
          merged: true,
          state: 'MERGED',
          mergedAt: '2026-04-24T10:00:00Z',
          mergeableState: null
        }
      ]),
      markTaskDoneByPrNumber: vi.fn().mockResolvedValue(['task-1']),
      logger: { info: logInfo, warn: vi.fn(), error: vi.fn(), debug: vi.fn(), event: vi.fn() }
    })

    const poller = createSprintPrPoller(deps)
    poller.start()
    poller.stop()

    for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(1)

    expect(logInfo).toHaveBeenCalledWith(expect.stringContaining('mergedAt=2026-04-24T10:00:00Z'))
    expect(logInfo).toHaveBeenCalledWith(expect.stringContaining('PR #42 merged'))
  })

  it('omits mergedAt suffix when the merge result has no timestamp', async () => {
    const task = makeTask()
    const logInfo = vi.fn()
    const deps = makeDeps({
      listTasksWithOpenPrs: vi.fn().mockReturnValue([task]),
      pollPrStatuses: vi.fn().mockResolvedValue([
        {
          taskId: 'task-1',
          merged: true,
          state: 'MERGED',
          mergedAt: null,
          mergeableState: null
        }
      ]),
      markTaskDoneByPrNumber: vi.fn().mockResolvedValue(['task-1']),
      logger: { info: logInfo, warn: vi.fn(), error: vi.fn(), debug: vi.fn(), event: vi.fn() }
    })

    const poller = createSprintPrPoller(deps)
    poller.start()
    poller.stop()

    for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(1)

    const mergeLogCall = logInfo.mock.calls.find((args) =>
      String(args[0]).startsWith('[sprint-pr-poller] PR #42 merged')
    )
    expect(mergeLogCall).toBeDefined()
    expect(String(mergeLogCall?.[0])).not.toContain('mergedAt=')
  })

  it('marks closed PRs as cancelled', async () => {
    const task = makeTask()
    const deps = makeDeps({
      listTasksWithOpenPrs: vi.fn().mockReturnValue([task]),
      pollPrStatuses: vi.fn().mockResolvedValue([
        {
          taskId: 'task-1',
          merged: false,
          state: 'CLOSED',
          mergedAt: null,
          mergeableState: null
        }
      ]),
      markTaskCancelledByPrNumber: vi.fn().mockResolvedValue(['task-1'])
    })

    const poller = createSprintPrPoller(deps)
    poller.start()
    poller.stop()

    for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(1)

    expect(deps.markTaskCancelledByPrNumber).toHaveBeenCalledWith(42)
    expect(deps.onTaskTerminal).toHaveBeenCalledWith('task-1', 'cancelled')
    expect(deps.markTaskDoneByPrNumber).not.toHaveBeenCalled()
  })

  it('updates mergeable state for open PRs', async () => {
    const task = makeTask()
    const deps = makeDeps({
      listTasksWithOpenPrs: vi.fn().mockReturnValue([task]),
      pollPrStatuses: vi.fn().mockResolvedValue([
        {
          taskId: 'task-1',
          merged: false,
          state: 'OPEN',
          mergedAt: null,
          mergeableState: 'MERGEABLE'
        }
      ])
    })

    const poller = createSprintPrPoller(deps)
    poller.start()
    poller.stop()

    for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(1)

    expect(deps.updateTaskMergeableState).toHaveBeenCalledWith(42, 'MERGEABLE')
    expect(deps.markTaskDoneByPrNumber).not.toHaveBeenCalled()
    expect(deps.markTaskCancelledByPrNumber).not.toHaveBeenCalled()
  })

  it('skips polling when no tasks with open PRs', async () => {
    const deps = makeDeps({
      listTasksWithOpenPrs: vi.fn().mockReturnValue([])
    })

    const poller = createSprintPrPoller(deps)
    poller.start()
    poller.stop()

    for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(1)

    expect(deps.listTasksWithOpenPrs).toHaveBeenCalled()
    expect(deps.pollPrStatuses).not.toHaveBeenCalled()
  })

  it('stops polling on stop()', async () => {
    const deps = makeDeps({
      listTasksWithOpenPrs: vi.fn().mockReturnValue([])
    })

    const poller = createSprintPrPoller(deps)
    poller.start()

    // Let the initial poll fire
    for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(1)
    const callCountAfterStart = (deps.listTasksWithOpenPrs as ReturnType<typeof vi.fn>).mock.calls
      .length

    poller.stop()

    // Advance past the 60s poll interval — no more polls should fire
    await vi.advanceTimersByTimeAsync(120_000)
    for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1)

    expect((deps.listTasksWithOpenPrs as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
      callCountAfterStart
    )
  })

  it('polls again after 60s interval elapses', async () => {
    const deps = makeDeps({
      listTasksWithOpenPrs: vi.fn().mockReturnValue([])
    })

    const poller = createSprintPrPoller(deps)
    poller.start()

    // Initial poll
    for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(1)
    const callsAfterStart = (deps.listTasksWithOpenPrs as ReturnType<typeof vi.fn>).mock.calls
      .length
    expect(callsAfterStart).toBeGreaterThanOrEqual(1)

    // Advance exactly 60 seconds to trigger next interval poll
    await vi.advanceTimersByTimeAsync(60_000)
    for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(1)

    expect(
      (deps.listTasksWithOpenPrs as ReturnType<typeof vi.fn>).mock.calls.length
    ).toBeGreaterThan(callsAfterStart)

    poller.stop()
  })

  it('throws at construction when onTaskTerminal is not provided', () => {
    const { onTaskTerminal: _omit, ...depsWithoutTerminal } = makeDeps()
    expect(() => createSprintPrPoller(depsWithoutTerminal as SprintPrPollerDeps)).toThrow(
      /onTaskTerminal is required/
    )
  })

  it('logs errors when onTaskTerminal rejects for merged PRs', async () => {
    const task = makeTask()
    const logWarn = vi.fn()
    const deps = makeDeps({
      listTasksWithOpenPrs: vi.fn().mockReturnValue([task]),
      pollPrStatuses: vi.fn().mockResolvedValue([
        {
          taskId: 'task-1',
          merged: true,
          state: 'MERGED',
          mergedAt: null,
          mergeableState: null
        }
      ]),
      markTaskDoneByPrNumber: vi.fn().mockResolvedValue(['task-1']),
      onTaskTerminal: vi.fn().mockRejectedValue(new Error('dependency resolution failed')),
      logger: { info: vi.fn(), warn: logWarn, error: vi.fn(), debug: vi.fn(), event: vi.fn() }
    })

    const poller = createSprintPrPoller(deps)
    poller.start()
    poller.stop()

    for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(1)

    expect(deps.onTaskTerminal).toHaveBeenCalledWith('task-1', 'done')
    expect(logWarn).toHaveBeenCalledWith(
      expect.stringContaining('onTaskTerminal failed; will retry next cycle')
    )
    expect(logWarn).toHaveBeenCalledWith(expect.stringMatching(/task-1/))
  })

  it('logs errors when onTaskTerminal rejects for closed PRs', async () => {
    const task = makeTask()
    const logWarn = vi.fn()
    const deps = makeDeps({
      listTasksWithOpenPrs: vi.fn().mockReturnValue([task]),
      pollPrStatuses: vi.fn().mockResolvedValue([
        {
          taskId: 'task-1',
          merged: false,
          state: 'CLOSED',
          mergedAt: null,
          mergeableState: null
        }
      ]),
      markTaskCancelledByPrNumber: vi.fn().mockResolvedValue(['task-1']),
      onTaskTerminal: vi.fn().mockRejectedValue(new Error('dependency resolution failed')),
      logger: { info: vi.fn(), warn: logWarn, error: vi.fn(), debug: vi.fn(), event: vi.fn() }
    })

    const poller = createSprintPrPoller(deps)
    poller.start()
    poller.stop()

    for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(1)

    expect(deps.onTaskTerminal).toHaveBeenCalledWith('task-1', 'cancelled')
    expect(logWarn).toHaveBeenCalledWith(
      expect.stringContaining('onTaskTerminal failed; will retry next cycle')
    )
    expect(logWarn).toHaveBeenCalledWith(expect.stringMatching(/task-1/))
  })
  // ── EP-8: Timeout + single-flight ──────────────────────────────────────────

  it('logs WARN and continues when poll times out after 30s', async () => {
    const task = makeTask()
    const logWarn = vi.fn()
    const deps = makeDeps({
      listTasksWithOpenPrs: vi.fn().mockReturnValue([task]),
      pollPrStatuses: vi.fn().mockImplementation(
        () => new Promise(() => { /* never resolves — simulates slow GitHub */ })
      ),
      logger: { info: vi.fn(), warn: logWarn, error: vi.fn(), debug: vi.fn(), event: vi.fn() }
    })

    const poller = createSprintPrPoller(deps)
    poller.start()

    // Advance past the 30s timeout
    await vi.advanceTimersByTimeAsync(30_001)
    for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(1)

    poller.stop()

    expect(logWarn).toHaveBeenCalledWith(
      expect.stringContaining('poll timed out after 30s')
    )
  })

  it('skips a tick and logs DEBUG when a poll is already in progress', async () => {
    const task = makeTask()
    const logDebug = vi.fn()

    const deps = makeDeps({
      listTasksWithOpenPrs: vi.fn().mockReturnValue([task]),
      // Never resolves — keeps poll() in-flight so pollInProgress stays true
      pollPrStatuses: vi.fn().mockImplementation(() => new Promise(() => { /* blocked */ })),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: logDebug, event: vi.fn() }
    })

    // Intercept the setInterval call to use a 1s period so the second tick
    // fires before the 30s poll timeout resets pollInProgress.
    const realSetInterval = globalThis.setInterval
    const intervalSpy = vi.spyOn(globalThis, 'setInterval').mockImplementationOnce(
      (fn: TimerHandler, _delay?: number, ...args: unknown[]) =>
        realSetInterval(fn as () => void, 1_000, ...args)
    )

    const poller = createSprintPrPoller(deps)
    poller.start()
    intervalSpy.mockRestore()

    // Let the initial safePoll() run and set pollInProgress=true
    for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(1)

    // Advance 1s to fire the shortened interval tick while poll is in-flight
    await vi.advanceTimersByTimeAsync(1_000)
    for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(1)

    expect(logDebug).toHaveBeenCalledWith(
      expect.stringContaining('poll already in progress, skipping')
    )

    // Advance past 30s so the in-flight poll times out and the poller resets
    await vi.advanceTimersByTimeAsync(30_001)
    poller.stop()
  })

  // ── EP-8: Terminal notify retry queue ──────────────────────────────────────

  it('retries failed terminal notify on the next poll cycle and removes on success', async () => {
    const task = makeTask()
    let terminalCallCount = 0
    const onTaskTerminal = vi.fn().mockImplementation(() => {
      terminalCallCount++
      if (terminalCallCount === 1) throw new Error('transient failure')
      // succeeds on subsequent calls
    })

    const deps = makeDeps({
      listTasksWithOpenPrs: vi.fn().mockReturnValue([task]),
      pollPrStatuses: vi.fn().mockResolvedValue([
        { taskId: 'task-1', merged: true, state: 'MERGED', mergedAt: null, mergeableState: null }
      ]),
      markTaskDoneByPrNumber: vi.fn().mockResolvedValue(['task-1']),
      onTaskTerminal
    })

    const poller = createSprintPrPoller(deps)
    poller.start()

    // First poll: terminal notify fails, queues for retry
    for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(1)
    expect(onTaskTerminal).toHaveBeenCalledTimes(1)

    // Second poll cycle: flushPendingRetries fires the retry
    await vi.advanceTimersByTimeAsync(60_000)
    for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(1)

    expect(onTaskTerminal).toHaveBeenCalledTimes(2)
    expect(onTaskTerminal).toHaveBeenCalledWith('task-1', 'done')

    poller.stop()
  })

  it('logs ERROR and drops the entry after 5 failed attempts', async () => {
    const task = makeTask()
    const logError = vi.fn()
    const onTaskTerminal = vi.fn().mockRejectedValue(new Error('always fails'))

    const deps = makeDeps({
      listTasksWithOpenPrs: vi.fn().mockReturnValue([task]),
      pollPrStatuses: vi.fn().mockResolvedValue([
        { taskId: 'task-1', merged: true, state: 'MERGED', mergedAt: null, mergeableState: null }
      ]),
      markTaskDoneByPrNumber: vi.fn().mockResolvedValue(['task-1']),
      onTaskTerminal,
      logger: { info: vi.fn(), warn: vi.fn(), error: logError, debug: vi.fn(), event: vi.fn() }
    })

    const poller = createSprintPrPoller(deps)
    poller.start()

    // Exponential backoff means retries don't all fire in 5×60s cycles.
    // Advance enough wall-time for all 5 attempts to fire (incl. backoff delays):
    //   attempt 1 at t≈0, attempt 2 at t≈60s (nextRetryAt=0), attempt 3 at t≈120s
    //   (nextRetryAt=120s), attempt 4 at t≈240s (nextRetryAt=240s),
    //   attempt 5 (exhausted) at t≈480s. Use 600s to cover the last interval tick.
    for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(1)
    await vi.advanceTimersByTimeAsync(600_000)
    for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(1)

    expect(logError).toHaveBeenCalledWith(expect.stringContaining('failed after'))
    expect(logError).toHaveBeenCalledWith(expect.stringContaining('task-1'))

    poller.stop()
  })

  // ── EP-8: Auth/rate-limit toast ─────────────────────────────────────────────

  it('broadcasts manager:warning when poll fails with a 401 error', async () => {
    const task = makeTask()
    const authError = Object.assign(new Error('Request failed with status 401'), { status: 401 })
    const deps = makeDeps({
      listTasksWithOpenPrs: vi.fn().mockReturnValue([task]),
      pollPrStatuses: vi.fn().mockRejectedValue(authError)
    })

    const poller = createSprintPrPoller(deps)
    poller.start()
    poller.stop()

    await vi.advanceTimersByTimeAsync(30_001)
    for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(1)

    expect(vi.mocked(broadcast)).toHaveBeenCalledWith(
      'manager:warning',
      expect.objectContaining({ message: expect.stringContaining('GitHub PR poll failed') })
    )
  })

  it('broadcasts manager:warning when poll fails with a rate limit error', async () => {
    const task = makeTask()
    const rateLimitError = new Error('GitHub rate limit exceeded')
    const deps = makeDeps({
      listTasksWithOpenPrs: vi.fn().mockReturnValue([task]),
      pollPrStatuses: vi.fn().mockRejectedValue(rateLimitError)
    })

    const poller = createSprintPrPoller(deps)
    poller.start()
    poller.stop()

    await vi.advanceTimersByTimeAsync(30_001)
    for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(1)

    expect(vi.mocked(broadcast)).toHaveBeenCalledWith(
      'manager:warning',
      expect.objectContaining({ message: expect.stringContaining('GitHub PR poll failed') })
    )
  })

  // ── EP-8: Idle heartbeat ─────────────────────────────────────────────────────

  it('emits pr-poller.tick.idle event when no tasks have open PRs', async () => {
    const logEvent = vi.fn()
    const deps = makeDeps({
      listTasksWithOpenPrs: vi.fn().mockReturnValue([]),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), event: logEvent }
    })

    const poller = createSprintPrPoller(deps)
    poller.start()
    poller.stop()

    for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(1)

    expect(logEvent).toHaveBeenCalledWith('pr-poller.tick.idle', { taskCount: 0 })
  })

  // ── T-114: Exponential backoff on terminal retry ──────────────────────────

  it('includes backoff delay in retry warning log (T-114)', async () => {
    // The direct proof that backoff fires: the warn log says "next attempt in Xms".
    // We can't count calls cleanly because the poll itself retries every cycle too.
    const logWarn = vi.fn()
    const task = makeTask()

    const deps = makeDeps({
      listTasksWithOpenPrs: vi.fn().mockReturnValueOnce([task]).mockReturnValue([]),
      pollPrStatuses: vi.fn().mockResolvedValue([
        { taskId: 'task-1', merged: true, state: 'MERGED', mergedAt: null, mergeableState: null }
      ]),
      markTaskDoneByPrNumber: vi.fn().mockResolvedValue(['task-1']),
      onTaskTerminal: vi.fn().mockRejectedValue(new Error('transient')),
      logger: { info: vi.fn(), warn: logWarn, error: vi.fn(), debug: vi.fn(), event: vi.fn() }
    })

    const poller = createSprintPrPoller(deps)
    poller.start()

    // Cycle 1: initial attempt fails, entry added with nextRetryAt:0
    for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(1)

    // Cycle 2 (60s later): flush retries, fails again — backoff warn fires
    await vi.advanceTimersByTimeAsync(60_000)
    for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(1)

    expect(logWarn).toHaveBeenCalledWith(expect.stringContaining('next attempt in'))

    poller.stop()
  })
})

// Suppress unused variable warning
void flush
