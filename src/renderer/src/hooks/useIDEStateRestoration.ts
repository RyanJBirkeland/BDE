import { useEffect } from 'react'
import { useIDEStore } from '../stores/ide'

export function useIDEStateRestoration(): void {
  useEffect(() => {
    const restore = async (): Promise<void> => {
      try {
        const saved = await window.api.settings.getJson('ide.state')
        if (!saved || typeof saved !== 'object') return
        const state = saved as {
          rootPath?: string | undefined
          openTabs?: { filePath: string }[] | undefined
          activeFilePath?: string | undefined
          sidebarCollapsed?: boolean | undefined
          terminalCollapsed?: boolean | undefined
          recentFolders?: string[] | undefined
          expandedDirs?: Record<string, boolean> | undefined
          minimapEnabled?: boolean | undefined
          wordWrapEnabled?: boolean | undefined
          fontSize?: number | undefined
        }

        // Skip rootPath if it no longer exists on this machine (e.g., migrated from another machine).
        // A missing rootPath is benign — user can re-open a folder.
        //
        // We validate + set the IDE root via `fs.watchDir` (which throws on
        // missing / inaccessible paths) *before* any `fs.stat` call — every
        // `fs.stat` handler short-circuits with "No IDE root path set — call
        // fs:watchDir first" until the root has been registered.
        if (state.rootPath) {
          try {
            await window.api.fs.watchDir(state.rootPath)
          } catch {
            state.rootPath = undefined
            state.openTabs = undefined
            state.activeFilePath = undefined
            state.expandedDirs = undefined
          }
        }
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
          // Filter out any tabs whose paths don't exist on this machine
          const tabChecks = await Promise.all(
            state.openTabs.map(async (tab) => {
              const stat = await window.api.fs.stat(tab.filePath)
              return stat ? tab : null
            })
          )
          const validTabs = tabChecks.filter((t): t is { filePath: string } => t !== null)

          for (const tab of validTabs) {
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
