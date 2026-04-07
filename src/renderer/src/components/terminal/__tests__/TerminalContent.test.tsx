import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TerminalContent } from '../TerminalContent'
import type { TerminalTab } from '../../../stores/terminal'

// Mock heavy child components
vi.mock('../TerminalPane', () => ({
  TerminalPane: ({ tabId }: { tabId: string }) => <div data-testid={`terminal-pane-${tabId}`} />
}))

vi.mock('../FindBar', () => ({
  FindBar: () => <div data-testid="find-bar" />
}))

vi.mock('../AgentOutputTab', () => ({
  AgentOutputTab: ({ agentId }: { agentId: string }) => (
    <div data-testid={`agent-output-${agentId}`} />
  )
}))

// react-resizable-panels is used in the split pane path — provide minimal stubs
vi.mock('react-resizable-panels', () => ({
  Group: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Panel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Separator: () => <div />
}))

function makeTab(overrides: Partial<TerminalTab> = {}): TerminalTab {
  return {
    id: 'tab-1',
    title: 'Terminal 1',
    kind: 'shell',
    shell: '/bin/zsh',
    ptyId: null,
    isLabelCustom: false,
    status: 'running',
    hasUnread: false,
    ...overrides
  }
}

const defaultProps = {
  tabs: [makeTab()],
  activeTabId: 'tab-1',
  splitEnabled: false,
  showFind: false,
  activeView: 'ide'
}

describe('TerminalContent', () => {
  it('renders the active tab pane', () => {
    render(<TerminalContent {...defaultProps} />)
    expect(screen.getByTestId('terminal-pane-tab-1')).toBeInTheDocument()
  })

  it('renders multiple tab panes (non-active are hidden)', () => {
    const tabs = [
      makeTab({ id: 'tab-1', title: 'Terminal 1' }),
      makeTab({ id: 'tab-2', title: 'Terminal 2' })
    ]
    render(<TerminalContent {...defaultProps} tabs={tabs} activeTabId="tab-1" />)
    expect(screen.getByTestId('terminal-pane-tab-1')).toBeInTheDocument()
    expect(screen.getByTestId('terminal-pane-tab-2')).toBeInTheDocument()
  })

  it('renders AgentOutputTab for agent tabs', () => {
    const agentTab = makeTab({
      id: 'agent-1',
      title: 'My Agent',
      kind: 'agent',
      agentId: 'agent-abc'
    })
    render(<TerminalContent {...defaultProps} tabs={[agentTab]} activeTabId="agent-1" />)
    expect(screen.getByTestId('agent-output-agent-abc')).toBeInTheDocument()
  })

  it('shows "Agent Output" label for agent tabs', () => {
    const agentTab = makeTab({
      id: 'agent-1',
      title: 'My Agent',
      kind: 'agent',
      agentId: 'agent-abc'
    })
    render(<TerminalContent {...defaultProps} tabs={[agentTab]} activeTabId="agent-1" />)
    expect(screen.getByText(/Agent Output/)).toBeInTheDocument()
  })

  it('shows FindBar when showFind is true and not an agent tab', () => {
    render(<TerminalContent {...defaultProps} showFind={true} />)
    expect(screen.getByTestId('find-bar')).toBeInTheDocument()
  })

  it('does not show FindBar for agent tabs', () => {
    const agentTab = makeTab({ id: 'agent-1', kind: 'agent', agentId: 'a1' })
    render(
      <TerminalContent {...defaultProps} tabs={[agentTab]} activeTabId="agent-1" showFind={true} />
    )
    expect(screen.queryByTestId('find-bar')).not.toBeInTheDocument()
  })
})
