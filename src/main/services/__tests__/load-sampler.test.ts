import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import os from 'node:os'

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os')
  return {
    ...actual,
    default: {
      ...actual,
      loadavg: vi.fn(() => [1, 2, 3]),
      cpus: vi.fn(() => new Array(8).fill({ model: 'fake' }))
    },
    loadavg: vi.fn(() => [1, 2, 3]),
    cpus: vi.fn(() => new Array(8).fill({ model: 'fake' }))
  }
})

import {
  startLoadSampler,
  stopLoadSampler,
  getLoadSnapshot,
  _resetForTests,
  SAMPLE_INTERVAL_MS,
  BUFFER_SIZE
} from '../load-sampler'

describe('load-sampler', () => {
  beforeEach(() => {
    _resetForTests()
    vi.useFakeTimers()
    vi.mocked(os.loadavg).mockReturnValue([1, 2, 3])
  })

  afterEach(() => {
    stopLoadSampler()
    vi.useRealTimers()
  })

  it('returns cpuCount from os.cpus().length', () => {
    startLoadSampler()
    expect(getLoadSnapshot().cpuCount).toBe(8)
  })

  it('seeds a sample immediately on start', () => {
    startLoadSampler()
    const snap = getLoadSnapshot()
    expect(snap.samples).toHaveLength(1)
    expect(snap.samples[0]).toMatchObject({ load1: 1, load5: 2, load15: 3 })
    expect(snap.samples[0].t).toBeTypeOf('number')
  })

  it('adds a sample on each interval tick', () => {
    startLoadSampler()
    vi.mocked(os.loadavg).mockReturnValue([4, 5, 6])
    vi.advanceTimersByTime(SAMPLE_INTERVAL_MS)
    expect(getLoadSnapshot().samples).toHaveLength(2)
    expect(getLoadSnapshot().samples[1]).toMatchObject({ load1: 4, load5: 5, load15: 6 })
  })

  it('evicts oldest samples at BUFFER_SIZE capacity', () => {
    startLoadSampler()
    for (let i = 0; i < BUFFER_SIZE + 10; i++) {
      vi.advanceTimersByTime(SAMPLE_INTERVAL_MS)
    }
    expect(getLoadSnapshot().samples).toHaveLength(BUFFER_SIZE)
  })

  it('getLoadSnapshot returns a copy, not a reference', () => {
    startLoadSampler()
    const a = getLoadSnapshot().samples
    vi.advanceTimersByTime(SAMPLE_INTERVAL_MS)
    const b = getLoadSnapshot().samples
    expect(a).not.toBe(b)
    expect(a).toHaveLength(1)
    expect(b).toHaveLength(2)
  })

  it('startLoadSampler is idempotent', () => {
    startLoadSampler()
    startLoadSampler()
    startLoadSampler()
    vi.advanceTimersByTime(SAMPLE_INTERVAL_MS)
    // If it weren't idempotent, 3 timers × 1 tick = 3 new samples
    expect(getLoadSnapshot().samples).toHaveLength(2) // seed + 1 tick
  })

  it('stopLoadSampler halts sampling', () => {
    startLoadSampler()
    stopLoadSampler()
    vi.advanceTimersByTime(SAMPLE_INTERVAL_MS * 5)
    expect(getLoadSnapshot().samples).toHaveLength(1) // only the seed
  })
})
