import { describe, it, expect } from 'vitest'
import { createRingBuffer, pushToRingBuffer, readRingBuffer } from '../ringBuffer'

describe('createRingBuffer', () => {
  it('creates a buffer with the specified size and zero count', () => {
    const buf = createRingBuffer<number>(4)
    expect(buf.size).toBe(4)
    expect(buf.count).toBe(0)
    expect(buf.head).toBe(0)
  })
})

describe('pushToRingBuffer', () => {
  it('increments count up to capacity', () => {
    const buf = createRingBuffer<number>(3)
    pushToRingBuffer(buf, 1)
    expect(buf.count).toBe(1)
    pushToRingBuffer(buf, 2)
    expect(buf.count).toBe(2)
    pushToRingBuffer(buf, 3)
    expect(buf.count).toBe(3)
    // Count stays at capacity after overflow
    pushToRingBuffer(buf, 4)
    expect(buf.count).toBe(3)
  })

  it('does not grow the internal array beyond the initial allocation', () => {
    const buf = createRingBuffer<number>(3)
    const originalItems = buf.items
    for (let i = 0; i < 10; i++) pushToRingBuffer(buf, i)
    expect(buf.items).toBe(originalItems)
    expect(buf.items.length).toBe(3)
  })
})

describe('readRingBuffer — insertion order', () => {
  it('returns items in insertion order when buffer has not wrapped', () => {
    const buf = createRingBuffer<string>(5)
    pushToRingBuffer(buf, 'a')
    pushToRingBuffer(buf, 'b')
    pushToRingBuffer(buf, 'c')
    expect(readRingBuffer(buf)).toEqual(['a', 'b', 'c'])
  })

  it('returns items in insertion order after a single wrap', () => {
    const buf = createRingBuffer<string>(3)
    pushToRingBuffer(buf, 'a')
    pushToRingBuffer(buf, 'b')
    pushToRingBuffer(buf, 'c')
    // Buffer is full; head wraps
    pushToRingBuffer(buf, 'd')
    // 'a' was overwritten; order should be b, c, d
    expect(readRingBuffer(buf)).toEqual(['b', 'c', 'd'])
  })

  it('oldest item is overwritten on overflow', () => {
    const buf = createRingBuffer<number>(4)
    for (let i = 1; i <= 6; i++) pushToRingBuffer(buf, i)
    // Items 1 and 2 were overwritten; 3, 4, 5, 6 remain in order
    expect(readRingBuffer(buf)).toEqual([3, 4, 5, 6])
  })

  it('read order is stable across many wraps', () => {
    const buf = createRingBuffer<number>(3)
    // Push 9 items into a size-3 buffer
    for (let i = 1; i <= 9; i++) pushToRingBuffer(buf, i)
    // Only the last 3 survive: 7, 8, 9
    expect(readRingBuffer(buf)).toEqual([7, 8, 9])
  })
})

describe('MAX_EVENTS_PER_AGENT constant', () => {
  it('is 500', async () => {
    const { MAX_EVENTS_PER_AGENT } = await import('../../stores/sprintEvents')
    expect(MAX_EVENTS_PER_AGENT).toBe(500)
  })
})
