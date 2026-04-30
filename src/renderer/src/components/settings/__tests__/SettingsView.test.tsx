/**
 * SettingsView — sidebar navigation and section switching tests.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../../stores/theme', () => ({
  useThemeStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector({ theme: 'dark', toggleTheme: vi.fn(), setTheme: vi.fn() })
  )
}))

vi.mock('../../../stores/toasts', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  useToastStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector({ toasts: [], removeToast: vi.fn() })
  )
}))

// Provide authStatus on window.api for ConnectionsSection
Object.defineProperty(window, 'api', {
  value: {
    ...(window as unknown as { api: Record<string, unknown> }).api,
    authStatus: vi.fn().mockResolvedValue({
      cliFound: true,
      tokenFound: true,
      tokenExpired: false
    })
  },
  writable: true,
  configurable: true
})

import SettingsView from '../../../views/SettingsView'

describe('SettingsView', () => {
  it('renders sidebar section labels', () => {
    render(<SettingsView />)
    // Use getAllByText since sidebar labels may also appear as section headings
    expect(screen.getAllByText('Connections').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Repositories').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Templates').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Agents').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Appearance & Shortcuts').length).toBeGreaterThanOrEqual(1)
  })

  it('shows Connections section by default', () => {
    render(<SettingsView />)
    expect(screen.getByText('Claude CLI Auth')).toBeInTheDocument()
  })

  it('switches to Appearance & Shortcuts section on sidebar click', async () => {
    const user = userEvent.setup()
    render(<SettingsView />)
    // Click the sidebar item (role="link")
    const appearanceLinks = screen.getAllByText('Appearance & Shortcuts')
    await user.click(appearanceLinks[0])
    expect(screen.getByText('Theme')).toBeInTheDocument()
    expect(screen.getByText('Accent Color')).toBeInTheDocument()
  })

  it('switches to Repositories section on sidebar click', async () => {
    const user = userEvent.setup()
    render(<SettingsView />)
    const repoLinks = screen.getAllByText('Repositories')
    await user.click(repoLinks[0])
    expect(screen.getByText('Add Repository')).toBeInTheDocument()
  })

  it('renders the Models sidebar entry', () => {
    render(<SettingsView />)
    expect(screen.getAllByText('Models').length).toBeGreaterThanOrEqual(1)
  })

  it('switches to Models section on sidebar click', async () => {
    const user = userEvent.setup()
    render(<SettingsView />)
    const modelsLinks = screen.getAllByText('Models')
    await user.click(modelsLinks[0])
    expect(screen.getByText('Opencode backend')).toBeInTheDocument()
    expect(screen.getByText('Active routing')).toBeInTheDocument()
  })
})
