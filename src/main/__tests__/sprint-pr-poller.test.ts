import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createSprintPrPoller } from '../sprint-pr-poller'
import type { SprintPrPollerDeps } from '../sprint-pr-poller'

function makeDeps(overrides: Partial<SprintPrPollerDeps> = {}): SprintPrPollerDeps {
  return {
    listTasksWithOpenPrs: vi.fn().mockReturnValue([]),
    pollPrStatuses: vi.fn().mockResolvedValue([]),
    markTaskDoneByPrNumber: vi.fn().mockReturnValue([]),
    markTaskCancelledByPrNumber: vi.fn().mockReturnValue([]),
    updateTaskMergeableState: vi.fn().mockReturnValue(undefined),
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
      markTaskDoneByPrNumber: vi.fn().mockReturnValue(['task-1'])
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
      markTaskDoneByPrNumber: vi.fn().mockReturnValue(['task-1']),
      logger: { info: logInfo, warn: vi.fn() }
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
      markTaskDoneByPrNumber: vi.fn().mockReturnValue(['task-1']),
      logger: { info: logInfo, warn: vi.fn() }
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
      markTaskCancelledByPrNumber: vi.fn().mockReturnValue(['task-1'])
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
      markTaskDoneByPrNumber: vi.fn().mockReturnValue(['task-1']),
      onTaskTerminal: vi.fn().mockRejectedValue(new Error('dependency resolution failed')),
      logger: { info: vi.fn(), warn: logWarn }
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
      markTaskCancelledByPrNumber: vi.fn().mockReturnValue(['task-1']),
      onTaskTerminal: vi.fn().mockRejectedValue(new Error('dependency resolution failed')),
      logger: { info: vi.fn(), warn: logWarn }
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
})

// Suppress unused variable warning
void flush
