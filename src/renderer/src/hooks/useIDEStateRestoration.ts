import { useEffect } from 'react'
import { useIDEStore } from '../stores/ide'

export function useIDEStateRestoration(): void {
  useEffect(() => {
    const restore = async (): Promise<void> => {
      try {
        const saved = await window.api.settings.getJson('ide.state')
        if (!saved || typeof saved !== 'object') return
        const state = saved as {
          rootPath?: string
          openTabs?: { filePath: string }[]
          activeFilePath?: string
          sidebarCollapsed?: boolean
          terminalCollapsed?: boolean
          recentFolders?: string[]
          expandedDirs?: Record<string, boolean>
          minimapEnabled?: boolean
          wordWrapEnabled?: boolean
          fontSize?: number
        }
        // Set watchDir FIRST so ideRootPath is ready before any readFile calls
        if (state.rootPath) await window.api.fs.watchDir(state.rootPath)
        useIDEStore.setState({
          rootPath: state.rootPath ?? null,
          sidebarCollapsed: state.sidebarCollapsed ?? false,
          terminalCollapsed: state.terminalCollapsed ?? false,
          recentFolders: state.recentFolders ?? [],
          expandedDirs: state.expandedDirs ?? {},
          minimapEnabled: state.minimapEnabled ?? true,
          wordWrapEnabled: state.wordWrapEnabled ?? false,
          fontSize: state.fontSize ?? 13
        })
        if (state.openTabs) {
          for (const tab of state.openTabs) {
            useIDEStore.getState().openTab(tab.filePath)
          }
          if (state.activeFilePath) {
            const match = useIDEStore
              .getState()
              .openTabs.find((t) => t.filePath === state.activeFilePath)
            if (match) useIDEStore.getState().setActiveTab(match.id)
          }
        }
      } catch (err) {
        console.error('Failed to restore IDE state:', err)
      }
    }
    void restore()
  }, [])
}
