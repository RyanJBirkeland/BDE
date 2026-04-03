import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDiffSelection } from '../useDiffSelection'
import type { LineRange } from '../../components/diff/DiffViewer'

describe('useDiffSelection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('initializes with null selectionStart and false isSelecting', () => {
    const { result } = renderHook(() => useDiffSelection())
    expect(result.current.selectionStart).toBeNull()
    expect(result.current.isSelecting).toBe(false)
  })

  it('updates selectionStart when setSelectionStart is called', () => {
    const { result } = renderHook(() => useDiffSelection())
    act(() => {
      result.current.setSelectionStart({ file: 'test.ts', line: 10, side: 'LEFT' })
    })
    expect(result.current.selectionStart).toEqual({ file: 'test.ts', line: 10, side: 'LEFT' })
  })

  it('updates isSelecting when setIsSelecting is called', () => {
    const { result } = renderHook(() => useDiffSelection())
    act(() => {
      result.current.setIsSelecting(true)
    })
    expect(result.current.isSelecting).toBe(true)
  })

  it('sets isSelecting to false on mouseup', () => {
    const { result } = renderHook(() => useDiffSelection())
    act(() => {
      result.current.setIsSelecting(true)
    })
    expect(result.current.isSelecting).toBe(true)

    act(() => {
      window.dispatchEvent(new MouseEvent('mouseup'))
    })
    expect(result.current.isSelecting).toBe(false)
  })

  it('cleans up mouseup listener on unmount', () => {
    const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener')
    const { unmount } = renderHook(() => useDiffSelection())
    unmount()
    expect(removeEventListenerSpy).toHaveBeenCalledWith('mouseup', expect.any(Function))
  })

  describe('isLineSelected', () => {
    it('returns false when selectedRange is null', () => {
      const { result } = renderHook(() => useDiffSelection())
      expect(result.current.isLineSelected('test.ts', 10, null)).toBe(false)
    })

    it('returns false when lineNo is undefined', () => {
      const { result } = renderHook(() => useDiffSelection())
      const range: LineRange = { file: 'test.ts', startLine: 5, endLine: 10, side: 'LEFT' }
      expect(result.current.isLineSelected('test.ts', undefined, range)).toBe(false)
    })

    it('returns false when file does not match', () => {
      const { result } = renderHook(() => useDiffSelection())
      const range: LineRange = { file: 'test.ts', startLine: 5, endLine: 10, side: 'LEFT' }
      expect(result.current.isLineSelected('other.ts', 7, range)).toBe(false)
    })

    it('returns false when line is before startLine', () => {
      const { result } = renderHook(() => useDiffSelection())
      const range: LineRange = { file: 'test.ts', startLine: 5, endLine: 10, side: 'LEFT' }
      expect(result.current.isLineSelected('test.ts', 3, range)).toBe(false)
    })

    it('returns false when line is after endLine', () => {
      const { result } = renderHook(() => useDiffSelection())
      const range: LineRange = { file: 'test.ts', startLine: 5, endLine: 10, side: 'LEFT' }
      expect(result.current.isLineSelected('test.ts', 12, range)).toBe(false)
    })

    it('returns true when line is within range', () => {
      const { result } = renderHook(() => useDiffSelection())
      const range: LineRange = { file: 'test.ts', startLine: 5, endLine: 10, side: 'LEFT' }
      expect(result.current.isLineSelected('test.ts', 7, range)).toBe(true)
    })

    it('returns true when line equals startLine', () => {
      const { result } = renderHook(() => useDiffSelection())
      const range: LineRange = { file: 'test.ts', startLine: 5, endLine: 10, side: 'LEFT' }
      expect(result.current.isLineSelected('test.ts', 5, range)).toBe(true)
    })

    it('returns true when line equals endLine', () => {
      const { result } = renderHook(() => useDiffSelection())
      const range: LineRange = { file: 'test.ts', startLine: 5, endLine: 10, side: 'LEFT' }
      expect(result.current.isLineSelected('test.ts', 10, range)).toBe(true)
    })

    it('is stable across re-renders', () => {
      const { result, rerender } = renderHook(() => useDiffSelection())
      const firstIsLineSelected = result.current.isLineSelected
      rerender()
      expect(result.current.isLineSelected).toBe(firstIsLineSelected)
    })
  })
})
