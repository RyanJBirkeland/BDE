import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TerminalView } from '../TerminalView'
import type { TerminalTab } from '../../stores/terminal'

// Use vi.hoisted so these refs are available inside vi.mock factories (which are hoisted)
const {
  mockAddTab,
  mockCloseTab,
  mockSetActiveTab,
  mockSetShowFind,
  mockToggleSplit,
  mockZoomIn,
  mockZoomOut,
  mockResetZoom,
  mockRenameTab,
  mockReorderTab,
  mockCreateAgentTab,
  mockUseTerminalStore,
} = vi.hoisted(() => {
  const mockAddTab = vi.fn()
  const mockCloseTab = vi.fn()
  const mockSetActiveTab = vi.fn()
  const mockSetShowFind = vi.fn()
  const mockToggleSplit = vi.fn()
  const mockZoomIn = vi.fn()
  const mockZoomOut = vi.fn()
  const mockResetZoom = vi.fn()
  const mockRenameTab = vi.fn()
  const mockReorderTab = vi.fn()
  const mockCreateAgentTab = vi.fn()

  const defaultState = {
    tabs: [] as unknown[],
    activeTabId: 'tab-1',
    showFind: false,
    splitEnabled: false,
    addTab: mockAddTab,
    closeTab: mockCloseTab,
    setActiveTab: mockSetActiveTab,
    setShowFind: mockSetShowFind,
    renameTab: mockRenameTab,
    reorderTab: mockReorderTab,
    toggleSplit: mockToggleSplit,
    createAgentTab: mockCreateAgentTab,
    zoomIn: mockZoomIn,
    zoomOut: mockZoomOut,
    resetZoom: mockResetZoom,
  }

  const mockUseTerminalStore = vi.fn((selector?: (s: Record<string, unknown>) => unknown) => {
    return selector ? selector(defaultState as unknown as Record<string, unknown>) : defaultState
  }) as ReturnType<typeof vi.fn> & { getState: () => typeof defaultState }
  mockUseTerminalStore.getState = () => defaultState

  return {
    mockAddTab,
    mockCloseTab,
    mockSetActiveTab,
    mockSetShowFind,
    mockToggleSplit,
    mockZoomIn,
    mockZoomOut,
    mockResetZoom,
    mockRenameTab,
    mockReorderTab,
    mockCreateAgentTab,
    mockUseTerminalStore,
  }
})

// ──────────────────────────────────────────────────────────────────────────────
// Module mocks
// ──────────────────────────────────────────────────────────────────────────────

vi.mock('../../stores/ui', () => ({
  useUIStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector({ activeView: 'terminal', setView: vi.fn() })
  ),
}))

vi.mock('../../stores/terminal', () => ({
  useTerminalStore: mockUseTerminalStore,
}))

vi.mock('../../components/terminal/TerminalPane', () => ({
  TerminalPane: ({ tabId }: { tabId: string }) => (
    <div data-testid={`terminal-pane-${tabId}`} />
  ),
  clearTerminal: vi.fn(),
}))

vi.mock('../../components/terminal/FindBar', () => ({
  FindBar: () => <div data-testid="find-bar" />,
}))

vi.mock('../../components/terminal/AgentOutputTab', () => ({
  AgentOutputTab: ({ agentId }: { agentId: string }) => (
    <div data-testid={`agent-output-${agentId}`} />
  ),
}))

vi.mock('../../components/terminal/ShellPicker', () => ({
  ShellPicker: () => null,
}))

vi.mock('../../components/terminal/AgentPicker', () => ({
  AgentPicker: () => null,
}))

vi.mock('react-resizable-panels', () => ({
  Group: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Panel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Separator: () => <div />,
}))

// ──────────────────────────────────────────────────────────────────────────────
// Test data
// ──────────────────────────────────────────────────────────────────────────────

const shellTab: TerminalTab = {
  id: 'tab-1',
  title: 'Terminal 1',
  kind: 'shell',
  shell: '/bin/zsh',
  ptyId: null,
  isLabelCustom: false,
  status: 'running',
  hasUnread: false,
}

const agentTab: TerminalTab = {
  id: 'agent-tab-1',
  title: 'Agent Tab',
  kind: 'agent',
  shell: '/bin/zsh',
  ptyId: null,
  isLabelCustom: false,
  status: 'running',
  hasUnread: false,
  agentId: 'agent-123',
} as TerminalTab

// ──────────────────────────────────────────────────────────────────────────────
// Helper to set the current mock state
// ──────────────────────────────────────────────────────────────────────────────

function setMockState(overrides: Partial<typeof defaultBaseState> = {}): void {
  const state = { ...defaultBaseState, ...overrides }
  mockUseTerminalStore.mockImplementation((selector?: (s: Record<string, unknown>) => unknown) => {
    return selector ? selector(state as unknown as Record<string, unknown>) : state
  })
  mockUseTerminalStore.getState = () => state as ReturnType<typeof mockUseTerminalStore.getState>
}

const defaultBaseState = {
  tabs: [shellTab],
  activeTabId: 'tab-1',
  showFind: false,
  splitEnabled: false,
  addTab: mockAddTab,
  closeTab: mockCloseTab,
  setActiveTab: mockSetActiveTab,
  setShowFind: mockSetShowFind,
  renameTab: mockRenameTab,
  reorderTab: mockReorderTab,
  toggleSplit: mockToggleSplit,
  createAgentTab: mockCreateAgentTab,
  zoomIn: mockZoomIn,
  zoomOut: mockZoomOut,
  resetZoom: mockResetZoom,
}

beforeEach(() => {
  vi.clearAllMocks()
  setMockState()
})

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

describe('TerminalView', () => {
  it('renders without crashing', () => {
    const { container } = render(<TerminalView />)
    expect(container.firstChild).toBeInTheDocument()
  })

  it('renders the terminal pane', () => {
    render(<TerminalView />)
    expect(screen.getByTestId('terminal-pane-tab-1')).toBeInTheDocument()
  })

  it('renders the Terminal title', () => {
    render(<TerminalView />)
    expect(screen.getByText('Terminal')).toBeInTheDocument()
  })

  it('renders the tab bar with the initial tab', () => {
    render(<TerminalView />)
    expect(screen.getByText('Terminal 1')).toBeInTheDocument()
  })

  describe('keyboard shortcuts', () => {
    it('Cmd+T calls addTab', () => {
      render(<TerminalView />)
      fireEvent.keyDown(document, { key: 't', metaKey: true })
      expect(mockAddTab).toHaveBeenCalledTimes(1)
    })

    it('Cmd+W calls closeTab with activeTabId', () => {
      render(<TerminalView />)
      fireEvent.keyDown(document, { key: 'w', metaKey: true })
      expect(mockCloseTab).toHaveBeenCalledWith('tab-1')
    })

    it('Cmd+F toggles showFind for shell tab', () => {
      render(<TerminalView />)
      fireEvent.keyDown(document, { key: 'f', metaKey: true })
      expect(mockSetShowFind).toHaveBeenCalledWith(true)
    })

    it('Cmd+F does NOT toggle showFind for agent tab', () => {
      setMockState({ tabs: [agentTab], activeTabId: 'agent-tab-1' })
      render(<TerminalView />)
      fireEvent.keyDown(document, { key: 'f', metaKey: true })
      expect(mockSetShowFind).not.toHaveBeenCalled()
    })

    it('Cmd+D calls toggleSplit', () => {
      render(<TerminalView />)
      fireEvent.keyDown(document, { key: 'd', metaKey: true })
      expect(mockToggleSplit).toHaveBeenCalledTimes(1)
    })

    it('Cmd+= calls zoomIn', () => {
      render(<TerminalView />)
      fireEvent.keyDown(document, { key: '=', metaKey: true })
      expect(mockZoomIn).toHaveBeenCalledTimes(1)
    })

    it('Cmd++ calls zoomIn', () => {
      render(<TerminalView />)
      fireEvent.keyDown(document, { key: '+', metaKey: true })
      expect(mockZoomIn).toHaveBeenCalledTimes(1)
    })

    it('Cmd+- calls zoomOut', () => {
      render(<TerminalView />)
      fireEvent.keyDown(document, { key: '-', metaKey: true })
      expect(mockZoomOut).toHaveBeenCalledTimes(1)
    })

    it('Cmd+0 calls resetZoom', () => {
      render(<TerminalView />)
      fireEvent.keyDown(document, { key: '0', metaKey: true })
      expect(mockResetZoom).toHaveBeenCalledTimes(1)
    })

    it('Cmd+Shift+[ navigates to previous tab', () => {
      const secondTab: TerminalTab = {
        id: 'tab-2',
        title: 'Terminal 2',
        kind: 'shell',
        shell: '/bin/zsh',
        ptyId: null,
        isLabelCustom: false,
        status: 'running',
        hasUnread: false,
      }
      setMockState({ tabs: [shellTab, secondTab], activeTabId: 'tab-2' })
      render(<TerminalView />)
      fireEvent.keyDown(document, { key: '[', metaKey: true, shiftKey: true })
      expect(mockSetActiveTab).toHaveBeenCalledWith('tab-1')
    })

    it('Cmd+Shift+] navigates to next tab', () => {
      const secondTab: TerminalTab = {
        id: 'tab-2',
        title: 'Terminal 2',
        kind: 'shell',
        shell: '/bin/zsh',
        ptyId: null,
        isLabelCustom: false,
        status: 'running',
        hasUnread: false,
      }
      setMockState({ tabs: [shellTab, secondTab], activeTabId: 'tab-1' })
      render(<TerminalView />)
      fireEvent.keyDown(document, { key: ']', metaKey: true, shiftKey: true })
      expect(mockSetActiveTab).toHaveBeenCalledWith('tab-2')
    })

    it('keyboard shortcuts are inactive when activeView is not terminal', async () => {
      const { useUIStore } = await import('../../stores/ui')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(useUIStore).mockImplementation((selector: any) =>
        selector({ activeView: 'agents', setView: vi.fn() })
      )
      render(<TerminalView />)
      fireEvent.keyDown(document, { key: 't', metaKey: true })
      expect(mockAddTab).not.toHaveBeenCalled()
    })
  })
})
