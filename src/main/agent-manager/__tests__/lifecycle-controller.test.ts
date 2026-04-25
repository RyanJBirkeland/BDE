/**
 * Tests for LifecycleController (T-82).
 *
 * The controller owns four periodic setInterval handles for the agent manager
 * (drain, watchdog, orphan, prune). A regression that leaks a timer or fails
 * to start one in startTimers() would only manifest as "BDE didn't shut down
 * cleanly" in production — these tests guard the start/stop contract directly.
 *
 * Strategy: vi.useFakeTimers() lets us advance virtual time deterministically
 * and count callback invocations without real wall-clock waits, satisfying
 * F.I.R.S.T. (Fast, Independent, Repeatable).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { LifecycleController, type LoopCallbacks } from '../lifecycle-controller'
import {
  WATCHDOG_INTERVAL_MS,
  ORPHAN_CHECK_INTERVAL_MS,
  WORKTREE_PRUNE_INTERVAL_MS
} from '../types'

const POLL_INTERVAL_MS = 1_000

function makeCallbacks(): LoopCallbacks & {
  drain: ReturnType<typeof vi.fn>
  watchdog: ReturnType<typeof vi.fn>
  orphan: ReturnType<typeof vi.fn>
  prune: ReturnType<typeof vi.fn>
} {
  const drain = vi.fn()
  const watchdog = vi.fn()
  const orphan = vi.fn()
  const prune = vi.fn()
  return {
    drain,
    watchdog,
    orphan,
    prune,
    onDrainTick: drain,
    onWatchdogTick: watchdog,
    onOrphanTick: orphan,
    onPruneTick: prune
  }
}

describe('LifecycleController', () => {
  let controller: LifecycleController
  let callbacks: ReturnType<typeof makeCallbacks>

  beforeEach(() => {
    vi.useFakeTimers()
    controller = new LifecycleController()
    callbacks = makeCallbacks()
  })

  afterEach(() => {
    controller.stopTimers()
    vi.useRealTimers()
  })

  it('startTimers schedules the drain timer at the configured poll interval', () => {
    controller.startTimers(POLL_INTERVAL_MS, callbacks)

    vi.advanceTimersByTime(POLL_INTERVAL_MS * 3)

    expect(callbacks.drain).toHaveBeenCalledTimes(3)
  })

  it('startTimers schedules the watchdog timer at WATCHDOG_INTERVAL_MS', () => {
    controller.startTimers(POLL_INTERVAL_MS, callbacks)

    vi.advanceTimersByTime(WATCHDOG_INTERVAL_MS * 2)

    expect(callbacks.watchdog).toHaveBeenCalledTimes(2)
  })

  it('startTimers schedules the orphan timer at ORPHAN_CHECK_INTERVAL_MS', () => {
    controller.startTimers(POLL_INTERVAL_MS, callbacks)

    vi.advanceTimersByTime(ORPHAN_CHECK_INTERVAL_MS * 2)

    expect(callbacks.orphan).toHaveBeenCalledTimes(2)
  })

  it('startTimers schedules the prune timer at WORKTREE_PRUNE_INTERVAL_MS', () => {
    controller.startTimers(POLL_INTERVAL_MS, callbacks)

    vi.advanceTimersByTime(WORKTREE_PRUNE_INTERVAL_MS * 2)

    expect(callbacks.prune).toHaveBeenCalledTimes(2)
  })

  it('invokes each tick callback with no arguments', () => {
    controller.startTimers(POLL_INTERVAL_MS, callbacks)

    vi.advanceTimersByTime(WORKTREE_PRUNE_INTERVAL_MS)

    for (const fn of [callbacks.drain, callbacks.watchdog, callbacks.orphan, callbacks.prune]) {
      expect(fn).toHaveBeenCalled()
      for (const call of fn.mock.calls) {
        expect(call).toHaveLength(0)
      }
    }
  })

  it('stopTimers clears every timer so no further ticks fire', () => {
    controller.startTimers(POLL_INTERVAL_MS, callbacks)
    vi.advanceTimersByTime(WORKTREE_PRUNE_INTERVAL_MS)
    const drainCallsBeforeStop = callbacks.drain.mock.calls.length
    const watchdogCallsBeforeStop = callbacks.watchdog.mock.calls.length
    const orphanCallsBeforeStop = callbacks.orphan.mock.calls.length
    const pruneCallsBeforeStop = callbacks.prune.mock.calls.length

    controller.stopTimers()
    vi.advanceTimersByTime(WORKTREE_PRUNE_INTERVAL_MS * 5)

    expect(callbacks.drain).toHaveBeenCalledTimes(drainCallsBeforeStop)
    expect(callbacks.watchdog).toHaveBeenCalledTimes(watchdogCallsBeforeStop)
    expect(callbacks.orphan).toHaveBeenCalledTimes(orphanCallsBeforeStop)
    expect(callbacks.prune).toHaveBeenCalledTimes(pruneCallsBeforeStop)
  })

  it('stopTimers is idempotent — calling it twice does not throw or trigger ticks', () => {
    controller.startTimers(POLL_INTERVAL_MS, callbacks)
    controller.stopTimers()

    expect(() => controller.stopTimers()).not.toThrow()

    vi.advanceTimersByTime(WORKTREE_PRUNE_INTERVAL_MS * 5)
    expect(callbacks.drain).not.toHaveBeenCalled()
    expect(callbacks.watchdog).not.toHaveBeenCalled()
    expect(callbacks.orphan).not.toHaveBeenCalled()
    expect(callbacks.prune).not.toHaveBeenCalled()
  })

  it('stopTimers is safe before any startTimers call', () => {
    expect(() => controller.stopTimers()).not.toThrow()
  })

  it('restarts cleanly: start → stop → start fires every timer again', () => {
    controller.startTimers(POLL_INTERVAL_MS, callbacks)
    controller.stopTimers()

    const restartCallbacks = makeCallbacks()
    controller.startTimers(POLL_INTERVAL_MS, restartCallbacks)

    vi.advanceTimersByTime(WORKTREE_PRUNE_INTERVAL_MS)

    expect(restartCallbacks.drain).toHaveBeenCalled()
    expect(restartCallbacks.watchdog).toHaveBeenCalled()
    expect(restartCallbacks.orphan).toHaveBeenCalled()
    expect(restartCallbacks.prune).toHaveBeenCalled()
  })
})
