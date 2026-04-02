import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useTearoffDrag } from '../useTearoffDrag'

// jsdom does not implement DragEvent — provide a minimal polyfill
if (typeof globalThis.DragEvent === 'undefined') {
  class DragEvent extends MouseEvent {
    dataTransfer: DataTransfer | null = null
    constructor(type: string, init?: DragEventInit) {
      super(type, init)
    }
  }
  globalThis.DragEvent = DragEvent as typeof globalThis.DragEvent
}

const SAMPLE_PAYLOAD = {
  sourcePanelId: 'panel-1',
  sourceTabIndex: 2,
  viewKey: 'agents'
}

function fireDragOver(screenX: number, screenY: number): void {
  const event = new DragEvent('dragover', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'screenX', { value: screenX, configurable: true })
  Object.defineProperty(event, 'screenY', { value: screenY, configurable: true })
  document.dispatchEvent(event)
}

function fireDragLeave(target: EventTarget): void {
  const event = new DragEvent('dragleave', { bubbles: false, cancelable: true })
  Object.defineProperty(event, 'target', { value: target, configurable: true })
  target.dispatchEvent(event)
}

function fireDragEnter(target: EventTarget): void {
  const event = new DragEvent('dragenter', { bubbles: false, cancelable: true })
  Object.defineProperty(event, 'target', { value: target, configurable: true })
  target.dispatchEvent(event)
}

function fireDragEnd(): void {
  document.dispatchEvent(new DragEvent('dragend', { bubbles: true }))
}

describe('useTearoffDrag', () => {
  let tearoffCreate: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    tearoffCreate = vi.fn().mockResolvedValue({ windowId: 'tw1' })
    // Extend the global api mock from test-setup.ts with tearoff
    ;(window.api as unknown as Record<string, unknown>).tearoff = {
      create: tearoffCreate
    }
  })

  afterEach(() => {
    vi.useRealTimers()
    delete (window.api as unknown as Record<string, unknown>).tearoff
  })

  it('calls tearoff.create after 200ms when drag leaves window', () => {
    const { result } = renderHook(() => useTearoffDrag())

    act(() => {
      result.current.startDrag(SAMPLE_PAYLOAD)
    })

    // Update last screen coords via dragover
    fireDragOver(800, 600)

    // Fire dragleave on documentElement
    fireDragLeave(document.documentElement)

    // Before timer fires — IPC not yet called
    expect(tearoffCreate).not.toHaveBeenCalled()

    // Advance timer past 200ms
    act(() => {
      vi.advanceTimersByTime(200)
    })

    expect(tearoffCreate).toHaveBeenCalledOnce()
    expect(tearoffCreate).toHaveBeenCalledWith({
      view: SAMPLE_PAYLOAD.viewKey,
      screenX: 800,
      screenY: 600,
      sourcePanelId: SAMPLE_PAYLOAD.sourcePanelId,
      sourceTabIndex: SAMPLE_PAYLOAD.sourceTabIndex
    })
  })

  it('cancels the timer when cursor re-enters window via dragenter', () => {
    const { result } = renderHook(() => useTearoffDrag())

    act(() => {
      result.current.startDrag(SAMPLE_PAYLOAD)
    })

    fireDragLeave(document.documentElement)

    // Cursor comes back before 200ms
    act(() => {
      vi.advanceTimersByTime(100)
    })

    fireDragEnter(document.documentElement)

    // Advance past 200ms — timer should have been cancelled
    act(() => {
      vi.advanceTimersByTime(200)
    })

    expect(tearoffCreate).not.toHaveBeenCalled()
  })

  it('does not start timer if dragData is null (endDrag called before dragleave)', () => {
    const { result } = renderHook(() => useTearoffDrag())

    act(() => {
      result.current.startDrag(SAMPLE_PAYLOAD)
      result.current.endDrag()
    })

    fireDragLeave(document.documentElement)

    act(() => {
      vi.advanceTimersByTime(200)
    })

    expect(tearoffCreate).not.toHaveBeenCalled()
  })

  it('tracks screenX/screenY from dragover events', () => {
    const { result } = renderHook(() => useTearoffDrag())

    act(() => {
      result.current.startDrag(SAMPLE_PAYLOAD)
    })

    // Multiple dragover events — last one should win
    fireDragOver(100, 200)
    fireDragOver(300, 400)
    fireDragOver(500, 600)

    fireDragLeave(document.documentElement)

    act(() => {
      vi.advanceTimersByTime(200)
    })

    expect(tearoffCreate).toHaveBeenCalledWith(
      expect.objectContaining({ screenX: 500, screenY: 600 })
    )
  })

  it('ignores dragover with screenX=0 and screenY=0', () => {
    const { result } = renderHook(() => useTearoffDrag())

    act(() => {
      result.current.startDrag(SAMPLE_PAYLOAD)
    })

    fireDragOver(400, 300)
    // Chromium spurious 0,0 event — should NOT overwrite 400,300
    fireDragOver(0, 0)

    fireDragLeave(document.documentElement)

    act(() => {
      vi.advanceTimersByTime(200)
    })

    expect(tearoffCreate).toHaveBeenCalledWith(
      expect.objectContaining({ screenX: 400, screenY: 300 })
    )
  })

  it('prevents double tear-off via tearoffCreated flag', () => {
    const { result } = renderHook(() => useTearoffDrag())

    act(() => {
      result.current.startDrag(SAMPLE_PAYLOAD)
    })

    fireDragLeave(document.documentElement)
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(tearoffCreate).toHaveBeenCalledOnce()

    // Fire dragleave again without resetting state — tearoffCreated=true and no new timer
    fireDragLeave(document.documentElement)
    act(() => {
      vi.advanceTimersByTime(200)
    })

    // Should still only be called once
    expect(tearoffCreate).toHaveBeenCalledOnce()
  })

  it('resets state after endDrag — subsequent dragleave does not trigger tearoff', () => {
    const { result } = renderHook(() => useTearoffDrag())

    act(() => {
      result.current.startDrag(SAMPLE_PAYLOAD)
    })

    fireDragLeave(document.documentElement)

    act(() => {
      vi.advanceTimersByTime(50)
      result.current.endDrag()
      vi.advanceTimersByTime(200)
    })

    expect(tearoffCreate).not.toHaveBeenCalled()
  })

  it('clears pending timer on dragend event', () => {
    const { result } = renderHook(() => useTearoffDrag())

    act(() => {
      result.current.startDrag(SAMPLE_PAYLOAD)
    })

    fireDragLeave(document.documentElement)

    // dragend fires before 200ms
    act(() => {
      vi.advanceTimersByTime(100)
      fireDragEnd()
      vi.advanceTimersByTime(200)
    })

    expect(tearoffCreate).not.toHaveBeenCalled()
  })

  it('ignores dragleave events not targeting documentElement', () => {
    const { result } = renderHook(() => useTearoffDrag())

    act(() => {
      result.current.startDrag(SAMPLE_PAYLOAD)
    })

    // Fire dragleave on a child element instead
    const div = document.createElement('div')
    document.body.appendChild(div)
    fireDragLeave(div)
    document.body.removeChild(div)

    act(() => {
      vi.advanceTimersByTime(200)
    })

    expect(tearoffCreate).not.toHaveBeenCalled()
  })
})
