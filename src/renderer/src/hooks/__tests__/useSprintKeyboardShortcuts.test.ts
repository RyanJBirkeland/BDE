import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useSprintKeyboardShortcuts } from '../useSprintKeyboardShortcuts'

// Mock sprintUI store
let mockSelectedTaskId: string | null = null
const mockSetLogDrawerTaskId = vi.fn()

vi.mock('../../stores/sprintUI', () => {
  const store = vi.fn((sel: (s: unknown) => unknown) =>
    sel({
      selectedTaskId: mockSelectedTaskId,
      setLogDrawerTaskId: mockSetLogDrawerTaskId
    })
  )
  ;(store as any).getState = () => ({
    selectedTaskId: mockSelectedTaskId,
    setLogDrawerTaskId: mockSetLogDrawerTaskId
  })
  return { useSprintUI: store }
})

function fireKeydown(key: string, extra: Partial<KeyboardEventInit> = {}): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...extra }))
}

describe('useSprintKeyboardShortcuts', () => {
  const openWorkbench = vi.fn()
  const setConflictDrawerOpen = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockSelectedTaskId = null
    // reset active element to body
    ;(document.activeElement as HTMLElement | null)?.blur?.()
  })

  it('pressing n opens the modal when no input is focused', () => {
    renderHook(() => useSprintKeyboardShortcuts({ openWorkbench, setConflictDrawerOpen }))

    fireKeydown('n')

    expect(openWorkbench).toHaveBeenCalled()
  })

  it('pressing n does nothing when an INPUT is focused', () => {
    renderHook(() => useSprintKeyboardShortcuts({ openWorkbench, setConflictDrawerOpen }))

    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()

    fireKeydown('n')

    expect(openWorkbench).not.toHaveBeenCalled()
    document.body.removeChild(input)
  })

  it('pressing n does nothing when a TEXTAREA is focused', () => {
    renderHook(() => useSprintKeyboardShortcuts({ openWorkbench, setConflictDrawerOpen }))

    const textarea = document.createElement('textarea')
    document.body.appendChild(textarea)
    textarea.focus()

    fireKeydown('n')

    expect(openWorkbench).not.toHaveBeenCalled()
    document.body.removeChild(textarea)
  })

  it('pressing n does nothing when a SELECT is focused', () => {
    renderHook(() => useSprintKeyboardShortcuts({ openWorkbench, setConflictDrawerOpen }))

    const select = document.createElement('select')
    document.body.appendChild(select)
    select.focus()

    fireKeydown('n')

    expect(openWorkbench).not.toHaveBeenCalled()
    document.body.removeChild(select)
  })

  it('pressing n with metaKey does nothing', () => {
    renderHook(() => useSprintKeyboardShortcuts({ openWorkbench, setConflictDrawerOpen }))

    fireKeydown('n', { metaKey: true })

    expect(openWorkbench).not.toHaveBeenCalled()
  })

  it('pressing n with ctrlKey does nothing', () => {
    renderHook(() => useSprintKeyboardShortcuts({ openWorkbench, setConflictDrawerOpen }))

    fireKeydown('n', { ctrlKey: true })

    expect(openWorkbench).not.toHaveBeenCalled()
  })

  it('pressing n with altKey does nothing', () => {
    renderHook(() => useSprintKeyboardShortcuts({ openWorkbench, setConflictDrawerOpen }))

    fireKeydown('n', { altKey: true })

    expect(openWorkbench).not.toHaveBeenCalled()
  })

  it('pressing Escape closes conflict drawer when no task is selected', () => {
    renderHook(() => useSprintKeyboardShortcuts({ openWorkbench, setConflictDrawerOpen }))

    fireKeydown('Escape')

    expect(mockSetLogDrawerTaskId).toHaveBeenCalledWith(null)
    expect(setConflictDrawerOpen).toHaveBeenCalledWith(false)
  })

  it('pressing Escape does nothing to modal/drawer when a task is selected (SpecDrawer handles it)', () => {
    mockSelectedTaskId = 'task-123'

    renderHook(() => useSprintKeyboardShortcuts({ openWorkbench, setConflictDrawerOpen }))

    fireKeydown('Escape')

    expect(mockSetLogDrawerTaskId).not.toHaveBeenCalled()
    expect(setConflictDrawerOpen).not.toHaveBeenCalled()
  })

  it('cleans up event listener on unmount', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener')

    const { unmount } = renderHook(() =>
      useSprintKeyboardShortcuts({ openWorkbench, setConflictDrawerOpen })
    )

    unmount()

    expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function))
    removeSpy.mockRestore()
  })

  it('re-registers listener when selectedTaskId changes', () => {
    const addSpy = vi.spyOn(window, 'addEventListener')

    const { rerender } = renderHook(() =>
      useSprintKeyboardShortcuts({ openWorkbench, setConflictDrawerOpen })
    )

    const callsBefore = addSpy.mock.calls.length

    // Change selectedTaskId
    mockSelectedTaskId = 'task-xyz'
    rerender()

    expect(addSpy.mock.calls.length).toBeGreaterThan(callsBefore)
    addSpy.mockRestore()
  })
})
