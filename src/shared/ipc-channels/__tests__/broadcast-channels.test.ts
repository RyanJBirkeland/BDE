import { describe, it, expect } from 'vitest'
import type { BroadcastChannels } from '../broadcast-channels'

// Type-level smoke test — compile errors here mean channels are missing
describe('BroadcastChannels tearoff entries (compile-time)', () => {
  it('all 8 tearoff channels are declared', () => {
    const channels: Array<keyof BroadcastChannels> = [
      'tearoff:confirmClose',
      'tearoff:tabReturned',
      'tearoff:tabRemoved',
      'tearoff:dragIn',
      'tearoff:dragMove',
      'tearoff:dragDone',
      'tearoff:dragCancel',
      'tearoff:crossWindowDrop'
    ]
    expect(channels).toHaveLength(8)
  })
})
