import { useEffect } from 'react'

interface IDETab {
  isDirty: boolean
}

export function useIDEUnsavedGuard(openTabs: IDETab[]): void {
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent): void => {
      const hasDirtyTabs = openTabs.some((t) => t.isDirty)
      if (hasDirtyTabs) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [openTabs])
}
