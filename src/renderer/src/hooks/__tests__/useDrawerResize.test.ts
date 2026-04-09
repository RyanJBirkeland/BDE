import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useDrawerResize } from '../useDrawerResize'

describe('useDrawerResize', () => {
  beforeEach(() => {
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  })

  afterEach(() => {
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  })

  it('initialises width to defaultWidth', () => {
    const { result } = renderHook(() =>
      useDrawerResize({ defaultWidth: 400, minWidth: 200, maxWidth: 700 })
    )
    expect(result.current.width).toBe(400)
  })

  it('increases width when dragged left', () => {
    const { result } = renderHook(() =>
      useDrawerResize({ defaultWidth: 400, minWidth: 200, maxWidth: 700 })
    )

    act(() => {
      result.current.handleResizeStart({
        preventDefault: () => {},
        clientX: 500
      } as React.MouseEvent)
    })

    act(() => {
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 450 }))
    })

    expect(result.current.width).toBe(450)

    act(() => {
      document.dispatchEvent(new MouseEvent('mouseup'))
    })
  })

  it('clamps width to minWidth', () => {
    const { result } = renderHook(() =>
      useDrawerResize({ defaultWidth: 400, minWidth: 300, maxWidth: 700 })
    )

    act(() => {
      result.current.handleResizeStart({
        preventDefault: () => {},
        clientX: 500
      } as React.MouseEvent)
    })

    act(() => {
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 900 }))
    })

    expect(result.current.width).toBe(300)

    act(() => {
      document.dispatchEvent(new MouseEvent('mouseup'))
    })
  })

  it('clamps width to maxWidth', () => {
    const { result } = renderHook(() =>
      useDrawerResize({ defaultWidth: 400, minWidth: 200, maxWidth: 500 })
    )

    act(() => {
      result.current.handleResizeStart({
        preventDefault: () => {},
        clientX: 500
      } as React.MouseEvent)
    })

    act(() => {
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 0 }))
    })

    expect(result.current.width).toBe(500)

    act(() => {
      document.dispatchEvent(new MouseEvent('mouseup'))
    })
  })

  it('sets col-resize cursor on drag start and resets on mouseup', () => {
    const { result } = renderHook(() =>
      useDrawerResize({ defaultWidth: 400, minWidth: 200, maxWidth: 700 })
    )

    act(() => {
      result.current.handleResizeStart({
        preventDefault: () => {},
        clientX: 500
      } as React.MouseEvent)
    })

    expect(document.body.style.cursor).toBe('col-resize')

    act(() => {
      document.dispatchEvent(new MouseEvent('mouseup'))
    })

    expect(document.body.style.cursor).toBe('')
  })

  it('cleans up document listeners on unmount during drag', () => {
    const { result, unmount } = renderHook(() =>
      useDrawerResize({ defaultWidth: 400, minWidth: 200, maxWidth: 700 })
    )

    act(() => {
      result.current.handleResizeStart({
        preventDefault: () => {},
        clientX: 500
      } as React.MouseEvent)
    })

    expect(document.body.style.cursor).toBe('col-resize')

    unmount()

    expect(document.body.style.cursor).toBe('')
  })
})
