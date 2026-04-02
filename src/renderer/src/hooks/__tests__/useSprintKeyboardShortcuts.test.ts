import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useSprintKeyboardShortcuts } from '../useSprintKeyboardShortcuts'

// Mock sprintUI store
const mockSetSelectedTaskId = vi.fn()
const mockSetDrawerOpen = vi.fn()
const mockSetLogDrawerTaskId = vi.fn()
const mockSetHealthCheckDrawerOpen = vi.fn()

let mockState = {
  selectedTaskId: null as string | null,
  drawerOpen: false,
  specPanelOpen: false,
  setSelectedTaskId: mockSetSelectedTaskId,
  setDrawerOpen: mockSetDrawerOpen,
  setLogDrawerTaskId: mockSetLogDrawerTaskId,
  setHealthCheckDrawerOpen: mockSetHealthCheckDrawerOpen
}

vi.mock('../../stores/sprintUI', () => {
  const store = vi.fn((sel: (s: unknown) => unknown) =>
    sel(mockState)
  )
  ;(store as any).getState = () => mockState
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
    mockState = {
      selectedTaskId: null,
      drawerOpen: false,
      specPanelOpen: false,
      setSelectedTaskId: mockSetSelectedTaskId,
      setDrawerOpen: mockSetDrawerOpen,
      setLogDrawerTaskId: mockSetLogDrawerTaskId,
      setHealthCheckDrawerOpen: mockSetHealthCheckDrawerOpen
    }
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

  it('pressing Escape closes log/conflict/health drawers when no task selected and drawer closed', () => {
    renderHook(() => useSprintKeyboardShortcuts({ openWorkbench, setConflictDrawerOpen }))

    fireKeydown('Escape')

    expect(mockSetLogDrawerTaskId).toHaveBeenCalledWith(null)
    expect(setConflictDrawerOpen).toHaveBeenCalledWith(false)
    expect(mockSetHealthCheckDrawerOpen).toHaveBeenCalledWith(false)
  })

  it('pressing Escape closes drawer and deselects task when task is selected', () => {
    mockState.selectedTaskId = 'task-123'
    mockState.drawerOpen = true

    renderHook(() => useSprintKeyboardShortcuts({ openWorkbench, setConflictDrawerOpen }))

    fireKeydown('Escape')

    expect(mockSetSelectedTaskId).toHaveBeenCalledWith(null)
    expect(mockSetDrawerOpen).toHaveBeenCalledWith(false)
    // Should NOT close log/conflict drawers in this layer
    expect(mockSetLogDrawerTaskId).not.toHaveBeenCalled()
  })

  it('pressing Escape does nothing when spec panel is open (let SpecPanel handle it)', () => {
    mockState.specPanelOpen = true

    renderHook(() => useSprintKeyboardShortcuts({ openWorkbench, setConflictDrawerOpen }))

    fireKeydown('Escape')

    expect(mockSetSelectedTaskId).not.toHaveBeenCalled()
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

  it('reads state synchronously via getState() (no re-registration needed)', () => {
    renderHook(() => useSprintKeyboardShortcuts({ openWorkbench, setConflictDrawerOpen }))

    // Change state after hook mounts — handler should see it via getState()
    mockState.selectedTaskId = 'task-xyz'
    mockState.drawerOpen = true

    fireKeydown('Escape')

    expect(mockSetSelectedTaskId).toHaveBeenCalledWith(null)
    expect(mockSetDrawerOpen).toHaveBeenCalledWith(false)
  })
})
