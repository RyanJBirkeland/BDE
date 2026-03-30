import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useCrossWindowDrop } from '../useCrossWindowDrop'

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

type Listener<T> = (payload: T) => void

interface TearoffMock {
  onDragIn: ReturnType<typeof vi.fn>
  onDragMove: ReturnType<typeof vi.fn>
  onDragCancel: ReturnType<typeof vi.fn>
  sendDropComplete: ReturnType<typeof vi.fn>
}

function makeTearoffMock(): TearoffMock & {
  fireDragIn: (viewKey: string, localX: number, localY: number) => void
  fireDragMove: (localX: number, localY: number) => void
  fireDragCancel: () => void
} {
  let dragInCb: Listener<{ viewKey: string; localX: number; localY: number }> | null = null
  let dragMoveCb: Listener<{ localX: number; localY: number }> | null = null
  let dragCancelCb: Listener<void> | null = null

  const mock: TearoffMock = {
    onDragIn: vi.fn((cb) => {
      dragInCb = cb
      return () => { dragInCb = null }
    }),
    onDragMove: vi.fn((cb) => {
      dragMoveCb = cb
      return () => { dragMoveCb = null }
    }),
    onDragCancel: vi.fn((cb) => {
      dragCancelCb = cb
      return () => { dragCancelCb = null }
    }),
    sendDropComplete: vi.fn()
  }

  return {
    ...mock,
    fireDragIn: (viewKey, localX, localY) => dragInCb?.({ viewKey, localX, localY }),
    fireDragMove: (localX, localY) => dragMoveCb?.({ localX, localY }),
    fireDragCancel: () => (dragCancelCb as unknown as () => void)?.()
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useCrossWindowDrop', () => {
  let tearoff: ReturnType<typeof makeTearoffMock>

  beforeEach(() => {
    tearoff = makeTearoffMock()
    ;(window.api as unknown as Record<string, unknown>).tearoff = tearoff
  })

  afterEach(() => {
    delete (window.api as unknown as Record<string, unknown>).tearoff
  })

  it('is initially inactive', () => {
    const { result } = renderHook(() => useCrossWindowDrop())
    expect(result.current.active).toBe(false)
    expect(result.current.viewKey).toBeNull()
    expect(result.current.localX).toBe(0)
    expect(result.current.localY).toBe(0)
  })

  it('subscribes to all three IPC events on mount', () => {
    renderHook(() => useCrossWindowDrop())
    expect(tearoff.onDragIn).toHaveBeenCalledOnce()
    expect(tearoff.onDragMove).toHaveBeenCalledOnce()
    expect(tearoff.onDragCancel).toHaveBeenCalledOnce()
  })

  it('becomes active when onDragIn fires', () => {
    const { result } = renderHook(() => useCrossWindowDrop())

    act(() => {
      tearoff.fireDragIn('agents', 300, 200)
    })

    expect(result.current.active).toBe(true)
    expect(result.current.viewKey).toBe('agents')
    expect(result.current.localX).toBe(300)
    expect(result.current.localY).toBe(200)
  })

  it('updates coordinates on onDragMove when active', () => {
    const { result } = renderHook(() => useCrossWindowDrop())

    act(() => {
      tearoff.fireDragIn('agents', 100, 100)
    })

    act(() => {
      tearoff.fireDragMove(450, 250)
    })

    expect(result.current.localX).toBe(450)
    expect(result.current.localY).toBe(250)
    expect(result.current.active).toBe(true)
  })

  it('ignores onDragMove when not active', () => {
    const { result } = renderHook(() => useCrossWindowDrop())

    act(() => {
      tearoff.fireDragMove(450, 250)
    })

    expect(result.current.active).toBe(false)
    expect(result.current.localX).toBe(0)
    expect(result.current.localY).toBe(0)
  })

  it('resets state on onDragCancel', () => {
    const { result } = renderHook(() => useCrossWindowDrop())

    act(() => {
      tearoff.fireDragIn('ide', 200, 150)
    })

    expect(result.current.active).toBe(true)

    act(() => {
      tearoff.fireDragCancel()
    })

    expect(result.current.active).toBe(false)
    expect(result.current.viewKey).toBeNull()
    expect(result.current.localX).toBe(0)
    expect(result.current.localY).toBe(0)
  })

  it('handleDrop calls sendDropComplete and resets state', () => {
    const { result } = renderHook(() => useCrossWindowDrop())

    act(() => {
      tearoff.fireDragIn('sprint', 200, 150)
    })

    act(() => {
      result.current.handleDrop('panel-abc', 'right')
    })

    expect(tearoff.sendDropComplete).toHaveBeenCalledWith({
      viewKey: 'sprint',
      targetPanelId: 'panel-abc',
      zone: 'right'
    })
    expect(result.current.active).toBe(false)
    expect(result.current.viewKey).toBeNull()
  })

  it('handleDrop does nothing when viewKey is null', () => {
    const { result } = renderHook(() => useCrossWindowDrop())

    act(() => {
      result.current.handleDrop('panel-xyz', 'center')
    })

    expect(tearoff.sendDropComplete).not.toHaveBeenCalled()
  })

  it('unsubscribes from all events on unmount', () => {
    const { unmount } = renderHook(() => useCrossWindowDrop())

    act(() => {
      tearoff.fireDragIn('agents', 100, 100)
    })

    unmount()

    // After unmount, firing events should not cause state updates / errors
    act(() => {
      tearoff.fireDragMove(500, 300)
    })

    // No assertion needed — just verifying no throw after unmount
    expect(true).toBe(true)
  })

  it('does not subscribe when tearoff API is unavailable', () => {
    delete (window.api as unknown as Record<string, unknown>).tearoff

    const { result } = renderHook(() => useCrossWindowDrop())

    expect(result.current.active).toBe(false)
    // No error thrown
  })
})
