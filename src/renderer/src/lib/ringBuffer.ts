/**
 * A fixed-size circular buffer. After initialization, `pushToRingBuffer` writes in
 * place — no array allocation on every push. `readRingBuffer` returns events in
 * insertion order, oldest first.
 */
export interface RingBuffer<T> {
  readonly items: T[]
  /** Next write position. Wraps at `size`. */
  head: number
  /** Maximum number of items the buffer holds. */
  readonly size: number
  /** Number of items currently stored (grows up to `size`, then stays constant). */
  count: number
}

/** Creates a ring buffer pre-allocated to `size` slots. */
export function createRingBuffer<T>(size: number): RingBuffer<T> {
  return { items: new Array<T>(size), head: 0, size, count: 0 }
}

/**
 * Writes `item` into the buffer at the current head, then advances the head.
 * When the buffer is full the oldest entry is overwritten.
 */
export function pushToRingBuffer<T>(buf: RingBuffer<T>, item: T): void {
  buf.items[buf.head % buf.size] = item
  buf.head++
  if (buf.count < buf.size) buf.count++
}

/**
 * Returns all stored items in insertion order (oldest first).
 * This allocates a new array on every call — call it only when you need the
 * full sequence (e.g. for rendering), not on every push.
 */
export function readRingBuffer<T>(buf: RingBuffer<T>): T[] {
  if (buf.count < buf.size) {
    // Buffer has not wrapped yet; items[0..count-1] are in order.
    return buf.items.slice(0, buf.count)
  }
  // Buffer has wrapped. Oldest item sits at (head % size); newest sits just before it.
  const start = buf.head % buf.size
  return buf.items.slice(start).concat(buf.items.slice(0, start))
}
