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

// Mock SettingsSidebar
vi.mock('../../components/settings/SettingsSidebar', () => ({
  SettingsSidebar: ({ sections, activeId, onSelect }: any) => (
    <nav role="navigation" aria-label="Settings sections">
      {['Account', 'Projects', 'Pipeline', 'App'].map((cat) => (
        <div key={cat}>
          <div data-testid={`category-${cat}`}>{cat}</div>
          {sections
            .filter((s: any) => s.category === cat)
            .map((s: any) => (
              <div
                key={s.id}
                role="link"
                data-id={s.id}
                aria-current={s.id === activeId ? 'page' : undefined}
                tabIndex={s.id === activeId ? 0 : -1}
                onClick={() => onSelect(s.id)}
                onKeyDown={(e: React.KeyboardEvent) => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault()
                    const ids = sections.map((sec: any) => sec.id)
                    const idx = ids.indexOf(s.id)
                    const nextIdx = idx < ids.length - 1 ? idx + 1 : 0
                    onSelect(ids[nextIdx])
                  }
                }}
              >
                {s.label}
              </div>
            ))}
        </div>
      ))}
    </nav>
  )
}))

// Mock SettingsPageHeader
vi.mock('../../components/settings/SettingsPageHeader', () => ({
  SettingsPageHeader: ({ title, subtitle }: any) => (
    <div data-testid="page-header">
      <h2>{title}</h2>
      <p>{subtitle}</p>
    </div>
  )
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
  it('renders sidebar navigation', () => {
    render(<SettingsView />)
    expect(screen.getByRole('navigation', { name: /Settings sections/ })).toBeInTheDocument()
  })

  it('renders category headers', () => {
    render(<SettingsView />)
    expect(screen.getByText('Account')).toBeInTheDocument()
    expect(screen.getByText('Projects')).toBeInTheDocument()
    expect(screen.getByText('Pipeline')).toBeInTheDocument()
    expect(screen.getByText('App')).toBeInTheDocument()
  })

  it('renders all sidebar items (9 sections, no Agent tab)', () => {
    render(<SettingsView />)
    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(9)
    // Agent tab should not exist
    expect(screen.queryByText('Agent')).not.toBeInTheDocument()
  })

  it('defaults to Connections section', () => {
    render(<SettingsView />)
    const connectionsLink = screen.getByRole('link', { name: /Connections/ })
    expect(connectionsLink).toHaveAttribute('aria-current', 'page')
    expect(screen.getByTestId('section-connections')).toBeInTheDocument()
  })

  it('renders page header with title and subtitle', () => {
    render(<SettingsView />)
    expect(screen.getByTestId('page-header')).toBeInTheDocument()
    const header = screen.getByTestId('page-header')
    expect(header.querySelector('h2')?.textContent).toBe('Connections')
    expect(screen.getByText('Manage authentication tokens and API access')).toBeInTheDocument()
  })

  it('switches to Appearance section on click', () => {
    render(<SettingsView />)
    fireEvent.click(screen.getByRole('link', { name: /Appearance/ }))
    expect(screen.getByRole('link', { name: /Appearance/ })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByTestId('section-appearance')).toBeInTheDocument()
    expect(screen.queryByTestId('section-connections')).not.toBeInTheDocument()
  })

  it('switches to About section on click', () => {
    render(<SettingsView />)
    fireEvent.click(screen.getByRole('link', { name: /About/ }))
    expect(screen.getByTestId('section-about')).toBeInTheDocument()
  })

  // ---------- Branch coverage: tabIndex roving ----------

  it('active item has tabIndex 0, others have tabIndex -1', () => {
    render(<SettingsView />)
    const connectionsLink = screen.getByRole('link', { name: /Connections/ })
    const aboutLink = screen.getByRole('link', { name: /About/ })
    expect(connectionsLink).toHaveAttribute('tabindex', '0')
    expect(aboutLink).toHaveAttribute('tabindex', '-1')
  })

  it('updates tabIndex when section changes', () => {
    render(<SettingsView />)
    fireEvent.click(screen.getByRole('link', { name: /About/ }))
    const connectionsLink = screen.getByRole('link', { name: /Connections/ })
    const aboutLink = screen.getByRole('link', { name: /About/ })
    expect(aboutLink).toHaveAttribute('tabindex', '0')
    expect(connectionsLink).toHaveAttribute('tabindex', '-1')
  })

  // ---------- Branch coverage: keyboard navigation ----------

  it('ArrowDown navigates to next section', () => {
    render(<SettingsView />)
    const connectionsLink = screen.getByRole('link', { name: /Connections/ })
    fireEvent.keyDown(connectionsLink, { key: 'ArrowDown' })
    // Permissions is second in the list
    expect(screen.getByRole('link', { name: /Permissions/ })).toHaveAttribute(
      'aria-current',
      'page'
    )
  })

  // ---------- Branch coverage: each section renders ----------

  it('renders Repositories section when clicked', () => {
    render(<SettingsView />)
    fireEvent.click(screen.getByRole('link', { name: /Repositories/ }))
    expect(screen.getByTestId('section-repositories')).toBeInTheDocument()
  })

  it('renders Templates section when clicked', () => {
    render(<SettingsView />)
    fireEvent.click(screen.getByRole('link', { name: /Templates/ }))
    expect(screen.getByTestId('section-templates')).toBeInTheDocument()
  })

  it('renders Permissions section when clicked', () => {
    render(<SettingsView />)
    fireEvent.click(screen.getByRole('link', { name: /Permissions/ }))
    expect(screen.getByTestId('section-permissions')).toBeInTheDocument()
  })

  it('renders Agent Manager section when clicked', () => {
    render(<SettingsView />)
    fireEvent.click(screen.getByRole('link', { name: /Agent Manager/ }))
    expect(screen.getByTestId('section-agentManager')).toBeInTheDocument()
  })

  it('renders Cost section when clicked', () => {
    render(<SettingsView />)
    fireEvent.click(screen.getByRole('link', { name: /Cost/ }))
    expect(screen.getByTestId('section-cost')).toBeInTheDocument()
  })

  it('renders Memory section when clicked', () => {
    render(<SettingsView />)
    fireEvent.click(screen.getByRole('link', { name: /Memory/ }))
    expect(screen.getByTestId('section-memory')).toBeInTheDocument()
  })

  // ---------- aria-live announcements ----------

  it('has aria-live region announcing active section', () => {
    render(<SettingsView />)
    const liveRegion = screen.getByText('Connections settings')
    expect(liveRegion).toHaveAttribute('aria-live', 'polite')
  })

  it('aria-live updates when section changes', () => {
    render(<SettingsView />)
    fireEvent.click(screen.getByRole('link', { name: /About/ }))
    expect(screen.getByText('About settings')).toHaveAttribute('aria-live', 'polite')
  })

  // ---------- Wide layout ----------

  it('applies wide class for cost section', () => {
    render(<SettingsView />)
    fireEvent.click(screen.getByRole('link', { name: /Cost/ }))
    const inner = screen.getByTestId('section-cost').parentElement
    expect(inner?.className).toContain('stg-content__inner--wide')
  })

  it('does not apply wide class for connections section', () => {
    render(<SettingsView />)
    const inner = screen.getByTestId('section-connections').parentElement
    expect(inner?.className).not.toContain('stg-content__inner--wide')
  })
})
