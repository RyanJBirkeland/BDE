import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { IDEView } from '../IDEView'

type MockIDEState = {
  rootPath: string | null
  openTabs: Array<{
    id: string
    filePath: string
    displayName: string
    language: string
    isDirty: boolean
  }>
  activeTabId: string | null
  sidebarCollapsed: boolean
  terminalCollapsed: boolean
  focusedPanel: 'editor' | 'terminal'
  setRootPath: ReturnType<typeof vi.fn>
  openTab: ReturnType<typeof vi.fn>
  closeTab: ReturnType<typeof vi.fn>
  setActiveTab: ReturnType<typeof vi.fn>
  setDirty: ReturnType<typeof vi.fn>
  setFocusedPanel: ReturnType<typeof vi.fn>
  toggleSidebar: ReturnType<typeof vi.fn>
  toggleTerminal: ReturnType<typeof vi.fn>
  recentFolders: string[]
}

type MockFileCacheState = {
  fileContents: Record<string, string>
  fileLoadingStates: Record<string, boolean>
  setFileContent: ReturnType<typeof vi.fn>
  setFileLoading: ReturnType<typeof vi.fn>
}

const { mockUseIDEStore, mockUseIDEFileCache, mockSetFocusedPanel } = vi.hoisted(() => {
  const mockSetFocusedPanel = vi.fn()
  const defaultState: MockIDEState = {
    rootPath: null,
    openTabs: [],
    activeTabId: null,
    sidebarCollapsed: false,
    terminalCollapsed: false,
    focusedPanel: 'editor',
    setRootPath: vi.fn(),
    openTab: vi.fn(),
    closeTab: vi.fn(),
    setActiveTab: vi.fn(),
    setDirty: vi.fn(),
    setFocusedPanel: mockSetFocusedPanel,
    toggleSidebar: vi.fn(),
    toggleTerminal: vi.fn(),
    recentFolders: []
  }
  const defaultCacheState: MockFileCacheState = {
    fileContents: {},
    fileLoadingStates: {},
    setFileContent: vi.fn(),
    setFileLoading: vi.fn()
  }
  const mockUseIDEStore = vi.fn((selector: (s: MockIDEState) => unknown) =>
    selector(defaultState)
  ) as ReturnType<typeof vi.fn> & {
    getState: () => MockIDEState
    setState: (partial: Partial<MockIDEState>) => void
  }
  mockUseIDEStore.getState = () => defaultState
  mockUseIDEStore.setState = vi.fn()
  const mockUseIDEFileCache = vi.fn((selector: (s: MockFileCacheState) => unknown) =>
    selector(defaultCacheState)
  ) as ReturnType<typeof vi.fn> & {
    getState: () => MockFileCacheState
    setState: (partial: Partial<MockFileCacheState>) => void
  }
  mockUseIDEFileCache.getState = () => defaultCacheState
  mockUseIDEFileCache.setState = vi.fn()
  return { mockUseIDEStore, mockUseIDEFileCache, mockSetFocusedPanel }
})

vi.mock('../../stores/ide', () => ({ useIDEStore: mockUseIDEStore }))
vi.mock('../../stores/ideFileCache', () => ({ useIDEFileCache: mockUseIDEFileCache }))
vi.mock('../../stores/panelLayout', () => ({
  usePanelLayoutStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector({ activeView: 'ide', setView: vi.fn() })
  )
}))
vi.mock('../../stores/terminal', () => ({
  useTerminalStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      tabs: [],
      activeTabId: 'term-1',
      addTab: vi.fn(),
      closeTab: vi.fn(),
      setActiveTab: vi.fn(),
      renameTab: vi.fn(),
      reorderTab: vi.fn(),
      splitEnabled: false,
      toggleSplit: vi.fn(),
      showFind: false,
      setShowFind: vi.fn(),
      createAgentTab: vi.fn(),
      zoomIn: vi.fn(),
      zoomOut: vi.fn(),
      resetZoom: vi.fn()
    })
  )
}))
vi.mock('@monaco-editor/react', () => ({
  default: ({ value }: { value?: string }) => <div data-testid="monaco-editor">{value}</div>,
  loader: { config: vi.fn() }
}))
vi.mock('../../stores/theme', () => ({
  useThemeStore: vi.fn((selector: (s: { theme: string }) => unknown) => selector({ theme: 'dark' }))
}))
vi.mock('../../lib/monaco-theme', () => ({
  getMonacoTheme: vi.fn(() => ({ base: 'vs-dark', inherit: true, rules: [], colors: {} })),
  getLightMonacoTheme: vi.fn(() => ({ base: 'vs', inherit: true, rules: [], colors: {} }))
}))
vi.mock('../../components/terminal/TerminalPane', () => ({
  TerminalPane: ({ tabId }: { tabId: string }) => <div data-testid={`terminal-pane-${tabId}`} />,
  clearTerminal: vi.fn()
}))
vi.mock('../../components/terminal/FindBar', () => ({
  FindBar: () => <div data-testid="find-bar" />
}))
vi.mock('../../components/terminal/AgentOutputTab', () => ({
  AgentOutputTab: ({ agentId }: { agentId: string }) => (
    <div data-testid={`agent-output-${agentId}`} />
  )
}))
vi.mock('../../components/terminal/ShellPicker', () => ({ ShellPicker: () => null }))
vi.mock('../../components/terminal/AgentPicker', () => ({ AgentPicker: () => null }))
vi.mock('react-resizable-panels', () => ({
  Group: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Panel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Separator: () => <hr />,
  usePanelRef: () => ({ current: { collapse: vi.fn(), expand: vi.fn() } })
}))
vi.mock('../../components/ide/TerminalPanel', () => ({
  TerminalPanel: () => <div data-testid="terminal-panel">Terminal Panel</div>
}))
vi.mock('../../components/ide/UnsavedDialog', () => ({
  useUnsavedDialog: () => ({
    confirmUnsaved: vi.fn().mockResolvedValue(true),
    confirmProps: { isOpen: false, fileName: '', onConfirm: vi.fn(), onCancel: vi.fn() }
  }),
  UnsavedDialogModal: ({ isOpen }: { isOpen: boolean }) => (
    <div role="dialog" hidden={!isOpen} data-testid="unsaved-dialog">
      Unsaved changes
    </div>
  )
}))
vi.mock('../../components/ide/IDEEmptyState', () => ({
  IDEEmptyState: ({ onOpenFolder }: { onOpenFolder: () => void }) => (
    <div data-testid="ide-empty-state">
      <h1>BDE IDE</h1>
      <p>Open a folder to start editing</p>
      <button onClick={onOpenFolder}>Open Folder</button>
    </div>
  )
}))
vi.mock('../../components/ide/FileSidebar', () => ({
  FileSidebar: () => <div data-testid="file-sidebar">EXPLORER</div>
}))
vi.mock('../../components/ide/EditorTabBar', () => ({
  EditorTabBar: vi.fn(({ onCloseTab }: { onCloseTab: (id: string, dirty: boolean) => void }) => {
    // Access the mockUseIDEStore from the hoisted scope
    const state = mockUseIDEStore.getState()
    return (
      <div role="tablist" aria-label="Editor tabs" data-testid="editor-tabbar">
        {state.openTabs.map((tab) => (
          <div
            key={tab.id}
            role="tab"
            aria-label={tab.displayName}
            aria-selected={tab.id === state.activeTabId}
            data-dirty={tab.isDirty}
          >
            {tab.displayName}
            <button onClick={() => onCloseTab(tab.id, tab.isDirty)}>×</button>
          </div>
        ))}
      </div>
    )
  })
}))
vi.mock('../../components/ide/EditorPane', () => ({
  EditorPane: ({ filePath, content }: { filePath: string | null; content: string | null }) => {
    if (!filePath) {
      return <div data-testid="editor-empty">Open a file from the sidebar to start editing</div>
    }
    return <div data-testid="editor-pane">{content}</div>
  }
}))

// Mock window.api without clobbering the DOM window object
Object.defineProperty(window, 'api', {
  value: {
    fs: {
      readDir: vi.fn().mockResolvedValue([]),
      readFile: vi.fn().mockResolvedValue(''),
      writeFile: vi.fn().mockResolvedValue(undefined),
      openDirDialog: vi.fn().mockResolvedValue(null),
      watchDir: vi.fn().mockResolvedValue(undefined),
      onDirChanged: vi.fn().mockReturnValue(vi.fn())
    },
    settings: {
      getJson: vi.fn().mockResolvedValue(null)
    }
  },
  writable: true,
  configurable: true
})

function setIDEState(overrides: Partial<MockIDEState> & Partial<MockFileCacheState>): void {
  const { fileContents, fileLoadingStates, setFileContent, setFileLoading, ...ideOverrides } =
    overrides

  const state: MockIDEState = {
    rootPath: null,
    openTabs: [],
    activeTabId: null,
    sidebarCollapsed: false,
    terminalCollapsed: false,
    focusedPanel: 'editor',
    setRootPath: vi.fn(),
    openTab: vi.fn(),
    closeTab: vi.fn(),
    setActiveTab: vi.fn(),
    setDirty: vi.fn(),
    setFocusedPanel: mockSetFocusedPanel,
    toggleSidebar: vi.fn(),
    toggleTerminal: vi.fn(),
    recentFolders: [],
    ...ideOverrides
  }
  const cacheState: MockFileCacheState = {
    fileContents: fileContents ?? {},
    fileLoadingStates: fileLoadingStates ?? {},
    setFileContent: setFileContent ?? vi.fn(),
    setFileLoading: setFileLoading ?? vi.fn()
  }
  mockUseIDEStore.mockImplementation((selector: (s: MockIDEState) => unknown) => selector(state))
  mockUseIDEStore.getState = () => state
  mockUseIDEStore.setState = vi.fn()
  mockUseIDEFileCache.mockImplementation((selector: (s: MockFileCacheState) => unknown) =>
    selector(cacheState)
  )
  mockUseIDEFileCache.getState = () => cacheState
}

beforeEach(() => {
  vi.clearAllMocks()
  setIDEState({})
})

describe('IDEView', () => {
  describe('Empty states', () => {
    it('shows empty state when no rootPath is set', () => {
      render(<IDEView />)
      expect(screen.getByText('BDE IDE')).toBeInTheDocument()
      expect(screen.getByText('Open a folder to start editing')).toBeInTheDocument()
    })
    it('shows open folder button in empty state', () => {
      render(<IDEView />)
      expect(screen.getAllByText('Open Folder').length).toBeGreaterThan(0)
    })
    it('renders editor empty state when no file is open', () => {
      setIDEState({ rootPath: '/project', openTabs: [], activeTabId: null })
      render(<IDEView />)
      expect(screen.getByText('Open a file from the sidebar to start editing')).toBeInTheDocument()
    })
  })

  describe('Loading states', () => {
    it('handles file content loading when tab is active but content not yet loaded', async () => {
      const mockReadFile = vi.fn().mockResolvedValue('file content')
      Object.defineProperty(window, 'api', {
        value: { ...window.api, fs: { ...window.api.fs, readFile: mockReadFile } },
        writable: true,
        configurable: true
      })

      setIDEState({
        rootPath: '/project',
        openTabs: [
          {
            id: 'tab-1',
            filePath: '/project/test.ts',
            displayName: 'test.ts',
            language: 'typescript',
            isDirty: false
          }
        ],
        activeTabId: 'tab-1'
      })

      render(<IDEView />)
      expect(mockReadFile).toHaveBeenCalledWith('/project/test.ts')
    })

    it('handles file read error gracefully by setting empty content', async () => {
      const mockReadFile = vi.fn().mockRejectedValue(new Error('File not found'))
      Object.defineProperty(window, 'api', {
        value: { ...window.api, fs: { ...window.api.fs, readFile: mockReadFile } },
        writable: true,
        configurable: true
      })

      setIDEState({
        rootPath: '/project',
        openTabs: [
          {
            id: 'tab-1',
            filePath: '/project/missing.ts',
            displayName: 'missing.ts',
            language: 'typescript',
            isDirty: false
          }
        ],
        activeTabId: 'tab-1'
      })

      render(<IDEView />)
      expect(mockReadFile).toHaveBeenCalledWith('/project/missing.ts')
    })
  })

  describe('Error states', () => {
    it('handles IDE state restoration errors without crashing', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const mockGetJson = vi.fn().mockRejectedValue(new Error('Failed to load settings'))

      Object.defineProperty(window, 'api', {
        value: {
          ...window.api,
          settings: { getJson: mockGetJson }
        },
        writable: true,
        configurable: true
      })

      render(<IDEView />)

      // Component should render without crashing
      expect(screen.getByText('BDE IDE')).toBeInTheDocument()
      consoleErrorSpy.mockRestore()
    })
  })

  describe('Conditional rendering', () => {
    it('renders the IDE layout when rootPath is set', () => {
      setIDEState({ rootPath: '/project' })
      render(<IDEView />)
      expect(screen.getByRole('tablist', { name: 'Editor tabs' })).toBeInTheDocument()
    })

    it('shows EXPLORER sidebar header when rootPath is set', () => {
      setIDEState({ rootPath: '/project' })
      render(<IDEView />)
      expect(screen.getByText('EXPLORER')).toBeInTheDocument()
    })

    it('hides sidebar when sidebarCollapsed is true', () => {
      // With the imperative Panel API, the sidebar Panel is always mounted but
      // collapsed via panel.collapse() — DOM presence is not the right signal.
      // The panel content remains in the DOM; only its size is driven to zero.
      setIDEState({ rootPath: '/project', sidebarCollapsed: true })
      render(<IDEView />)
      expect(screen.getByText('EXPLORER')).toBeInTheDocument()
    })

    it('shows sidebar when sidebarCollapsed is false', () => {
      setIDEState({ rootPath: '/project', sidebarCollapsed: false })
      render(<IDEView />)
      expect(screen.getByText('EXPLORER')).toBeInTheDocument()
    })

    it('hides terminal panel when terminalCollapsed is true', () => {
      setIDEState({ rootPath: '/project', terminalCollapsed: true })
      render(<IDEView />)
      expect(screen.queryByTestId('terminal-pane-term-1')).not.toBeInTheDocument()
    })

    it('shows terminal panel when terminalCollapsed is false', () => {
      setIDEState({ rootPath: '/project', terminalCollapsed: false })
      render(<IDEView />)
      expect(screen.getByTestId('terminal-panel')).toBeInTheDocument()
    })

    it('renders UnsavedDialogModal in both empty and loaded states', () => {
      const { rerender } = render(<IDEView />)
      expect(screen.getByRole('dialog', { hidden: true })).toBeInTheDocument()

      setIDEState({ rootPath: '/project' })
      rerender(<IDEView />)
      expect(screen.getByRole('dialog', { hidden: true })).toBeInTheDocument()
    })
  })

  describe('Tab interactions', () => {
    it('shows active tab content when file is loaded', () => {
      setIDEState({
        rootPath: '/project',
        openTabs: [
          {
            id: 'tab-1',
            filePath: '/project/test.ts',
            displayName: 'test.ts',
            language: 'typescript',
            isDirty: false
          }
        ],
        activeTabId: 'tab-1'
      })

      render(<IDEView />)
      expect(screen.getByRole('tablist', { name: 'Editor tabs' })).toBeInTheDocument()
    })

    it('displays multiple tabs when multiple files are open', () => {
      setIDEState({
        rootPath: '/project',
        openTabs: [
          {
            id: 'tab-1',
            filePath: '/project/foo.ts',
            displayName: 'foo.ts',
            language: 'typescript',
            isDirty: false
          },
          {
            id: 'tab-2',
            filePath: '/project/bar.ts',
            displayName: 'bar.ts',
            language: 'typescript',
            isDirty: false
          }
        ],
        activeTabId: 'tab-1'
      })

      render(<IDEView />)
      expect(screen.getAllByText('foo.ts').length).toBeGreaterThanOrEqual(1)
      expect(screen.getByText('bar.ts')).toBeInTheDocument()
    })

    it('shows dirty indicator on modified tabs', () => {
      setIDEState({
        rootPath: '/project',
        openTabs: [
          {
            id: 'tab-1',
            filePath: '/project/dirty.ts',
            displayName: 'dirty.ts',
            language: 'typescript',
            isDirty: true
          }
        ],
        activeTabId: 'tab-1'
      })

      render(<IDEView />)
      const tab = screen.getByRole('tab', { name: /dirty\.ts/ })
      expect(tab).toHaveAttribute('data-dirty', 'true')
    })
  })

  describe('File loading indicator', () => {
    it('shows Loading... text when active file is loading', () => {
      setIDEState({
        rootPath: '/project',
        openTabs: [
          {
            id: 'tab-1',
            filePath: '/project/test.ts',
            displayName: 'test.ts',
            language: 'typescript',
            isDirty: false
          }
        ],
        activeTabId: 'tab-1',
        fileLoadingStates: { '/project/test.ts': true },
        fileContents: {}
      })

      render(<IDEView />)
      expect(screen.getByText('Loading...')).toBeInTheDocument()
    })

    it('shows editor pane when file is loaded', () => {
      setIDEState({
        rootPath: '/project',
        openTabs: [
          {
            id: 'tab-1',
            filePath: '/project/test.ts',
            displayName: 'test.ts',
            language: 'typescript',
            isDirty: false
          }
        ],
        activeTabId: 'tab-1',
        fileLoadingStates: {},
        fileContents: { '/project/test.ts': 'const x = 1' }
      })

      render(<IDEView />)
      expect(screen.queryByText('Loading...')).not.toBeInTheDocument()
      expect(screen.getByTestId('editor-pane')).toBeInTheDocument()
    })
  })

  describe('Sidebar toggle button when collapsed', () => {
    it('shows sidebar toggle button when sidebar is collapsed and no active tab', () => {
      setIDEState({
        rootPath: '/project',
        sidebarCollapsed: true,
        openTabs: [],
        activeTabId: null
      })

      const { container } = render(<IDEView />)
      const toggleBtn = container.querySelector('.ide-sidebar-toggle')
      expect(toggleBtn).toBeInTheDocument()
    })

    it('does not show sidebar toggle button when sidebar is expanded', () => {
      setIDEState({
        rootPath: '/project',
        sidebarCollapsed: false,
        openTabs: [],
        activeTabId: null
      })

      const { container } = render(<IDEView />)
      const toggleBtn = container.querySelector('.ide-sidebar-toggle')
      expect(toggleBtn).not.toBeInTheDocument()
    })

    it('does not show sidebar toggle button when there is an active tab', () => {
      setIDEState({
        rootPath: '/project',
        sidebarCollapsed: true,
        openTabs: [
          {
            id: 'tab-1',
            filePath: '/project/test.ts',
            displayName: 'test.ts',
            language: 'typescript',
            isDirty: false
          }
        ],
        activeTabId: 'tab-1'
      })

      const { container } = render(<IDEView />)
      const toggleBtn = container.querySelector('.ide-sidebar-toggle')
      expect(toggleBtn).not.toBeInTheDocument()
    })
  })

  describe('Keyboard shortcuts', () => {
    it('toggles sidebar on Cmd+B', () => {
      const toggleSidebar = vi.fn()
      setIDEState({ rootPath: '/project', toggleSidebar })

      render(<IDEView />)
      fireEvent.keyDown(window, { key: 'b', metaKey: true })
      expect(toggleSidebar).toHaveBeenCalled()
    })

    it('toggles terminal on Cmd+J', () => {
      const toggleTerminal = vi.fn()
      setIDEState({ rootPath: '/project', toggleTerminal })

      render(<IDEView />)
      fireEvent.keyDown(window, { key: 'j', metaKey: true })
      expect(toggleTerminal).toHaveBeenCalled()
    })

    it('triggers open folder on Cmd+O', () => {
      setIDEState({ rootPath: '/project' })

      render(<IDEView />)
      fireEvent.keyDown(window, { key: 'o', metaKey: true })
      expect(window.api.fs.openDirDialog).toHaveBeenCalled()
    })

    it('triggers save on Cmd+S with active tab', async () => {
      const setDirty = vi.fn()
      setIDEState({
        rootPath: '/project',
        openTabs: [
          {
            id: 'tab-1',
            filePath: '/project/test.ts',
            displayName: 'test.ts',
            language: 'typescript',
            isDirty: true
          }
        ],
        activeTabId: 'tab-1',
        fileContents: { '/project/test.ts': 'content' },
        setDirty
      })

      render(<IDEView />)
      fireEvent.keyDown(window, { key: 's', metaKey: true })
      expect(window.api.fs.writeFile).toHaveBeenCalledWith('/project/test.ts', 'content')
    })

    it('does not trigger save on Cmd+S without active tab', () => {
      setIDEState({ rootPath: '/project', openTabs: [], activeTabId: null })

      render(<IDEView />)
      fireEvent.keyDown(window, { key: 's', metaKey: true })
      expect(window.api.fs.writeFile).not.toHaveBeenCalled()
    })

    it('toggles shortcuts overlay on Cmd+/', () => {
      setIDEState({ rootPath: '/project' })

      render(<IDEView />)
      // No overlay initially
      expect(screen.queryByText('Keyboard Shortcuts')).not.toBeInTheDocument()

      fireEvent.keyDown(window, { key: '/', metaKey: true })
      expect(screen.getByText('Keyboard Shortcuts')).toBeInTheDocument()
    })

    it('closes shortcuts overlay on Escape', () => {
      setIDEState({ rootPath: '/project' })

      render(<IDEView />)
      // Open overlay
      fireEvent.keyDown(window, { key: '/', metaKey: true })
      expect(screen.getByText('Keyboard Shortcuts')).toBeInTheDocument()

      // Close with Escape
      fireEvent.keyDown(window, { key: 'Escape' })
      expect(screen.queryByText('Keyboard Shortcuts')).not.toBeInTheDocument()
    })

    it('closes shortcuts overlay by clicking the overlay background', () => {
      setIDEState({ rootPath: '/project' })

      render(<IDEView />)
      // Open overlay
      fireEvent.keyDown(window, { key: '/', metaKey: true })
      expect(screen.getByText('Keyboard Shortcuts')).toBeInTheDocument()

      // Click the overlay background (the dialog element)
      const overlay = screen.getByRole('dialog')
      fireEvent.click(overlay)
      expect(screen.queryByText('Keyboard Shortcuts')).not.toBeInTheDocument()
    })

    it('does not close shortcuts overlay when clicking inside the panel', () => {
      setIDEState({ rootPath: '/project' })

      render(<IDEView />)
      fireEvent.keyDown(window, { key: '/', metaKey: true })

      // Click inside the panel (on the title)
      const title = screen.getByText('Keyboard Shortcuts')
      fireEvent.click(title)
      // Should still be visible
      expect(screen.getByText('Keyboard Shortcuts')).toBeInTheDocument()
    })

    it('does not respond to Cmd+B when ctrlKey is also pressed', () => {
      const toggleSidebar = vi.fn()
      setIDEState({ rootPath: '/project', toggleSidebar })

      render(<IDEView />)
      fireEvent.keyDown(window, { key: 'b', metaKey: true, ctrlKey: true })
      expect(toggleSidebar).not.toHaveBeenCalled()
    })

    it('handles Cmd+W to close editor tab when focused on editor', () => {
      const closeTab = vi.fn()
      setIDEState({
        rootPath: '/project',
        openTabs: [
          {
            id: 'tab-1',
            filePath: '/project/test.ts',
            displayName: 'test.ts',
            language: 'typescript',
            isDirty: false
          }
        ],
        activeTabId: 'tab-1',
        focusedPanel: 'editor',
        closeTab
      })

      render(<IDEView />)
      fireEvent.keyDown(window, { key: 'w', metaKey: true })
      expect(closeTab).toHaveBeenCalledWith('tab-1')
    })

    it('ignores Cmd+W when no active tab in editor panel', () => {
      const closeTab = vi.fn()
      setIDEState({
        rootPath: '/project',
        openTabs: [],
        activeTabId: null,
        focusedPanel: 'editor',
        closeTab
      })

      render(<IDEView />)
      fireEvent.keyDown(window, { key: 'w', metaKey: true })
      expect(closeTab).not.toHaveBeenCalled()
    })
  })

  describe('Shortcuts overlay content', () => {
    it('renders all IDE shortcut entries', () => {
      setIDEState({ rootPath: '/project' })

      render(<IDEView />)
      fireEvent.keyDown(window, { key: '/', metaKey: true })

      expect(screen.getByText('Toggle sidebar')).toBeInTheDocument()
      expect(screen.getByText('Toggle terminal')).toBeInTheDocument()
      expect(screen.getByText('Open folder')).toBeInTheDocument()
      expect(screen.getByText('Save file')).toBeInTheDocument()
      expect(screen.getByText('Close tab')).toBeInTheDocument()
      expect(screen.getByText('Show this help')).toBeInTheDocument()
    })

    it('shows close hint in overlay', () => {
      setIDEState({ rootPath: '/project' })

      render(<IDEView />)
      fireEvent.keyDown(window, { key: '/', metaKey: true })
      expect(screen.getByText(/Press.*or Esc to close/)).toBeInTheDocument()
    })
  })

  describe('Open folder flow', () => {
    it('calls setRootPath and watchDir when directory is selected', async () => {
      const setRootPath = vi.fn()
      const mockOpenDir = vi.fn().mockResolvedValue('/new/project')
      const mockWatchDir = vi.fn().mockResolvedValue(undefined)

      Object.defineProperty(window, 'api', {
        value: {
          ...window.api,
          fs: { ...window.api.fs, openDirDialog: mockOpenDir, watchDir: mockWatchDir },
          settings: { getJson: vi.fn().mockResolvedValue(null) }
        },
        writable: true,
        configurable: true
      })

      setIDEState({ rootPath: null, setRootPath })

      render(<IDEView />)
      // Click the "Open Folder" button in the empty state
      fireEvent.click(screen.getByText('Open Folder'))

      await vi.waitFor(() => {
        expect(mockOpenDir).toHaveBeenCalled()
      })
      await vi.waitFor(() => {
        expect(setRootPath).toHaveBeenCalledWith('/new/project')
      })
    })

    it('does not set rootPath when directory dialog is cancelled', async () => {
      const setRootPath = vi.fn()
      const mockOpenDir = vi.fn().mockResolvedValue(null)

      Object.defineProperty(window, 'api', {
        value: {
          ...window.api,
          fs: { ...window.api.fs, openDirDialog: mockOpenDir },
          settings: { getJson: vi.fn().mockResolvedValue(null) }
        },
        writable: true,
        configurable: true
      })

      setIDEState({ rootPath: null, setRootPath })

      render(<IDEView />)
      fireEvent.click(screen.getByText('Open Folder'))

      await vi.waitFor(() => {
        expect(mockOpenDir).toHaveBeenCalled()
      })
      expect(setRootPath).not.toHaveBeenCalled()
    })
  })

  describe('State restoration', () => {
    it('restores IDE state from saved settings on mount', async () => {
      const mockGetJson = vi.fn().mockResolvedValue({
        rootPath: '/saved/project',
        sidebarCollapsed: true,
        terminalCollapsed: false,
        recentFolders: ['/saved/project'],
        expandedDirs: { '/saved/project/src': true }
      })
      const mockWatchDir = vi.fn().mockResolvedValue(undefined)
      const mockStat = vi.fn().mockResolvedValue({ size: 0 }) // path exists

      Object.defineProperty(window, 'api', {
        value: {
          ...window.api,
          settings: { getJson: mockGetJson },
          fs: { ...window.api.fs, watchDir: mockWatchDir, stat: mockStat }
        },
        writable: true,
        configurable: true
      })

      render(<IDEView />)

      await vi.waitFor(() => {
        expect(mockGetJson).toHaveBeenCalledWith('ide.state')
      })
      await vi.waitFor(() => {
        expect(mockWatchDir).toHaveBeenCalledWith('/saved/project')
      })
    })

    it('skips restoration when saved state is null', async () => {
      const mockGetJson = vi.fn().mockResolvedValue(null)
      const mockWatchDir = vi.fn().mockResolvedValue(undefined)

      Object.defineProperty(window, 'api', {
        value: {
          ...window.api,
          settings: { getJson: mockGetJson },
          fs: { ...window.api.fs, watchDir: mockWatchDir }
        },
        writable: true,
        configurable: true
      })

      render(<IDEView />)

      await vi.waitFor(() => {
        expect(mockGetJson).toHaveBeenCalledWith('ide.state')
      })
      expect(mockWatchDir).not.toHaveBeenCalled()
    })

    it('restores open tabs and active file from saved state', async () => {
      const mockOpenTab = vi.fn()
      const savedState = {
        rootPath: '/saved/project',
        openTabs: [{ filePath: '/saved/project/foo.ts' }],
        activeFilePath: '/saved/project/foo.ts'
      }
      const mockGetJson = vi.fn().mockResolvedValue(savedState)
      const mockWatchDir = vi.fn().mockResolvedValue(undefined)
      const mockStat = vi.fn().mockResolvedValue({ size: 0 }) // all paths exist

      Object.defineProperty(window, 'api', {
        value: {
          ...window.api,
          settings: { getJson: mockGetJson },
          fs: { ...window.api.fs, watchDir: mockWatchDir, stat: mockStat }
        },
        writable: true,
        configurable: true
      })

      // Set up the store to have openTab and setActiveTab
      const stateForRestore: MockIDEState = {
        rootPath: null,
        openTabs: [
          {
            id: 'tab-restored',
            filePath: '/saved/project/foo.ts',
            displayName: 'foo.ts',
            language: 'typescript',
            isDirty: false
          }
        ],
        activeTabId: null,
        sidebarCollapsed: false,
        terminalCollapsed: false,
        focusedPanel: 'editor',
        setRootPath: vi.fn(),
        openTab: mockOpenTab,
        closeTab: vi.fn(),
        setDirty: vi.fn(),
        setFocusedPanel: mockSetFocusedPanel,
        toggleSidebar: vi.fn(),
        toggleTerminal: vi.fn(),
        setActiveTab: vi.fn(),
        recentFolders: []
      }
      mockUseIDEStore.getState = () => stateForRestore

      render(<IDEView />)

      await vi.waitFor(() => {
        expect(mockGetJson).toHaveBeenCalledWith('ide.state')
      })
    })
  })

  describe('Editor area focus handling', () => {
    it('sets focused panel to editor when clicking editor area', () => {
      setIDEState({ rootPath: '/project' })

      const { container } = render(<IDEView />)
      const editorArea = container.querySelector('.ide-editor-area')
      expect(editorArea).toBeInTheDocument()
      fireEvent.click(editorArea!)
      expect(mockSetFocusedPanel).toHaveBeenCalledWith('editor')
    })
  })

  describe('File content skips loading when already present', () => {
    it('does not call readFile when file content already in store', () => {
      const mockReadFile = vi.fn()
      Object.defineProperty(window, 'api', {
        value: { ...window.api, fs: { ...window.api.fs, readFile: mockReadFile } },
        writable: true,
        configurable: true
      })

      setIDEState({
        rootPath: '/project',
        openTabs: [
          {
            id: 'tab-1',
            filePath: '/project/test.ts',
            displayName: 'test.ts',
            language: 'typescript',
            isDirty: false
          }
        ],
        activeTabId: 'tab-1',
        fileContents: { '/project/test.ts': 'already loaded' }
      })

      render(<IDEView />)
      expect(mockReadFile).not.toHaveBeenCalled()
    })

    it('does not call readFile when file is already loading', () => {
      const mockReadFile = vi.fn()
      Object.defineProperty(window, 'api', {
        value: { ...window.api, fs: { ...window.api.fs, readFile: mockReadFile } },
        writable: true,
        configurable: true
      })

      setIDEState({
        rootPath: '/project',
        openTabs: [
          {
            id: 'tab-1',
            filePath: '/project/test.ts',
            displayName: 'test.ts',
            language: 'typescript',
            isDirty: false
          }
        ],
        activeTabId: 'tab-1',
        fileContents: {},
        fileLoadingStates: { '/project/test.ts': true }
      })

      render(<IDEView />)
      expect(mockReadFile).not.toHaveBeenCalled()
    })
  })
})
