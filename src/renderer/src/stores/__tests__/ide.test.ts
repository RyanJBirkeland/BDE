import { describe, it, expect, beforeEach } from 'vitest'
import { useIDEStore } from '../ide'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetStore(): void {
  useIDEStore.setState({
    rootPath: null,
    expandedDirs: {},
    openTabs: [],
    activeTabId: null,
    focusedPanel: 'editor',
    sidebarCollapsed: false,
    terminalCollapsed: false,
    recentFolders: [],
    fileContents: {},
    fileLoadingStates: {}
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('IDEStore', () => {
  beforeEach(() => {
    resetStore()
  })

  // --- Initial state ---

  describe('initial state', () => {
    it('has null rootPath', () => {
      expect(useIDEStore.getState().rootPath).toBeNull()
    })

    it('has empty openTabs', () => {
      expect(useIDEStore.getState().openTabs).toHaveLength(0)
    })

    it('has null activeTabId', () => {
      expect(useIDEStore.getState().activeTabId).toBeNull()
    })

    it('has editor as default focusedPanel', () => {
      expect(useIDEStore.getState().focusedPanel).toBe('editor')
    })

    it('has sidebar not collapsed by default', () => {
      expect(useIDEStore.getState().sidebarCollapsed).toBe(false)
    })

    it('has terminal not collapsed by default', () => {
      expect(useIDEStore.getState().terminalCollapsed).toBe(false)
    })

    it('has empty recentFolders', () => {
      expect(useIDEStore.getState().recentFolders).toHaveLength(0)
    })
  })

  // --- setRootPath ---

  describe('setRootPath', () => {
    it('sets rootPath', () => {
      useIDEStore.getState().setRootPath('/home/user/project')
      expect(useIDEStore.getState().rootPath).toBe('/home/user/project')
    })

    it('resets expandedDirs when root changes', () => {
      useIDEStore.getState().toggleDir('/home/user/project/src')
      useIDEStore.getState().setRootPath('/home/user/other')
      expect(useIDEStore.getState().expandedDirs).toEqual({})
    })

    it('adds folder to recentFolders', () => {
      useIDEStore.getState().setRootPath('/home/user/project')
      expect(useIDEStore.getState().recentFolders).toContain('/home/user/project')
    })

    it('puts most recent folder first', () => {
      useIDEStore.getState().setRootPath('/folder/a')
      useIDEStore.getState().setRootPath('/folder/b')
      expect(useIDEStore.getState().recentFolders[0]).toBe('/folder/b')
    })

    it('does not duplicate folders in recentFolders', () => {
      useIDEStore.getState().setRootPath('/folder/a')
      useIDEStore.getState().setRootPath('/folder/b')
      useIDEStore.getState().setRootPath('/folder/a')
      const { recentFolders } = useIDEStore.getState()
      const count = recentFolders.filter((f) => f === '/folder/a').length
      expect(count).toBe(1)
      expect(recentFolders[0]).toBe('/folder/a')
    })

    it('keeps max 5 recent folders', () => {
      for (let i = 1; i <= 7; i++) {
        useIDEStore.getState().setRootPath(`/folder/${i}`)
      }
      expect(useIDEStore.getState().recentFolders).toHaveLength(5)
    })
  })

  // --- openTab ---

  describe('openTab', () => {
    it('opens a new tab', () => {
      useIDEStore.getState().openTab('/src/index.ts')
      expect(useIDEStore.getState().openTabs).toHaveLength(1)
      expect(useIDEStore.getState().openTabs[0].filePath).toBe('/src/index.ts')
    })

    it('sets displayName from filename', () => {
      useIDEStore.getState().openTab('/src/components/Button.tsx')
      expect(useIDEStore.getState().openTabs[0].displayName).toBe('Button.tsx')
    })

    it('detects typescript language from .ts extension', () => {
      useIDEStore.getState().openTab('/src/index.ts')
      expect(useIDEStore.getState().openTabs[0].language).toBe('typescript')
    })

    it('detects typescript language from .tsx extension', () => {
      useIDEStore.getState().openTab('/src/App.tsx')
      expect(useIDEStore.getState().openTabs[0].language).toBe('typescript')
    })

    it('detects python language from .py extension', () => {
      useIDEStore.getState().openTab('/scripts/main.py')
      expect(useIDEStore.getState().openTabs[0].language).toBe('python')
    })

    it('detects json language', () => {
      useIDEStore.getState().openTab('/package.json')
      expect(useIDEStore.getState().openTabs[0].language).toBe('json')
    })

    it('defaults to plaintext for unknown extension', () => {
      useIDEStore.getState().openTab('/file.xyz')
      expect(useIDEStore.getState().openTabs[0].language).toBe('plaintext')
    })

    it('sets the new tab as active', () => {
      useIDEStore.getState().openTab('/src/index.ts')
      const { activeTabId, openTabs } = useIDEStore.getState()
      expect(activeTabId).toBe(openTabs[0].id)
    })

    it('does not duplicate tabs for same file', () => {
      useIDEStore.getState().openTab('/src/index.ts')
      useIDEStore.getState().openTab('/src/index.ts')
      expect(useIDEStore.getState().openTabs).toHaveLength(1)
    })

    it('switches to existing tab if file already open', () => {
      useIDEStore.getState().openTab('/src/index.ts')
      useIDEStore.getState().openTab('/src/App.tsx')
      const firstId = useIDEStore.getState().openTabs[0].id
      useIDEStore.getState().openTab('/src/index.ts')
      expect(useIDEStore.getState().activeTabId).toBe(firstId)
      expect(useIDEStore.getState().openTabs).toHaveLength(2)
    })

    it('new tab is not dirty', () => {
      useIDEStore.getState().openTab('/src/index.ts')
      expect(useIDEStore.getState().openTabs[0].isDirty).toBe(false)
    })
  })

  // --- closeTab ---

  describe('closeTab', () => {
    it('removes the tab', () => {
      useIDEStore.getState().openTab('/src/index.ts')
      const tabId = useIDEStore.getState().openTabs[0].id
      useIDEStore.getState().closeTab(tabId)
      expect(useIDEStore.getState().openTabs).toHaveLength(0)
    })

    it('sets activeTabId to null when last tab closed', () => {
      useIDEStore.getState().openTab('/src/index.ts')
      const tabId = useIDEStore.getState().openTabs[0].id
      useIDEStore.getState().closeTab(tabId)
      expect(useIDEStore.getState().activeTabId).toBeNull()
    })

    it('activates next tab when active tab closed', () => {
      useIDEStore.getState().openTab('/src/a.ts')
      useIDEStore.getState().openTab('/src/b.ts')
      const { openTabs } = useIDEStore.getState()
      // b is active, close b
      useIDEStore.getState().closeTab(openTabs[1].id)
      expect(useIDEStore.getState().activeTabId).toBe(openTabs[0].id)
    })

    it('does not change activeTabId when non-active tab closed', () => {
      useIDEStore.getState().openTab('/src/a.ts')
      useIDEStore.getState().openTab('/src/b.ts')
      const { openTabs, activeTabId } = useIDEStore.getState()
      // b is active, close a
      useIDEStore.getState().closeTab(openTabs[0].id)
      expect(useIDEStore.getState().activeTabId).toBe(activeTabId)
    })

    it('is a no-op for unknown tabId', () => {
      useIDEStore.getState().openTab('/src/index.ts')
      const before = useIDEStore.getState().openTabs.length
      useIDEStore.getState().closeTab('nonexistent-id')
      expect(useIDEStore.getState().openTabs).toHaveLength(before)
    })

    it('evicts fileContents and fileLoadingStates when tab is closed', () => {
      const { openTab, closeTab, setFileContent, setFileLoading } = useIDEStore.getState()
      openTab('/test/file.ts')
      const tabId = useIDEStore.getState().openTabs[0].id
      setFileContent('/test/file.ts', 'const x = 1')
      setFileLoading('/test/file.ts', false)

      closeTab(tabId)

      const state = useIDEStore.getState()
      expect(state.fileContents['/test/file.ts']).toBeUndefined()
      expect(state.fileLoadingStates['/test/file.ts']).toBeUndefined()
    })

    it('does not evict fileContents when another tab for the same file is still open', () => {
      const { openTab, closeTab, setFileContent } = useIDEStore.getState()
      openTab('/test/file.ts')
      const firstTabId = useIDEStore.getState().openTabs[0].id
      // Inject a second tab with the same file path directly into the store
      useIDEStore.setState((s) => ({
        openTabs: [
          ...s.openTabs,
          { id: 'tab-2', filePath: '/test/file.ts', displayName: 'file.ts', language: 'typescript', isDirty: false }
        ]
      }))
      setFileContent('/test/file.ts', 'const x = 1')

      closeTab(firstTabId)

      const state = useIDEStore.getState()
      expect(state.fileContents['/test/file.ts']).toBe('const x = 1')
    })
  })

  // --- setDirty ---

  describe('setDirty', () => {
    it('marks a tab dirty', () => {
      useIDEStore.getState().openTab('/src/index.ts')
      const tabId = useIDEStore.getState().openTabs[0].id
      useIDEStore.getState().setDirty(tabId, true)
      expect(useIDEStore.getState().openTabs[0].isDirty).toBe(true)
    })

    it('clears dirty state', () => {
      useIDEStore.getState().openTab('/src/index.ts')
      const tabId = useIDEStore.getState().openTabs[0].id
      useIDEStore.getState().setDirty(tabId, true)
      useIDEStore.getState().setDirty(tabId, false)
      expect(useIDEStore.getState().openTabs[0].isDirty).toBe(false)
    })
  })

  // --- toggleSidebar / toggleTerminal ---

  describe('toggle sidebar and terminal', () => {
    it('toggles sidebarCollapsed', () => {
      useIDEStore.getState().toggleSidebar()
      expect(useIDEStore.getState().sidebarCollapsed).toBe(true)
      useIDEStore.getState().toggleSidebar()
      expect(useIDEStore.getState().sidebarCollapsed).toBe(false)
    })

    it('toggles terminalCollapsed', () => {
      useIDEStore.getState().toggleTerminal()
      expect(useIDEStore.getState().terminalCollapsed).toBe(true)
      useIDEStore.getState().toggleTerminal()
      expect(useIDEStore.getState().terminalCollapsed).toBe(false)
    })
  })

  // --- toggleDir ---

  describe('toggleDir', () => {
    it('expands a dir that is not expanded', () => {
      useIDEStore.getState().toggleDir('/src/components')
      expect(useIDEStore.getState().expandedDirs['/src/components']).toBe(true)
    })

    it('collapses a dir that is expanded', () => {
      useIDEStore.getState().toggleDir('/src/components')
      useIDEStore.getState().toggleDir('/src/components')
      expect(useIDEStore.getState().expandedDirs['/src/components']).toBe(false)
    })
  })

  // --- setFocusedPanel ---

  describe('setFocusedPanel', () => {
    it('sets focused panel to terminal', () => {
      useIDEStore.getState().setFocusedPanel('terminal')
      expect(useIDEStore.getState().focusedPanel).toBe('terminal')
    })

    it('sets focused panel back to editor', () => {
      useIDEStore.getState().setFocusedPanel('terminal')
      useIDEStore.getState().setFocusedPanel('editor')
      expect(useIDEStore.getState().focusedPanel).toBe('editor')
    })
  })

  // --- recentFolders (advanced) ---

  describe('recentFolders', () => {
    it('does not add same folder twice', () => {
      useIDEStore.getState().setRootPath('/folder/a')
      useIDEStore.getState().setRootPath('/folder/a')
      expect(useIDEStore.getState().recentFolders).toHaveLength(1)
    })

    it('moves existing folder to front when re-opened', () => {
      useIDEStore.getState().setRootPath('/folder/a')
      useIDEStore.getState().setRootPath('/folder/b')
      useIDEStore.getState().setRootPath('/folder/c')
      useIDEStore.getState().setRootPath('/folder/a')
      const { recentFolders } = useIDEStore.getState()
      expect(recentFolders[0]).toBe('/folder/a')
      expect(recentFolders).toHaveLength(3)
    })

    it('caps at 5 entries', () => {
      for (let i = 1; i <= 10; i++) {
        useIDEStore.getState().setRootPath(`/folder/${i}`)
      }
      expect(useIDEStore.getState().recentFolders).toHaveLength(5)
    })
  })
})
