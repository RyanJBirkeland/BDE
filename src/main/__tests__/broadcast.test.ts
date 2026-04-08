import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock electron before import
const mockSend = vi.fn()
const mockIsDestroyed = vi.fn(() => false)

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn()
  }
}))

import { broadcast, broadcastCoalesced } from '../broadcast'
import { BrowserWindow } from 'electron'

const mockGetAllWindows = vi.mocked(BrowserWindow.getAllWindows)

describe('broadcast', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetAllWindows.mockReturnValue([
      { webContents: { send: mockSend }, isDestroyed: mockIsDestroyed },
      { webContents: { send: mockSend }, isDestroyed: mockIsDestroyed }
    ] as any)
  })

  it('sends to all windows immediately', () => {
    broadcast('test:channel', { foo: 'bar' })
    expect(mockSend).toHaveBeenCalledTimes(2)
    expect(mockSend).toHaveBeenCalledWith('test:channel', { foo: 'bar' })
  })

  it('handles undefined data', () => {
    broadcast('test:channel')
    expect(mockSend).toHaveBeenCalledTimes(2)
    expect(mockSend).toHaveBeenCalledWith('test:channel', undefined)
  })
})

describe('broadcastCoalesced', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockGetAllWindows.mockReturnValue([
      { webContents: { send: mockSend }, isDestroyed: mockIsDestroyed },
      { webContents: { send: mockSend }, isDestroyed: mockIsDestroyed }
    ] as any)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('batches multiple events into one send per window', () => {
    broadcastCoalesced('agent:event', { agentId: 'a1', event: { type: 'log', message: 'one' } })
    broadcastCoalesced('agent:event', { agentId: 'a2', event: { type: 'log', message: 'two' } })
    broadcastCoalesced('agent:event', { agentId: 'a3', event: { type: 'log', message: 'three' } })

    // Should not send immediately
    expect(mockSend).not.toHaveBeenCalled()

    // Fast-forward 16ms
    vi.advanceTimersByTime(16)

    // Should send once per window with batch channel
    expect(mockSend).toHaveBeenCalledTimes(2)
    expect(mockSend).toHaveBeenCalledWith('agent:event:batch', [
      { agentId: 'a1', event: { type: 'log', message: 'one' } },
      { agentId: 'a2', event: { type: 'log', message: 'two' } },
      { agentId: 'a3', event: { type: 'log', message: 'three' } }
    ])
  })

  it('sends even with single event after 16ms', () => {
    broadcastCoalesced('agent:event', { agentId: 'solo', event: { type: 'log', message: 'one' } })

    expect(mockSend).not.toHaveBeenCalled()
    vi.advanceTimersByTime(16)

    expect(mockSend).toHaveBeenCalledTimes(2)
    expect(mockSend).toHaveBeenCalledWith('agent:event:batch', [
      { agentId: 'solo', event: { type: 'log', message: 'one' } }
    ])
  })

  it('skips destroyed windows when flushing', () => {
    mockGetAllWindows.mockReturnValueOnce([
      { webContents: { send: mockSend }, isDestroyed: () => false },
      { webContents: { send: mockSend }, isDestroyed: () => true }
    ] as any)

    broadcastCoalesced('test', { data: 1 })
    vi.advanceTimersByTime(16)

    // Should send only to non-destroyed window
    expect(mockSend).toHaveBeenCalledTimes(1)
  })

  it('handles multiple channels independently', () => {
    broadcastCoalesced('channel:one', { val: 1 })
    broadcastCoalesced('channel:two', { val: 2 })
    broadcastCoalesced('channel:one', { val: 3 })

    vi.advanceTimersByTime(16)

    // Should send both channels
    expect(mockSend).toHaveBeenCalledWith('channel:one:batch', [{ val: 1 }, { val: 3 }])
    expect(mockSend).toHaveBeenCalledWith('channel:two:batch', [{ val: 2 }])
  })

  it('resets timer after each flush', () => {
    broadcastCoalesced('test', { batch: 1 })
    vi.advanceTimersByTime(16)
    expect(mockSend).toHaveBeenCalledTimes(2)

    vi.clearAllMocks()

    broadcastCoalesced('test', { batch: 2 })
    vi.advanceTimersByTime(16)
    expect(mockSend).toHaveBeenCalledTimes(2)
    expect(mockSend).toHaveBeenCalledWith('test:batch', [{ batch: 2 }])
  })

  it('does not send before 16ms elapses', () => {
    broadcastCoalesced('test', { data: 1 })
    vi.advanceTimersByTime(15)
    expect(mockSend).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(mockSend).toHaveBeenCalled()
  })
})
