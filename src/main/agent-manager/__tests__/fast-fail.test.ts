import { describe, it, expect } from 'vitest'
import { classifyExit } from '../fast-fail'
import { FAST_FAIL_THRESHOLD_MS, MAX_FAST_FAILS } from '../types'

describe('classifyExit', () => {
  it('returns normal-exit when exit code is 0 regardless of duration', () => {
    const spawnedAt = 0
    const exitedAt = 1_000 // 1s, well within 30s threshold
    expect(classifyExit(spawnedAt, exitedAt, 0, 0)).toBe('normal-exit')
  })

  it('returns normal-exit when exit code is 0 even with high fast-fail count', () => {
    const spawnedAt = 0
    const exitedAt = 100 // very fast exit
    expect(classifyExit(spawnedAt, exitedAt, 0, MAX_FAST_FAILS)).toBe('normal-exit')
  })

  it('returns fast-fail-requeue when exit is within threshold and count is below max', () => {
    const spawnedAt = 0
    const exitedAt = FAST_FAIL_THRESHOLD_MS - 1
    expect(classifyExit(spawnedAt, exitedAt, 1, 0)).toBe('fast-fail-requeue')
  })

  it('returns fast-fail-exhausted when exit is within threshold and incrementing count meets MAX_FAST_FAILS', () => {
    const spawnedAt = 0
    const exitedAt = FAST_FAIL_THRESHOLD_MS - 1
    // currentFastFailCount + 1 === MAX_FAST_FAILS triggers exhausted
    expect(classifyExit(spawnedAt, exitedAt, 1, MAX_FAST_FAILS - 1)).toBe('fast-fail-exhausted')
  })

  it('returns fast-fail-exhausted when exit is within threshold and count already exceeds max', () => {
    const spawnedAt = 0
    const exitedAt = FAST_FAIL_THRESHOLD_MS - 1
    expect(classifyExit(spawnedAt, exitedAt, 1, MAX_FAST_FAILS)).toBe('fast-fail-exhausted')
  })

  it('returns normal-exit when exit is at or beyond threshold', () => {
    const spawnedAt = 0
    const exitedAt = FAST_FAIL_THRESHOLD_MS
    expect(classifyExit(spawnedAt, exitedAt, 1, 0)).toBe('normal-exit')
  })

  it('returns normal-exit when exit is well beyond threshold', () => {
    const spawnedAt = 0
    const exitedAt = FAST_FAIL_THRESHOLD_MS + 5_000
    expect(classifyExit(spawnedAt, exitedAt, 1, 2)).toBe('normal-exit')
  })

  it('returns fast-fail-requeue for count=1 (below max)', () => {
    const spawnedAt = 0
    const exitedAt = 1_000 // 1s, well within 30s threshold
    expect(classifyExit(spawnedAt, exitedAt, 1, 1)).toBe('fast-fail-requeue')
  })
})
