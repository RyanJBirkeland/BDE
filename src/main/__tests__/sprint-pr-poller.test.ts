import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createSprintPrPoller } from '../sprint-pr-poller'
import type { SprintPrPollerDeps } from '../sprint-pr-poller'

function makeDeps(overrides: Partial<SprintPrPollerDeps> = {}): SprintPrPollerDeps {
  return {
    listTasksWithOpenPrs: vi.fn().mockResolvedValue([]),
    pollPrStatuses: vi.fn().mockResolvedValue([]),
    markTaskDoneByPrNumber: vi.fn().mockResolvedValue([]),
    markTaskCancelledByPrNumber: vi.fn().mockResolvedValue([]),
    updateTaskMergeableState: vi.fn().mockResolvedValue(undefined),
    onTaskTerminal: vi.fn().mockResolvedValue(undefined),
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
      listTasksWithOpenPrs: vi.fn().mockResolvedValue([task]),
      pollPrStatuses: vi
        .fn()
        .mockResolvedValue([
          { taskId: 'task-1', merged: true, state: 'MERGED', mergeableState: null }
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

  it('marks closed PRs as cancelled', async () => {
    const task = makeTask()
    const deps = makeDeps({
      listTasksWithOpenPrs: vi.fn().mockResolvedValue([task]),
      pollPrStatuses: vi
        .fn()
        .mockResolvedValue([
          { taskId: 'task-1', merged: false, state: 'CLOSED', mergeableState: null }
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
      listTasksWithOpenPrs: vi.fn().mockResolvedValue([task]),
      pollPrStatuses: vi
        .fn()
        .mockResolvedValue([
          { taskId: 'task-1', merged: false, state: 'OPEN', mergeableState: 'MERGEABLE' }
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
      listTasksWithOpenPrs: vi.fn().mockResolvedValue([])
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
      listTasksWithOpenPrs: vi.fn().mockResolvedValue([])
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
      listTasksWithOpenPrs: vi.fn().mockResolvedValue([])
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

  it('does not call onTaskTerminal when it is not provided', async () => {
    const task = makeTask()
    const { onTaskTerminal: _omit, ...depsWithoutTerminal } = makeDeps({
      listTasksWithOpenPrs: vi.fn().mockResolvedValue([task]),
      pollPrStatuses: vi
        .fn()
        .mockResolvedValue([
          { taskId: 'task-1', merged: true, state: 'MERGED', mergeableState: null }
        ]),
      markTaskDoneByPrNumber: vi.fn().mockResolvedValue(['task-1'])
    })

    const poller = createSprintPrPoller(depsWithoutTerminal)
    poller.start()
    poller.stop()

    // Should not throw even without onTaskTerminal
    for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(1)

    expect(depsWithoutTerminal.markTaskDoneByPrNumber).toHaveBeenCalledWith(42)
  })
})

// Suppress unused variable warning
void flush
