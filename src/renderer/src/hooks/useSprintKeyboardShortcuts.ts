/**
 * useSprintKeyboardShortcuts — keyboard shortcuts for the Sprint Center view.
 * N -> new ticket, Escape -> close drawers/modal.
 */
import { useEffect, type Dispatch, type SetStateAction } from 'react'
import { useSprintUI } from '../stores/sprintUI'

interface UseSprintKeyboardShortcutsArgs {
  setModalOpen: Dispatch<SetStateAction<boolean>>
  setConflictDrawerOpen: Dispatch<SetStateAction<boolean>>
}

export function useSprintKeyboardShortcuts({
  setModalOpen,
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
        setModalOpen(false)
        setConflictDrawerOpen(false)
        return
      }

      if (
        e.key === 'n' &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        document.activeElement?.tagName !== 'INPUT' &&
        document.activeElement?.tagName !== 'TEXTAREA'
      ) {
        e.preventDefault()
        setModalOpen(true)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedTaskId, setLogDrawerTaskId, setModalOpen, setConflictDrawerOpen])
}
