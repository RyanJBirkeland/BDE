import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TerminalPanel } from '../TerminalPanel'
import { useTerminalStore } from '../../../stores/terminal'
import { usePanelLayoutStore } from '../../../stores/panelLayout'

vi.mock('../../../stores/terminal')
vi.mock('../../../stores/panelLayout')
vi.mock('../../terminal/TerminalContent', () => ({
  TerminalContent: () => <div data-testid="terminal-content">Terminal Content</div>
}))
vi.mock('../../terminal/TerminalPane', () => ({
  clearTerminal: vi.fn()
}))

describe('TerminalPanel', () => {
  const mockCloseTab = vi.fn()
  const mockSetActiveTab = vi.fn()
  const mockToggleSplit = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()

    vi.mocked(useTerminalStore).mockImplementation((selector: any) => {
      const state = {
        tabs: [
          { id: 'tab-1', title: 'Terminal 1', kind: 'shell', status: 'running', hasUnread: false },
          { id: 'tab-2', title: 'Terminal 2', kind: 'shell', status: 'running', hasUnread: false }
        ],
        activeTabId: 'tab-1',
        closeTab: mockCloseTab,
        setActiveTab: mockSetActiveTab,
        splitEnabled: false,
        toggleSplit: mockToggleSplit,
        showFind: false
      }
      return selector ? selector(state) : state
    })

    vi.mocked(usePanelLayoutStore).mockImplementation((selector: any) => {
      const state = { activeView: 'ide' }
      return selector ? selector(state) : state
    })
  })

  it('renders TERMINAL eyebrow label', () => {
    render(<TerminalPanel />)
    expect(screen.getByText('TERMINAL')).toBeInTheDocument()
  })

  it('renders the tab list container', () => {
    render(<TerminalPanel />)
    expect(screen.getByRole('tablist', { name: 'Terminal tabs' })).toBeInTheDocument()
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

  it('marks the active tab with aria-selected', () => {
    render(<TerminalPanel />)
    const tabs = screen.getAllByRole('tab')
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
    expect(tabs[1]).toHaveAttribute('aria-selected', 'false')
  })

  it('calls setActiveTab when a tab is clicked', async () => {
    const user = userEvent.setup()
    render(<TerminalPanel />)
    await user.click(screen.getByText('Terminal 2'))
    expect(mockSetActiveTab).toHaveBeenCalledWith('tab-2')
  })

  it('calls closeTab when close button is clicked', async () => {
    const user = userEvent.setup()
    render(<TerminalPanel />)
    // Close button on first tab (tab-1 is active, so its close glyph is visible)
    const closeBtn = screen.getByLabelText('Close Terminal 1')
    await user.click(closeBtn)
    expect(mockCloseTab).toHaveBeenCalledWith('tab-1')
  })

  it('hides clear button for agent tabs', () => {
    vi.mocked(useTerminalStore).mockImplementation((selector: any) => {
      const state = {
        tabs: [{ id: 'tab-1', title: 'Agent', kind: 'agent', status: 'running', hasUnread: false }],
        activeTabId: 'tab-1',
        closeTab: mockCloseTab,
        setActiveTab: mockSetActiveTab,
        splitEnabled: false,
        toggleSplit: mockToggleSplit,
        showFind: false
      }
      return selector ? selector(state) : state
    })

    render(<TerminalPanel />)
    expect(screen.queryByTitle('Clear terminal (⌃L)')).not.toBeInTheDocument()
  })

  it('shows clear button for shell tabs', () => {
    render(<TerminalPanel />)
    expect(screen.getByTitle('Clear terminal (⌃L)')).toBeInTheDocument()
  })

  it('renders split, kill, and maximize icon buttons', () => {
    render(<TerminalPanel />)
    expect(screen.getByTitle(/Split pane/)).toBeInTheDocument()
    expect(screen.getByTitle('Kill terminal')).toBeInTheDocument()
    expect(screen.getByTitle('Maximize terminal')).toBeInTheDocument()
  })

  it('calls toggleSplit when split button is clicked', async () => {
    const user = userEvent.setup()
    render(<TerminalPanel />)
    await user.click(screen.getByTitle(/Split pane/))
    expect(mockToggleSplit).toHaveBeenCalledTimes(1)
  })
})
