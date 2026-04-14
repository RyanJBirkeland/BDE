import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useSprintKeyboardShortcuts } from '../useSprintKeyboardShortcuts'

const mockSetSelectedTaskId = vi.fn()
const mockSetDrawerOpen = vi.fn()
const mockSetLogDrawerTaskId = vi.fn()
const mockSetHealthCheckDrawerOpen = vi.fn()

let mockSelectionState = {
  selectedTaskId: null as string | null,
  drawerOpen: false,
  specPanelOpen: false,
  setSelectedTaskId: mockSetSelectedTaskId,
  setDrawerOpen: mockSetDrawerOpen,
  setLogDrawerTaskId: mockSetLogDrawerTaskId
}

let mockUIState = {
  setHealthCheckDrawerOpen: mockSetHealthCheckDrawerOpen
}

vi.mock('../../stores/sprintSelection', () => {
  const store = vi.fn((sel: (s: unknown) => unknown) => sel(mockSelectionState))
  ;(store as any).getState = () => mockSelectionState
  return { useSprintSelection: store }
})

vi.mock('../../stores/sprintUI', () => {
  const store = vi.fn((sel: (s: unknown) => unknown) => sel(mockUIState))
  ;(store as any).getState = () => mockUIState
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
    mockSelectionState = {
      selectedTaskId: null,
      drawerOpen: false,
      specPanelOpen: false,
      setSelectedTaskId: mockSetSelectedTaskId,
      setDrawerOpen: mockSetDrawerOpen,
      setLogDrawerTaskId: mockSetLogDrawerTaskId
    }
    mockUIState = {
      setHealthCheckDrawerOpen: mockSetHealthCheckDrawerOpen
    }
    ;(document.activeElement as HTMLElement | null)?.blur?.()
  })

  it('pressing Escape closes log/conflict/health drawers when no task selected and drawer closed', () => {
    renderHook(() => useSprintKeyboardShortcuts({ openWorkbench, setConflictDrawerOpen }))

    fireKeydown('Escape')

    expect(mockSetLogDrawerTaskId).toHaveBeenCalledWith(null)
    expect(setConflictDrawerOpen).toHaveBeenCalledWith(false)
    expect(mockSetHealthCheckDrawerOpen).toHaveBeenCalledWith(false)
  })

  it('pressing Escape closes drawer and deselects task when task is selected', () => {
    mockSelectionState.selectedTaskId = 'task-123'
    mockSelectionState.drawerOpen = true

    renderHook(() => useSprintKeyboardShortcuts({ openWorkbench, setConflictDrawerOpen }))

    fireKeydown('Escape')

    expect(mockSetSelectedTaskId).toHaveBeenCalledWith(null)
    expect(mockSetDrawerOpen).toHaveBeenCalledWith(false)
    expect(mockSetLogDrawerTaskId).not.toHaveBeenCalled()
  })

  it('pressing Escape does nothing when spec panel is open (let SpecPanel handle it)', () => {
    mockSelectionState.specPanelOpen = true

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

    mockSelectionState.selectedTaskId = 'task-xyz'
    mockSelectionState.drawerOpen = true

    fireKeydown('Escape')

    expect(mockSetSelectedTaskId).toHaveBeenCalledWith(null)
    expect(mockSetDrawerOpen).toHaveBeenCalledWith(false)
  })
})
