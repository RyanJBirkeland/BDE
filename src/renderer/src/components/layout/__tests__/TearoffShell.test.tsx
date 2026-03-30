import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// ---------------------------------------------------------------------------
// Mock framer-motion
// ---------------------------------------------------------------------------

vi.mock('framer-motion', () => ({
  motion: { div: ({ children, ...props }: any) => <div {...props}>{children}</div> },
  useReducedMotion: () => false,
  AnimatePresence: ({ children }: any) => <>{children}</>
}))

vi.mock('../../../lib/motion', () => ({
  motionVariants: {},
  transitions: {}
}))

// ---------------------------------------------------------------------------
// Mock all lazy-loaded views with simple test components
// ---------------------------------------------------------------------------

vi.mock('../../../views/DashboardView', () => ({
  default: () => <div data-testid="view-dashboard">Dashboard</div>
}))

vi.mock('../../../views/AgentsView', () => ({
  AgentsView: () => <div data-testid="view-agents">Agents</div>
}))

vi.mock('../../../views/IDEView', () => ({
  IDEView: () => <div data-testid="view-ide">IDE</div>,
  default: () => <div data-testid="view-ide">IDE</div>
}))

vi.mock('../../../views/SprintView', () => ({
  default: () => <div data-testid="view-sprint">Sprint</div>
}))

vi.mock('../../../views/SettingsView', () => ({
  default: () => <div data-testid="view-settings">Settings</div>
}))

vi.mock('../../../views/PRStationView', () => ({
  default: () => <div data-testid="view-pr-station">PR Station</div>
}))

vi.mock('../../../views/TaskWorkbenchView', () => ({
  default: () => <div data-testid="view-task-workbench">Task Workbench</div>
}))

vi.mock('../../../views/GitTreeView', () => ({
  default: () => <div data-testid="view-git">Git</div>
}))

// ---------------------------------------------------------------------------
// Mock window.api tearoff methods
// ---------------------------------------------------------------------------

const mockReturnToMain = vi.fn()
const mockCloseConfirmed = vi.fn()
const mockOnConfirmClose = vi.fn(() => vi.fn())

Object.defineProperty(window, 'api', {
  value: {
    tearoff: {
      returnToMain: mockReturnToMain,
      closeConfirmed: mockCloseConfirmed,
      onConfirmClose: mockOnConfirmClose
    }
  },
  writable: true,
  configurable: true
})

beforeEach(() => {
  vi.clearAllMocks()
  mockOnConfirmClose.mockReturnValue(vi.fn())
  mockCloseConfirmed.mockResolvedValue(undefined)
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TearoffShell', () => {
  it('renders the view name in the header', async () => {
    const { TearoffShell } = await import('../TearoffShell')
    render(<TearoffShell view="agents" windowId="tw1" />)
    expect(screen.getByText('Agents')).toBeInTheDocument()
  })

  it('renders return button with correct aria-label', async () => {
    const { TearoffShell } = await import('../TearoffShell')
    render(<TearoffShell view="agents" windowId="tw1" />)
    expect(screen.getByRole('button', { name: 'Return to main window' })).toBeInTheDocument()
  })

  it('calls returnToMain with windowId when return button is clicked', async () => {
    const { TearoffShell } = await import('../TearoffShell')
    render(<TearoffShell view="agents" windowId="tw1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Return to main window' }))
    expect(mockReturnToMain).toHaveBeenCalledWith('tw1')
  })

  it('renders the correct view label for different views', async () => {
    const { TearoffShell } = await import('../TearoffShell')
    render(<TearoffShell view="pr-station" windowId="tw2" />)
    expect(screen.getByText('PR Station')).toBeInTheDocument()
  })

  it('subscribes to onConfirmClose on mount', async () => {
    const { TearoffShell } = await import('../TearoffShell')
    render(<TearoffShell view="agents" windowId="tw1" />)
    expect(mockOnConfirmClose).toHaveBeenCalled()
  })
})
