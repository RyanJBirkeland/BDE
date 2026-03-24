/**
 * useSprintKeyboardShortcuts — keyboard shortcuts for the Sprint Center view.
 * N -> open task workbench, Escape -> close drawers.
 */
import { useEffect, type Dispatch, type SetStateAction } from 'react'
import { useSprintUI } from '../stores/sprintUI'

interface UseSprintKeyboardShortcutsArgs {
  openWorkbench: () => void
  setConflictDrawerOpen: Dispatch<SetStateAction<boolean>>
}

export function useSprintKeyboardShortcuts({
  openWorkbench,
  setConflictDrawerOpen,
}: UseSprintKeyboardShortcutsArgs): void {
  const selectedTaskId = useSprintUI((s) => s.selectedTaskId)
  const setLogDrawerTaskId = useSprintUI((s) => s.setLogDrawerTaskId)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // If SpecDrawer is open, let it handle Escape (unsaved-changes guard)
        if (selectedTaskId) return
        setLogDrawerTaskId(null)
        setConflictDrawerOpen(false)
        return
      }

      if (
        e.key === 'n' &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        document.activeElement?.tagName !== 'INPUT' &&
        document.activeElement?.tagName !== 'TEXTAREA' &&
        document.activeElement?.tagName !== 'SELECT' &&
        !(document.activeElement as HTMLElement)?.isContentEditable
      ) {
        e.preventDefault()
        openWorkbench()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedTaskId, setLogDrawerTaskId, openWorkbench, setConflictDrawerOpen])
}
