import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Watchdog } from './watchdog'
// TimeoutReason type used implicitly in callback assertions

describe('Watchdog', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('calls onTimeout with "max_runtime" after maxRuntimeMs', () => {
    const onTimeout = vi.fn()
    const dog = new Watchdog({ maxRuntimeMs: 5000, idleMs: 60000, onTimeout })

    dog.start()
    vi.advanceTimersByTime(4999)
    expect(onTimeout).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(onTimeout).toHaveBeenCalledOnce()
    expect(onTimeout).toHaveBeenCalledWith('max_runtime')

    dog.stop()
  })

  it('calls onTimeout with "idle" after idleMs with no activity', () => {
    const onTimeout = vi.fn()
    const dog = new Watchdog({ maxRuntimeMs: 10000, idleMs: 3000, onTimeout })

    dog.start()
    vi.advanceTimersByTime(2999)
    expect(onTimeout).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(onTimeout).toHaveBeenCalledOnce()
    expect(onTimeout).toHaveBeenCalledWith('idle')

    dog.stop()
  })

  it('resets the idle timer when ping() is called', () => {
    const onTimeout = vi.fn()
    const dog = new Watchdog({ maxRuntimeMs: 10000, idleMs: 3000, onTimeout })

    dog.start()

    // Advance to just before idle timeout
    vi.advanceTimersByTime(2500)
    expect(onTimeout).not.toHaveBeenCalled()

    // Ping resets the idle timer
    dog.ping()

    // Advance another 2500ms — would have been 5000ms total without ping,
    // but only 2500ms since the last ping, so idle should NOT fire
    vi.advanceTimersByTime(2500)
    expect(onTimeout).not.toHaveBeenCalled()

    // Advance the remaining 500ms to hit 3000ms since last ping
    vi.advanceTimersByTime(500)
    expect(onTimeout).toHaveBeenCalledOnce()
    expect(onTimeout).toHaveBeenCalledWith('idle')

    dog.stop()
  })

  it('does not fire any timeout after stop() is called', () => {
    const onTimeout = vi.fn()
    const dog = new Watchdog({ maxRuntimeMs: 5000, idleMs: 2000, onTimeout })

    dog.start()
    dog.stop()

    // Advance well past both timeouts
    vi.advanceTimersByTime(10000)
    expect(onTimeout).not.toHaveBeenCalled()
  })

  it('fires idle before max_runtime when idleMs < maxRuntimeMs and no pings', () => {
    const onTimeout = vi.fn()
    const dog = new Watchdog({ maxRuntimeMs: 10000, idleMs: 2000, onTimeout })

    dog.start()
    vi.advanceTimersByTime(2000)

    expect(onTimeout).toHaveBeenCalledOnce()
    expect(onTimeout).toHaveBeenCalledWith('idle')

    dog.stop()
  })

  it('can fire both idle and max_runtime if not stopped', () => {
    const onTimeout = vi.fn()
    const dog = new Watchdog({ maxRuntimeMs: 5000, idleMs: 2000, onTimeout })

    dog.start()

    vi.advanceTimersByTime(2000)
    expect(onTimeout).toHaveBeenCalledWith('idle')

    vi.advanceTimersByTime(3000)
    expect(onTimeout).toHaveBeenCalledWith('max_runtime')
    expect(onTimeout).toHaveBeenCalledTimes(2)

    dog.stop()
  })
})
