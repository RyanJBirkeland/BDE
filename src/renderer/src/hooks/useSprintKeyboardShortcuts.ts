/**
 * useSprintKeyboardShortcuts — keyboard shortcuts for the Sprint Center view.
 * Escape -> close drawers, R -> retry selected task, D -> delete selected task, ? -> shortcuts help.
 * Note: Cmd+N global shortcut (in App.tsx) opens quick-create bar.
 */
import { useEffect, type Dispatch, type SetStateAction } from 'react'
import { useSprintSelection } from '../stores/sprintSelection'
import { useSprintUI } from '../stores/sprintUI'
import { useSprintTasks } from '../stores/sprintTasks'
import type { SprintTask } from '../../../shared/types'

interface UseSprintKeyboardShortcutsArgs {
  openWorkbench: () => void
  setConflictDrawerOpen: Dispatch<SetStateAction<boolean>>
  onRetry?: ((task: SprintTask) => void) | undefined
  onDelete?: ((task: SprintTask) => void) | undefined
}

function isTextInput(): boolean {
  const el = document.activeElement
  if (!el) return false
  const tag = el.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    (el as HTMLElement).isContentEditable
  )
}

export function useSprintKeyboardShortcuts({
  openWorkbench,
  setConflictDrawerOpen,
  onRetry,
  onDelete
}: UseSprintKeyboardShortcutsArgs): void {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        const selState = useSprintSelection.getState()
        const uiState = useSprintUI.getState()

        // If spec panel is open, let SpecPanel handle Escape (unsaved-changes guard)
        if (selState.specPanelOpen) return

        // If drawer open or task selected → close drawer + deselect
        if (selState.drawerOpen || selState.selectedTaskId) {
          selState.setSelectedTaskId(null)
          selState.setDrawerOpen(false)
          return
        }

        // Otherwise → close log/conflict/health drawers
        selState.setLogDrawerTaskId(null)
        setConflictDrawerOpen(false)
        uiState.setHealthCheckDrawerOpen(false)
        return
      }

      // Skip action keys when typing in inputs
      if (e.metaKey || e.ctrlKey || e.altKey || isTextInput()) return

      // Action keys that operate on the selected task
      const selectedId = useSprintSelection.getState().selectedTaskId
      if (selectedId) {
        const task = useSprintTasks.getState().tasks.find((t) => t.id === selectedId)
        if (!task) return

        if (e.key === 'r' && onRetry) {
          if (task.status === 'failed' || task.status === 'error') {
            e.preventDefault()
            onRetry(task)
          }
          return
        }

        if (e.key === 'd' && onDelete) {
          e.preventDefault()
          onDelete(task)
          return
        }
      }

      if (e.key === '?') {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('bde:toggle-shortcuts-help'))
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [openWorkbench, setConflictDrawerOpen, onRetry, onDelete])
}
