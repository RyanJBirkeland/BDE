/**
 * useRovingTabIndex — Keyboard navigation pattern for tab lists
 * Returns tabIndex value and keyDown handler for roving tabindex accessibility
 */

interface UseRovingTabIndexParams {
  /** Total number of tabs */
  count: number
  /** Index of the currently active tab */
  activeIndex: number
  /** Called when user navigates to a different tab */
  onSelect: (index: number) => void
}

export function useRovingTabIndex({
  count,
  activeIndex,
  onSelect
}: UseRovingTabIndexParams): {
  getTabProps: (index: number) => {
    tabIndex: number
    onKeyDown: (e: React.KeyboardEvent) => void
  }
} {
  const handleKeyDown = (index: number) => (e: React.KeyboardEvent) => {
    let nextIndex: number | null = null

    switch (e.key) {
      case 'ArrowLeft':
      case 'ArrowUp':
        e.preventDefault()
        nextIndex = index > 0 ? index - 1 : count - 1
        break
      case 'ArrowRight':
      case 'ArrowDown':
        e.preventDefault()
        nextIndex = index < count - 1 ? index + 1 : 0
        break
      case 'Home':
        e.preventDefault()
        nextIndex = 0
        break
      case 'End':
        e.preventDefault()
        nextIndex = count - 1
        break
    }

    if (nextIndex !== null) {
      onSelect(nextIndex)
      // Move DOM focus to the newly active tab
      const target = e.currentTarget.parentElement?.children[nextIndex] as HTMLElement | undefined
      target?.focus()
    }
  }

  return {
    getTabProps: (index: number) => ({
      tabIndex: index === activeIndex ? 0 : -1,
      onKeyDown: handleKeyDown(index)
    })
  }
}
