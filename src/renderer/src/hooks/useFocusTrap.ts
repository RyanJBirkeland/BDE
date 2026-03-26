import { useEffect } from 'react'
import type { RefObject } from 'react'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(', ')

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
}

/**
 * useFocusTrap — traps keyboard focus inside a container while active.
 *
 * When activated:
 * - Saves the previously focused element
 * - Auto-focuses the first focusable element inside the container
 * - Traps Tab and Shift+Tab within the container
 *
 * When deactivated:
 * - Restores focus to the previously focused element
 * - Removes the keydown listener
 */
export function useFocusTrap(containerRef: RefObject<HTMLElement | null>, active: boolean): void {
  useEffect(() => {
    if (!active || !containerRef.current) return

    const container = containerRef.current
    const previouslyFocused = document.activeElement as HTMLElement | null

    // Focus the first focusable element
    const focusables = getFocusableElements(container)
    if (focusables.length > 0) {
      focusables[0].focus()
    }

    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key !== 'Tab') return

      const elements = getFocusableElements(container)
      if (elements.length === 0) {
        e.preventDefault()
        return
      }

      const first = elements[0]
      const last = elements[elements.length - 1]

      if (e.shiftKey) {
        // Shift+Tab: if focus is on first element, wrap to last
        if (document.activeElement === first) {
          e.preventDefault()
          last.focus()
        }
      } else {
        // Tab: if focus is on last element, wrap to first
        if (document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      previouslyFocused?.focus()
    }
  }, [active, containerRef])
}
