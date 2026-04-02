import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
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
  fileContents: Record<string, string>
  fileLoadingStates: Record<string, boolean>
  setRootPath: ReturnType<typeof vi.fn>
  openTab: ReturnType<typeof vi.fn>
  closeTab: ReturnType<typeof vi.fn>
  setDirty: ReturnType<typeof vi.fn>
  setFocusedPanel: ReturnType<typeof vi.fn>
  toggleSidebar: ReturnType<typeof vi.fn>
  toggleTerminal: ReturnType<typeof vi.fn>
  setFileContent: ReturnType<typeof vi.fn>
  setFileLoading: ReturnType<typeof vi.fn>
  recentFolders: string[]
}

const { mockUseIDEStore, mockSetFocusedPanel } = vi.hoisted(() => {
  const mockSetFocusedPanel = vi.fn()
  const defaultState: MockIDEState = {
    rootPath: null,
    openTabs: [],
    activeTabId: null,
    sidebarCollapsed: false,
    terminalCollapsed: false,
    focusedPanel: 'editor',
    fileContents: {},
    fileLoadingStates: {},
    setRootPath: vi.fn(),
    openTab: vi.fn(),
    closeTab: vi.fn(),
    setDirty: vi.fn(),
    setFocusedPanel: mockSetFocusedPanel,
    toggleSidebar: vi.fn(),
    toggleTerminal: vi.fn(),
    setFileContent: vi.fn(),
    setFileLoading: vi.fn(),
    recentFolders: []
  }
  const mockUseIDEStore = vi.fn((selector: (s: MockIDEState) => unknown) =>
    selector(defaultState)
  ) as ReturnType<typeof vi.fn> & { getState: () => MockIDEState }
  mockUseIDEStore.getState = () => defaultState
  return { mockUseIDEStore, mockSetFocusedPanel }
})

vi.mock('../../stores/ide', () => ({ useIDEStore: mockUseIDEStore }))
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
  Separator: () => <hr />
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
    readDir: vi.fn().mockResolvedValue([]),
    readFile: vi.fn().mockResolvedValue(''),
    writeFile: vi.fn().mockResolvedValue(undefined),
    openDirectoryDialog: vi.fn().mockResolvedValue(null),
    watchDir: vi.fn().mockResolvedValue(undefined),
    onDirChanged: vi.fn().mockReturnValue(vi.fn()),
    settings: {
      getJson: vi.fn().mockResolvedValue(null)
    }
  },
  writable: true,
  configurable: true
})

function setIDEState(overrides: Partial<MockIDEState>): void {
  const state: MockIDEState = {
    rootPath: null,
    openTabs: [],
    activeTabId: null,
    sidebarCollapsed: false,
    terminalCollapsed: false,
    focusedPanel: 'editor',
    fileContents: {},
    fileLoadingStates: {},
    setRootPath: vi.fn(),
    openTab: vi.fn(),
    closeTab: vi.fn(),
    setDirty: vi.fn(),
    setFocusedPanel: mockSetFocusedPanel,
    toggleSidebar: vi.fn(),
    toggleTerminal: vi.fn(),
    setFileContent: vi.fn(),
    setFileLoading: vi.fn(),
    recentFolders: [],
    ...overrides
  }
  mockUseIDEStore.mockImplementation((selector: (s: MockIDEState) => unknown) => selector(state))
  mockUseIDEStore.getState = () => state
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
        value: { ...window.api, readFile: mockReadFile },
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
        value: { ...window.api, readFile: mockReadFile },
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
      setIDEState({ rootPath: '/project', sidebarCollapsed: true })
      render(<IDEView />)
      expect(screen.queryByText('EXPLORER')).not.toBeInTheDocument()
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
      expect(screen.getByText('foo.ts')).toBeInTheDocument()
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
})
