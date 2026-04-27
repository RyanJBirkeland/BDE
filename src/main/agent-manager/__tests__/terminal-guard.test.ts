import { describe, it, expect, vi } from 'vitest'
import { TerminalGuard } from '../terminal-guard'

describe('TerminalGuard', () => {
  it('executes fn on the first call for a task', async () => {
    const guard = new TerminalGuard()
    const fn = vi.fn().mockResolvedValue(undefined)

    await guard.guardedCall('task-1', fn)

    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('concurrent same-taskId calls receive the same in-flight promise', async () => {
    const guard = new TerminalGuard()
    let resolve: (() => void) | undefined
    const fn = vi.fn().mockImplementation(
      () => new Promise<void>((r) => { resolve = r })
    )

    const p1 = guard.guardedCall('task-1', fn)
    const p2 = guard.guardedCall('task-1', fn)

    // Both callers should get the same promise object
    expect(p1).toBe(p2)
    // fn is only called once even though guardedCall was called twice
    expect(fn).toHaveBeenCalledTimes(1)

    resolve!()
    await p1
  })

  it('deletes the guard entry after resolution so a subsequent call can execute', async () => {
    const guard = new TerminalGuard()
    const fn = vi.fn().mockResolvedValue(undefined)

    await guard.guardedCall('task-1', fn)
    await guard.guardedCall('task-1', fn)

    // Two separate calls — each fires fn because the first cleaned up in finally
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('deletes the guard entry after rejection', async () => {
    const guard = new TerminalGuard()
    const fn = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(undefined)

    await expect(guard.guardedCall('task-1', fn)).rejects.toThrow('boom')
    // After rejection, a second call should proceed
    await guard.guardedCall('task-1', fn)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('two independent tasks proceed independently', async () => {
    const guard = new TerminalGuard()
    const fn = vi.fn().mockResolvedValue(undefined)

    await guard.guardedCall('task-a', fn)
    await guard.guardedCall('task-b', fn)

    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('concurrent calls for two different tasks do not share a promise', async () => {
    const guard = new TerminalGuard()
    let resolveA: (() => void) | undefined
    let resolveB: (() => void) | undefined
    const fnA = vi.fn().mockImplementation(() => new Promise<void>((r) => { resolveA = r }))
    const fnB = vi.fn().mockImplementation(() => new Promise<void>((r) => { resolveB = r }))

    const pA = guard.guardedCall('task-a', fnA)
    const pB = guard.guardedCall('task-b', fnB)

    expect(pA).not.toBe(pB)
    expect(fnA).toHaveBeenCalledTimes(1)
    expect(fnB).toHaveBeenCalledTimes(1)

    resolveA!()
    resolveB!()
    await Promise.all([pA, pB])
  })
})
