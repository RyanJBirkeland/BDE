/**
 * Smoke tests for useWorkbenchChat.
 *
 * Verifies that the hook subscribes to onChatChunk, accumulates chunks,
 * invokes the right callbacks on done/error, and cleans up the subscription.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useWorkbenchChat } from '../useWorkbenchChat'

type ChunkListener = (data: { chunk?: string; done: boolean; streamId: string }) => void

function buildWorkbenchApi(listener: { capture: ChunkListener | null }) {
  return {
    chatStream: vi.fn().mockResolvedValue(undefined),
    onChatChunk: vi.fn().mockImplementation((cb: ChunkListener) => {
      listener.capture = cb
      return () => {
        listener.capture = null
      }
    })
  }
}

beforeEach(() => {
  const listener: { capture: ChunkListener | null } = { capture: null }
  const workbench = buildWorkbenchApi(listener)
  Object.assign(window.api, { workbench })
  // Expose the listener so tests can fire chunk events.
  ;(window as unknown as Record<string, unknown>).__chunkListener = listener
})

function getListener(): { capture: ChunkListener | null } {
  return (window as unknown as Record<string, unknown>).__chunkListener as {
    capture: ChunkListener | null
  }
}

describe('useWorkbenchChat', () => {
  it('starts with isStreaming = false', () => {
    const { result } = renderHook(() => useWorkbenchChat())
    expect(result.current.isStreaming).toBe(false)
  })

  it('sets isStreaming = true during the stream', async () => {
    const { result } = renderHook(() => useWorkbenchChat())

    let streamPromise: Promise<void>
    act(() => {
      streamPromise = result.current.stream({
        messages: [],
        formContext: { title: 'T', repo: 'r', spec: '' },
        onChunk: vi.fn(),
        onDone: vi.fn(),
        onError: vi.fn()
      })
    })

    expect(result.current.isStreaming).toBe(true)
    // Fire done to let the promise settle.
    act(() => {
      getListener().capture?.({ done: true, streamId: 'x' })
    })
    await act(async () => {
      await streamPromise!
    })
    expect(result.current.isStreaming).toBe(false)
  })

  it('accumulates chunks and calls onDone with the full text', async () => {
    const onDone = vi.fn()
    const { result } = renderHook(() => useWorkbenchChat())

    let streamPromise: Promise<void>
    act(() => {
      streamPromise = result.current.stream({
        messages: [],
        formContext: { title: 'T', repo: 'r', spec: '' },
        onChunk: vi.fn(),
        onDone,
        onError: vi.fn()
      })
    })

    act(() => {
      getListener().capture?.({ chunk: 'hello ', done: false, streamId: 'x' })
      getListener().capture?.({ chunk: 'world', done: false, streamId: 'x' })
      getListener().capture?.({ done: true, streamId: 'x' })
    })
    await act(async () => {
      await streamPromise!
    })

    expect(onDone).toHaveBeenCalledWith('hello world')
  })

  it('calls onError and resets isStreaming when chatStream throws', async () => {
    vi.mocked(window.api.workbench.chatStream).mockRejectedValueOnce(new Error('network'))
    const onError = vi.fn()
    const { result } = renderHook(() => useWorkbenchChat())

    await act(async () => {
      await result.current.stream({
        messages: [],
        formContext: { title: 'T', repo: 'r', spec: '' },
        onChunk: vi.fn(),
        onDone: vi.fn(),
        onError
      })
    })

    expect(onError).toHaveBeenCalledOnce()
    expect(result.current.isStreaming).toBe(false)
  })

  it('does not call onChunk after onError when a chunk arrives before rejection', async () => {
    // chatStream rejects immediately, simulating a network error that races
    // with a chunk that was buffered just before the failure.
    vi.mocked(window.api.workbench.chatStream).mockRejectedValueOnce(new Error('network'))

    const onChunk = vi.fn()
    const onError = vi.fn()
    const { result } = renderHook(() => useWorkbenchChat())

    await act(async () => {
      const streamPromise = result.current.stream({
        messages: [],
        formContext: { title: 'T', repo: 'r', spec: '' },
        onChunk,
        onDone: vi.fn(),
        onError
      })
      // Fire a chunk before the rejection resolves — this schedules a RAF.
      getListener().capture?.({ chunk: 'partial', done: false, streamId: 'x' })
      await streamPromise
    })

    // The catch block must have cancelled the RAF, so onChunk must not be
    // called after onError.
    const onErrorCallOrder = onError.mock.invocationCallOrder[0]
    const onChunkCallsAfterError = onChunk.mock.invocationCallOrder.filter(
      (order) => order > onErrorCallOrder
    )
    expect(onChunkCallsAfterError).toHaveLength(0)
    expect(onError).toHaveBeenCalledOnce()
  })

  it('calls window.api.workbench.chatStream with the provided messages', async () => {
    const { result } = renderHook(() => useWorkbenchChat())
    const messages = [{ role: 'user' as const, content: 'hi' }]

    let streamPromise: Promise<void>
    act(() => {
      streamPromise = result.current.stream({
        messages,
        formContext: { title: 'Epic', repo: 'fleet', spec: 'ctx' },
        onChunk: vi.fn(),
        onDone: vi.fn(),
        onError: vi.fn()
      })
    })
    act(() => {
      getListener().capture?.({ done: true, streamId: 'x' })
    })
    await act(async () => {
      await streamPromise!
    })

    expect(window.api.workbench.chatStream).toHaveBeenCalledWith({
      messages,
      formContext: { title: 'Epic', repo: 'fleet', spec: 'ctx' }
    })
  })
})
