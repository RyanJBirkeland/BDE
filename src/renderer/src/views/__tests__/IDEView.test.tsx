import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { IDEView } from '../IDEView'

type MockIDEState = {
  rootPath: string | null
  openTabs: Array<{ id: string; filePath: string; displayName: string; language: string; isDirty: boolean }>
  activeTabId: string | null
  sidebarCollapsed: boolean
  terminalCollapsed: boolean
  focusedPanel: 'editor' | 'terminal'
  setRootPath: ReturnType<typeof vi.fn>
  openTab: ReturnType<typeof vi.fn>
  closeTab: ReturnType<typeof vi.fn>
  setDirty: ReturnType<typeof vi.fn>
  setFocusedPanel: ReturnType<typeof vi.fn>
  toggleSidebar: ReturnType<typeof vi.fn>
  toggleTerminal: ReturnType<typeof vi.fn>
  recentFolders: string[]
}

const { mockUseIDEStore, mockSetFocusedPanel } = vi.hoisted(() => {
  const mockSetFocusedPanel = vi.fn()
  const defaultState: MockIDEState = {
    rootPath: null, openTabs: [], activeTabId: null,
    sidebarCollapsed: false, terminalCollapsed: false, focusedPanel: 'editor',
    setRootPath: vi.fn(), openTab: vi.fn(), closeTab: vi.fn(), setDirty: vi.fn(),
    setFocusedPanel: mockSetFocusedPanel, toggleSidebar: vi.fn(), toggleTerminal: vi.fn(), recentFolders: [],
  }
  const mockUseIDEStore = vi.fn((selector: (s: MockIDEState) => unknown) => selector(defaultState)) as ReturnType<typeof vi.fn> & { getState: () => MockIDEState }
  mockUseIDEStore.getState = () => defaultState
  return { mockUseIDEStore, mockSetFocusedPanel }
})

vi.mock('../../stores/ide', () => ({ useIDEStore: mockUseIDEStore }))
vi.mock('../../stores/ui', () => ({ useUIStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) => selector({ activeView: 'ide', setView: vi.fn() })) }))
vi.mock('../../stores/terminal', () => ({
  useTerminalStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) => selector({
    tabs: [], activeTabId: 'term-1', addTab: vi.fn(), closeTab: vi.fn(), setActiveTab: vi.fn(),
    renameTab: vi.fn(), reorderTab: vi.fn(), splitEnabled: false, toggleSplit: vi.fn(),
    showFind: false, setShowFind: vi.fn(), createAgentTab: vi.fn(), zoomIn: vi.fn(), zoomOut: vi.fn(), resetZoom: vi.fn(),
  })),
}))
vi.mock('@monaco-editor/react', () => ({
  default: ({ value }: { value?: string }) => <div data-testid="monaco-editor">{value}</div>,
  loader: { config: vi.fn() },
}))
vi.mock('../../stores/theme', () => ({ useThemeStore: vi.fn((selector: (s: { theme: string }) => unknown) => selector({ theme: 'dark' })) }))
vi.mock('../../lib/monaco-theme', () => ({
  getMonacoTheme: vi.fn(() => ({ base: 'vs-dark', inherit: true, rules: [], colors: {} })),
  getLightMonacoTheme: vi.fn(() => ({ base: 'vs', inherit: true, rules: [], colors: {} })),
}))
vi.mock('../../components/terminal/TerminalPane', () => ({
  TerminalPane: ({ tabId }: { tabId: string }) => <div data-testid={`terminal-pane-${tabId}`} />,
  clearTerminal: vi.fn(),
}))
vi.mock('../../components/terminal/FindBar', () => ({ FindBar: () => <div data-testid="find-bar" /> }))
vi.mock('../../components/terminal/AgentOutputTab', () => ({ AgentOutputTab: ({ agentId }: { agentId: string }) => <div data-testid={`agent-output-${agentId}`} /> }))
vi.mock('../../components/terminal/ShellPicker', () => ({ ShellPicker: () => null }))
vi.mock('../../components/terminal/AgentPicker', () => ({ AgentPicker: () => null }))
vi.mock('react-resizable-panels', () => ({
  Group: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Panel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Separator: () => <hr />,
}))

// Mock window.api without clobbering the DOM window object
Object.defineProperty(window, 'api', {
  value: {
    readDir: vi.fn().mockResolvedValue([]), readFile: vi.fn().mockResolvedValue(''),
    writeFile: vi.fn().mockResolvedValue(undefined), openDirectoryDialog: vi.fn().mockResolvedValue(null),
    watchDir: vi.fn().mockResolvedValue(undefined), onDirChanged: vi.fn().mockReturnValue(vi.fn()),
  },
  writable: true,
  configurable: true,
})

function setIDEState(overrides: Partial<MockIDEState>): void {
  const state: MockIDEState = {
    rootPath: null, openTabs: [], activeTabId: null, sidebarCollapsed: false,
    terminalCollapsed: false, focusedPanel: 'editor', setRootPath: vi.fn(),
    openTab: vi.fn(), closeTab: vi.fn(), setDirty: vi.fn(), setFocusedPanel: mockSetFocusedPanel,
    toggleSidebar: vi.fn(), toggleTerminal: vi.fn(), recentFolders: [], ...overrides,
  }
  mockUseIDEStore.mockImplementation((selector: (s: MockIDEState) => unknown) => selector(state))
  mockUseIDEStore.getState = () => state
}

beforeEach(() => { vi.clearAllMocks(); setIDEState({}) })

describe('IDEView', () => {
  it('shows empty state when no rootPath is set', () => {
    render(<IDEView />)
    expect(screen.getByText('BDE IDE')).toBeInTheDocument()
    expect(screen.getByText('Open a folder to start editing')).toBeInTheDocument()
  })
  it('shows open folder button in empty state', () => {
    render(<IDEView />)
    expect(screen.getAllByText('Open Folder').length).toBeGreaterThan(0)
  })
  it('renders the IDE layout when rootPath is set', () => {
    setIDEState({ rootPath: '/project' })
    render(<IDEView />)
    expect(screen.getByRole('tablist', { name: 'Editor tabs' })).toBeInTheDocument()
  })
  it('renders editor empty state when no file is open', () => {
    setIDEState({ rootPath: '/project', openTabs: [], activeTabId: null })
    render(<IDEView />)
    expect(screen.getByText('Open a file from the sidebar to start editing')).toBeInTheDocument()
  })
  it('shows EXPLORER sidebar header when rootPath is set', () => {
    setIDEState({ rootPath: '/project' })
    render(<IDEView />)
    expect(screen.getByText('EXPLORER')).toBeInTheDocument()
  })
})
