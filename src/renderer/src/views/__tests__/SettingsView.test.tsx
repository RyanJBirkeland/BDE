import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// Mock framer-motion
vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, ...rest }: any) => <div {...rest}>{children}</div>
  },
  useReducedMotion: () => false
}))

// Mock lib/motion to avoid re-export issues
vi.mock('../../lib/motion', () => ({
  VARIANTS: { fadeIn: {} },
  SPRINGS: { snappy: {} },
  REDUCED_TRANSITION: { duration: 0 },
  useReducedMotion: () => false
}))

// Mock all section components
vi.mock('../../components/settings/AppearanceSection', () => ({
  AppearanceSection: () => <div data-testid="section-appearance">Appearance</div>
}))
vi.mock('../../components/settings/ConnectionsSection', () => ({
  ConnectionsSection: () => <div data-testid="section-connections">Connections</div>
}))
vi.mock('../../components/settings/RepositoriesSection', () => ({
  RepositoriesSection: () => <div data-testid="section-repositories">Repositories</div>
}))
vi.mock('../../components/settings/TaskTemplatesSection', () => ({
  TaskTemplatesSection: () => <div data-testid="section-templates">Templates</div>
}))
vi.mock('../../components/settings/AgentRuntimeSection', () => ({
  AgentRuntimeSection: () => <div data-testid="section-agent">Agent</div>
}))
vi.mock('../../components/settings/AgentPermissionsSection', () => ({
  AgentPermissionsSection: () => <div data-testid="section-permissions">Permissions</div>
}))
vi.mock('../../components/settings/AgentManagerSection', () => ({
  AgentManagerSection: () => <div data-testid="section-agentManager">Agent Manager</div>
}))
vi.mock('../../components/settings/CostSection', () => ({
  CostSection: () => <div data-testid="section-cost">Cost</div>
}))
vi.mock('../../components/settings/MemorySection', () => ({
  MemorySection: () => <div data-testid="section-memory">Memory</div>
}))
vi.mock('../../components/settings/AboutSection', () => ({
  AboutSection: () => <div data-testid="section-about">About</div>
}))

import SettingsView from '../SettingsView'

describe('SettingsView', () => {
  it('renders Settings header', () => {
    render(<SettingsView />)
    expect(screen.getByText('Settings')).toBeInTheDocument()
  })

  it('renders all tab buttons', () => {
    render(<SettingsView />)
    expect(screen.getByRole('tab', { name: /Connections/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Repositories/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Templates/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Agent Manager/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Appearance/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /About/ })).toBeInTheDocument()
  })

  it('defaults to Connections tab', () => {
    render(<SettingsView />)
    expect(screen.getByRole('tab', { name: /Connections/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('section-connections')).toBeInTheDocument()
  })

  it('switches to Appearance tab on click', () => {
    render(<SettingsView />)
    fireEvent.click(screen.getByRole('tab', { name: /Appearance/ }))
    expect(screen.getByRole('tab', { name: /Appearance/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('section-appearance')).toBeInTheDocument()
    expect(screen.queryByTestId('section-connections')).not.toBeInTheDocument()
  })

  it('switches to About tab on click', () => {
    render(<SettingsView />)
    fireEvent.click(screen.getByRole('tab', { name: /About/ }))
    expect(screen.getByTestId('section-about')).toBeInTheDocument()
  })

  // ---------- Branch coverage: tabIndex roving ----------

  it('active tab has tabIndex 0, others have tabIndex -1', () => {
    render(<SettingsView />)
    const connectionsTab = screen.getByRole('tab', { name: /Connections/ })
    const aboutTab = screen.getByRole('tab', { name: /About/ })
    expect(connectionsTab).toHaveAttribute('tabindex', '0')
    expect(aboutTab).toHaveAttribute('tabindex', '-1')
  })

  it('updates tabIndex when tab changes', () => {
    render(<SettingsView />)
    fireEvent.click(screen.getByRole('tab', { name: /About/ }))
    const connectionsTab = screen.getByRole('tab', { name: /Connections/ })
    const aboutTab = screen.getByRole('tab', { name: /About/ })
    expect(aboutTab).toHaveAttribute('tabindex', '0')
    expect(connectionsTab).toHaveAttribute('tabindex', '-1')
  })

  // ---------- Branch coverage: arrow key navigation ----------

  it('ArrowRight moves to next tab', () => {
    render(<SettingsView />)
    const connectionsTab = screen.getByRole('tab', { name: /Connections/ })
    fireEvent.keyDown(connectionsTab, { key: 'ArrowRight' })
    // Repositories is the second tab
    expect(screen.getByRole('tab', { name: /Repositories/ })).toHaveAttribute('aria-selected', 'true')
  })

  it('ArrowDown moves to next tab', () => {
    render(<SettingsView />)
    const connectionsTab = screen.getByRole('tab', { name: /Connections/ })
    fireEvent.keyDown(connectionsTab, { key: 'ArrowDown' })
    expect(screen.getByRole('tab', { name: /Repositories/ })).toHaveAttribute('aria-selected', 'true')
  })

  it('ArrowLeft wraps from first tab to last tab', () => {
    render(<SettingsView />)
    const connectionsTab = screen.getByRole('tab', { name: /Connections/ })
    fireEvent.keyDown(connectionsTab, { key: 'ArrowLeft' })
    // About is the last tab
    expect(screen.getByRole('tab', { name: /About/ })).toHaveAttribute('aria-selected', 'true')
  })

  it('ArrowUp wraps from first tab to last tab', () => {
    render(<SettingsView />)
    const connectionsTab = screen.getByRole('tab', { name: /Connections/ })
    fireEvent.keyDown(connectionsTab, { key: 'ArrowUp' })
    expect(screen.getByRole('tab', { name: /About/ })).toHaveAttribute('aria-selected', 'true')
  })

  it('ArrowRight wraps from last tab to first tab', () => {
    render(<SettingsView />)
    // Navigate to last tab first
    fireEvent.click(screen.getByRole('tab', { name: /About/ }))
    const aboutTab = screen.getByRole('tab', { name: /About/ })
    fireEvent.keyDown(aboutTab, { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: /Connections/ })).toHaveAttribute('aria-selected', 'true')
  })

  it('Home key moves to first tab', () => {
    render(<SettingsView />)
    // Navigate away from first tab
    fireEvent.click(screen.getByRole('tab', { name: /About/ }))
    const aboutTab = screen.getByRole('tab', { name: /About/ })
    fireEvent.keyDown(aboutTab, { key: 'Home' })
    expect(screen.getByRole('tab', { name: /Connections/ })).toHaveAttribute('aria-selected', 'true')
  })

  it('End key moves to last tab', () => {
    render(<SettingsView />)
    const connectionsTab = screen.getByRole('tab', { name: /Connections/ })
    fireEvent.keyDown(connectionsTab, { key: 'End' })
    expect(screen.getByRole('tab', { name: /About/ })).toHaveAttribute('aria-selected', 'true')
  })

  it('unrecognized key does not change tab', () => {
    render(<SettingsView />)
    const connectionsTab = screen.getByRole('tab', { name: /Connections/ })
    fireEvent.keyDown(connectionsTab, { key: 'a' })
    expect(screen.getByRole('tab', { name: /Connections/ })).toHaveAttribute('aria-selected', 'true')
  })

  // ---------- Branch coverage: tabpanel aria-label ----------

  it('tabpanel has correct aria-label for active tab', () => {
    render(<SettingsView />)
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-label', 'Connections settings')
  })

  it('tabpanel aria-label updates when tab changes', () => {
    render(<SettingsView />)
    fireEvent.click(screen.getByRole('tab', { name: /About/ }))
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-label', 'About settings')
  })

  // ---------- Branch coverage: each section renders ----------

  it('renders Templates section when tab clicked', () => {
    render(<SettingsView />)
    fireEvent.click(screen.getByRole('tab', { name: /Templates/ }))
    expect(screen.getByTestId('section-templates')).toBeInTheDocument()
  })

  it('renders Agent section when tab clicked', () => {
    render(<SettingsView />)
    // There are two tabs with "Agent" in the name, use exact match
    const agentTab = screen.getAllByRole('tab').find(
      (t) => t.textContent === 'Agent'
    )!
    fireEvent.click(agentTab)
    expect(screen.getByTestId('section-agent')).toBeInTheDocument()
  })

  it('renders Agent Manager section when tab clicked', () => {
    render(<SettingsView />)
    fireEvent.click(screen.getByRole('tab', { name: /Agent Manager/ }))
    expect(screen.getByTestId('section-agentManager')).toBeInTheDocument()
  })

  it('renders Cost section when tab clicked', () => {
    render(<SettingsView />)
    fireEvent.click(screen.getByRole('tab', { name: /Cost/ }))
    expect(screen.getByTestId('section-cost')).toBeInTheDocument()
  })

  it('renders Memory section when tab clicked', () => {
    render(<SettingsView />)
    fireEvent.click(screen.getByRole('tab', { name: /Memory/ }))
    expect(screen.getByTestId('section-memory')).toBeInTheDocument()
  })

  it('renders Permissions section when tab clicked', () => {
    render(<SettingsView />)
    fireEvent.click(screen.getByRole('tab', { name: /Permissions/ }))
    expect(screen.getByTestId('section-permissions')).toBeInTheDocument()
  })
})
