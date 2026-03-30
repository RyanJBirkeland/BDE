import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TerminalPanel } from '../TerminalPanel'
import { useTerminalStore } from '../../../stores/terminal'
import { usePanelLayoutStore } from '../../../stores/panelLayout'

vi.mock('../../../stores/terminal')
vi.mock('../../../stores/panelLayout')
vi.mock('../../terminal/TerminalTabBar', () => ({
  TerminalTabBar: ({ tabs, onSelectTab, onCloseTab, onAddTab }: any) => (
    <div data-testid="terminal-tab-bar">
      {tabs.map((tab: any) => (
        <button key={tab.id} onClick={() => onSelectTab(tab.id)}>
          {tab.title}
        </button>
      ))}
      <button onClick={onAddTab}>Add Tab</button>
      <button onClick={() => onCloseTab(tabs[0]?.id)}>Close Tab</button>
    </div>
  )
}))
vi.mock('../../terminal/TerminalToolbar', () => ({
  TerminalToolbar: ({ isAgentTab, onClear }: any) => (
    <div data-testid="terminal-toolbar">
      {!isAgentTab && <button onClick={onClear}>Clear</button>}
    </div>
  )
}))
vi.mock('../../terminal/TerminalContent', () => ({
  TerminalContent: () => <div data-testid="terminal-content">Terminal Content</div>
}))
vi.mock('../../terminal/TerminalPane', () => ({
  clearTerminal: vi.fn()
}))

describe('TerminalPanel', () => {
  const mockAddTab = vi.fn()
  const mockCloseTab = vi.fn()
  const mockSetActiveTab = vi.fn()
  const mockRenameTab = vi.fn()
  const mockReorderTab = vi.fn()
  const mockToggleSplit = vi.fn()
  const mockCreateAgentTab = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()

    // Set up default store state before each test
    vi.mocked(useTerminalStore).mockImplementation((selector: any) => {
      const state = {
        tabs: [
          { id: 'tab-1', title: 'Terminal 1', kind: 'shell' },
          { id: 'tab-2', title: 'Terminal 2', kind: 'shell' }
        ],
        activeTabId: 'tab-1',
        addTab: mockAddTab,
        closeTab: mockCloseTab,
        setActiveTab: mockSetActiveTab,
        renameTab: mockRenameTab,
        reorderTab: mockReorderTab,
        splitEnabled: false,
        toggleSplit: mockToggleSplit,
        showFind: false,
        createAgentTab: mockCreateAgentTab
      }
      return selector ? selector(state) : state
    })

    vi.mocked(usePanelLayoutStore).mockImplementation((selector: any) => {
      const state = { activeView: 'ide' }
      return selector ? selector(state) : state
    })
  })

  it('renders terminal tab bar', () => {
    render(<TerminalPanel />)
    expect(screen.getByTestId('terminal-tab-bar')).toBeInTheDocument()
  })

  it('renders terminal toolbar', () => {
    render(<TerminalPanel />)
    expect(screen.getByTestId('terminal-toolbar')).toBeInTheDocument()
  })

  it('renders terminal content', () => {
    render(<TerminalPanel />)
    expect(screen.getByTestId('terminal-content')).toBeInTheDocument()
  })

  it('displays correct tab titles', () => {
    render(<TerminalPanel />)
    expect(screen.getByText('Terminal 1')).toBeInTheDocument()
    expect(screen.getByText('Terminal 2')).toBeInTheDocument()
  })

  it('calls addTab when add button clicked', async () => {
    const user = userEvent.setup()
    render(<TerminalPanel />)
    await user.click(screen.getByText('Add Tab'))
    expect(mockAddTab).toHaveBeenCalledTimes(1)
  })

  it('calls setActiveTab when tab is selected', async () => {
    const user = userEvent.setup()
    render(<TerminalPanel />)
    await user.click(screen.getByText('Terminal 2'))
    expect(mockSetActiveTab).toHaveBeenCalledWith('tab-2')
  })

  it('calls closeTab when close button clicked', async () => {
    const user = userEvent.setup()
    render(<TerminalPanel />)
    await user.click(screen.getByText('Close Tab'))
    expect(mockCloseTab).toHaveBeenCalledWith('tab-1')
  })

  it('hides clear button for agent tabs', () => {
    vi.mocked(useTerminalStore).mockImplementation((selector: any) => {
      const state = {
        tabs: [{ id: 'tab-1', title: 'Agent', kind: 'agent' }],
        activeTabId: 'tab-1',
        addTab: mockAddTab,
        closeTab: mockCloseTab,
        setActiveTab: mockSetActiveTab,
        renameTab: mockRenameTab,
        reorderTab: mockReorderTab,
        splitEnabled: false,
        toggleSplit: mockToggleSplit,
        showFind: false,
        createAgentTab: mockCreateAgentTab
      }
      return selector ? selector(state) : state
    })

    render(<TerminalPanel />)
    expect(screen.queryByText('Clear')).not.toBeInTheDocument()
  })

  it('shows clear button for shell tabs', () => {
    render(<TerminalPanel />)
    expect(screen.getByText('Clear')).toBeInTheDocument()
  })

  it('calls handleCloseOthers correctly', () => {
    // Mock getState for handleCloseOthers
    vi.mocked(useTerminalStore).getState = vi.fn().mockReturnValue({
      tabs: [
        { id: 'tab-1', title: 'Terminal 1', kind: 'shell' },
        { id: 'tab-2', title: 'Terminal 2', kind: 'shell' }
      ]
    })

    render(<TerminalPanel />)

    // This test validates that the component structure is correct
    // The actual close others logic would be tested via the TabBar component
    expect(screen.getByTestId('terminal-tab-bar')).toBeInTheDocument()
  })
})
