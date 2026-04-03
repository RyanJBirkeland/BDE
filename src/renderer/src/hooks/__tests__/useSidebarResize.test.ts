import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSidebarResize } from '../useSidebarResize'

describe('useSidebarResize', () => {
  it('returns default sidebar width of 240', () => {
    const { result } = renderHook(() => useSidebarResize())
    expect(result.current.sidebarWidth).toBe(240)
  })

  it('returns an onResizeHandleMouseDown function', () => {
    const { result } = renderHook(() => useSidebarResize())
    expect(typeof result.current.onResizeHandleMouseDown).toBe('function')
  })

  it('updates width on mouse drag', () => {
    const { result } = renderHook(() => useSidebarResize())

    // Simulate mousedown at x=240
    act(() => {
      result.current.onResizeHandleMouseDown({
        clientX: 240,
        preventDefault: () => {}
      } as React.MouseEvent)
    })

    // Simulate mousemove to x=300 (delta = +60)
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 300 }))
    })

    // Width should be 240 + 60 = 300
    expect(result.current.sidebarWidth).toBe(300)
  })

  it('clamps width to minimum 180', () => {
    const { result } = renderHook(() => useSidebarResize())

    act(() => {
      result.current.onResizeHandleMouseDown({
        clientX: 240,
        preventDefault: () => {}
      } as React.MouseEvent)
    })

    // Drag left by 200px: 240 - 200 = 40, clamped to 180
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 40 }))
    })

    expect(result.current.sidebarWidth).toBe(180)
  })

  it('clamps width to maximum 400', () => {
    const { result } = renderHook(() => useSidebarResize())

    act(() => {
      result.current.onResizeHandleMouseDown({
        clientX: 240,
        preventDefault: () => {}
      } as React.MouseEvent)
    })

    // Drag right by 500px: 240 + 500 = 740, clamped to 400
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 740 }))
    })

    expect(result.current.sidebarWidth).toBe(400)
  })

  it('stops tracking on mouseup', () => {
    const { result } = renderHook(() => useSidebarResize())

    act(() => {
      result.current.onResizeHandleMouseDown({
        clientX: 240,
        preventDefault: () => {}
      } as React.MouseEvent)
    })

    // Move to 300
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 300 }))
    })
    expect(result.current.sidebarWidth).toBe(300)

    // Mouse up
    act(() => {
      window.dispatchEvent(new MouseEvent('mouseup'))
    })

    // Further moves should not change width
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 400 }))
    })
    expect(result.current.sidebarWidth).toBe(300)
  })
})
