import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useRovingTabIndex } from '../useRovingTabIndex'

// eslint-disable-next-line react-hooks/rules-of-hooks -- test helper wraps hook in renderHook
function createHook(activeIndex = 0, count = 5) {
  const onSelect = vi.fn()
  const { result } = renderHook(() => useRovingTabIndex({ count, activeIndex, onSelect }))
  return { onSelect, ...result.current }
}

function makeEvent(key: string) {
  return {
    key,
    preventDefault: vi.fn(),
    currentTarget: {
      parentElement: {
        children: Array.from({ length: 5 }, () => ({ focus: vi.fn() }))
      }
    }
  } as unknown as React.KeyboardEvent
}

describe('useRovingTabIndex', () => {
  it('returns getTabProps function', () => {
    const { getTabProps } = createHook()
    expect(typeof getTabProps).toBe('function')
  })

  it('sets tabIndex 0 for active tab, -1 for others', () => {
    const { getTabProps } = createHook(2)
    expect(getTabProps(2).tabIndex).toBe(0)
    expect(getTabProps(0).tabIndex).toBe(-1)
    expect(getTabProps(1).tabIndex).toBe(-1)
  })

  it('ArrowRight navigates to next tab', () => {
    const { getTabProps, onSelect } = createHook(0)
    const event = makeEvent('ArrowRight')
    getTabProps(0).onKeyDown(event)
    expect(onSelect).toHaveBeenCalledWith(1)
    expect(event.preventDefault).toHaveBeenCalled()
  })

  it('ArrowRight wraps from last to first', () => {
    const { getTabProps, onSelect } = createHook(4, 5)
    getTabProps(4).onKeyDown(makeEvent('ArrowRight'))
    expect(onSelect).toHaveBeenCalledWith(0)
  })

  it('ArrowLeft navigates to previous tab', () => {
    const { getTabProps, onSelect } = createHook(2)
    getTabProps(2).onKeyDown(makeEvent('ArrowLeft'))
    expect(onSelect).toHaveBeenCalledWith(1)
  })

  it('ArrowLeft wraps from first to last', () => {
    const { getTabProps, onSelect } = createHook(0, 5)
    getTabProps(0).onKeyDown(makeEvent('ArrowLeft'))
    expect(onSelect).toHaveBeenCalledWith(4)
  })

  it('Home navigates to first tab', () => {
    const { getTabProps, onSelect } = createHook(3)
    getTabProps(3).onKeyDown(makeEvent('Home'))
    expect(onSelect).toHaveBeenCalledWith(0)
  })

  it('End navigates to last tab', () => {
    const { getTabProps, onSelect } = createHook(0, 5)
    getTabProps(0).onKeyDown(makeEvent('End'))
    expect(onSelect).toHaveBeenCalledWith(4)
  })

  it('ArrowDown works like ArrowRight', () => {
    const { getTabProps, onSelect } = createHook(0)
    getTabProps(0).onKeyDown(makeEvent('ArrowDown'))
    expect(onSelect).toHaveBeenCalledWith(1)
  })

  it('ArrowUp works like ArrowLeft', () => {
    const { getTabProps, onSelect } = createHook(2)
    getTabProps(2).onKeyDown(makeEvent('ArrowUp'))
    expect(onSelect).toHaveBeenCalledWith(1)
  })

  it('ignores unrelated keys', () => {
    const { getTabProps, onSelect } = createHook(0)
    getTabProps(0).onKeyDown(makeEvent('a'))
    expect(onSelect).not.toHaveBeenCalled()
  })
})
