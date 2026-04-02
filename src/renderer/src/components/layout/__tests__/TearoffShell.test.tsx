import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// ---------------------------------------------------------------------------
// Hoisted mock state — must be declared before vi.mock calls
// ---------------------------------------------------------------------------

const { mockSetPersistable, mockSetState, getRoot, setRoot, getFocusedPanelId, setFocusedPanelId } =
  vi.hoisted(() => {
    let root: any = null
    let focusedPanelId: string = ''
    return {
      mockSetPersistable: vi.fn(),
      mockSetState: vi.fn(),
      getRoot: () => root,
      setRoot: (r: any) => {
        root = r
      },
      getFocusedPanelId: () => focusedPanelId,
      setFocusedPanelId: (id: string) => {
        focusedPanelId = id
      }
    }
  })

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

vi.mock('../../../views/CodeReviewView', () => ({
  default: () => <div data-testid="view-code-review">Code Review</div>
}))

vi.mock('../../../views/TaskWorkbenchView', () => ({
  default: () => <div data-testid="view-task-workbench">Task Workbench</div>
}))

vi.mock('../../../views/GitTreeView', () => ({
  default: () => <div data-testid="view-git">Git</div>
}))

// ---------------------------------------------------------------------------
// Mock PanelRenderer and TearoffTabBar
// ---------------------------------------------------------------------------

vi.mock('../../panels/PanelRenderer', () => ({
  PanelRenderer: () => <div data-testid="panel-renderer" />
}))

vi.mock('../TearoffTabBar', () => ({
  TearoffTabBar: () => <div data-testid="tearoff-tab-bar" />
}))

vi.mock('../../panels/CrossWindowDropOverlay', () => ({
  CrossWindowDropOverlay: () => null
}))

// ---------------------------------------------------------------------------
// Mock useCrossWindowDrop
// ---------------------------------------------------------------------------

vi.mock('../../../hooks/useCrossWindowDrop', () => ({
  useCrossWindowDrop: () => ({
    active: false,
    localX: 0,
    localY: 0,
    viewKey: null,
    handleDrop: vi.fn()
  })
}))

// ---------------------------------------------------------------------------
// Mock panelLayout store — uses hoisted state accessors
// ---------------------------------------------------------------------------

vi.mock('../../../stores/panelLayout', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../stores/panelLayout')>()

  const store = (selector: (s: any) => any) => {
    return selector({
      root: getRoot(),
      focusedPanelId: getFocusedPanelId(),
      activeView: 'agents',
      setPersistable: mockSetPersistable
    })
  }
  store.getState = () => ({
    root: getRoot(),
    focusedPanelId: getFocusedPanelId(),
    activeView: 'agents',
    setPersistable: mockSetPersistable,
    setActiveTab: vi.fn(),
    closeTab: vi.fn()
  })
  store.setState = mockSetState
  store.subscribe = vi.fn(() => vi.fn()) // returns unsubscribe fn

  return {
    ...actual,
    usePanelLayoutStore: store
  }
})

// ---------------------------------------------------------------------------
// Import helpers after mocks are registered
// ---------------------------------------------------------------------------

import { createLeaf, type PanelNode } from '../../../stores/panelLayout'

// ---------------------------------------------------------------------------
// Mock window.api tearoff methods
// ---------------------------------------------------------------------------

const mockReturnToMain = vi.fn()
const mockReturnAll = vi.fn()
const mockCloseConfirmed = vi.fn()
const mockOnConfirmClose = vi.fn(() => vi.fn())
const mockOnDragDone = vi.fn(() => vi.fn())
const mockOnCrossWindowDrop = vi.fn(() => vi.fn())
const mockViewsChanged = vi.fn()

Object.defineProperty(window, 'api', {
  value: {
    tearoff: {
      returnToMain: mockReturnToMain,
      returnAll: mockReturnAll,
      closeConfirmed: mockCloseConfirmed,
      onConfirmClose: mockOnConfirmClose,
      onDragDone: mockOnDragDone,
      onCrossWindowDrop: mockOnCrossWindowDrop,
      viewsChanged: mockViewsChanged
    }
  },
  writable: true,
  configurable: true
})

function makeSingleLeaf(view: 'agents' | 'ide' | 'code-review' = 'agents'): PanelNode {
  return createLeaf(view)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockOnConfirmClose.mockReturnValue(vi.fn())
  mockOnDragDone.mockReturnValue(vi.fn())
  mockOnCrossWindowDrop.mockReturnValue(vi.fn())
  mockCloseConfirmed.mockResolvedValue(undefined)
  // Reset to single-tab leaf by default
  const leaf = makeSingleLeaf()
  setRoot(leaf)
  setFocusedPanelId((leaf as any).panelId)
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TearoffShell', () => {
  it('renders the view name in the header (single-view mode)', async () => {
    const { TearoffShell } = await import('../TearoffShell')
    render(<TearoffShell view="agents" windowId="tw1" />)
    expect(screen.getByText('Agents')).toBeInTheDocument()
  })

  it('renders return button with correct aria-label in single-view mode', async () => {
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
    const leaf = makeSingleLeaf('code-review')
    setRoot(leaf)
    setFocusedPanelId((leaf as any).panelId)
    const { TearoffShell } = await import('../TearoffShell')
    render(<TearoffShell view="code-review" windowId="tw2" />)
    expect(screen.getByText('Code Review')).toBeInTheDocument()
  })

  it('subscribes to onConfirmClose on mount', async () => {
    const { TearoffShell } = await import('../TearoffShell')
    render(<TearoffShell view="agents" windowId="tw1" />)
    expect(mockOnConfirmClose).toHaveBeenCalled()
  })

  it('initializes store with persistable: false on mount', async () => {
    const { TearoffShell } = await import('../TearoffShell')
    render(<TearoffShell view="agents" windowId="tw1" />)
    expect(mockSetPersistable).toHaveBeenCalledWith(false)
  })

  it('calls setState with initial leaf and focused panel on mount', async () => {
    const { TearoffShell } = await import('../TearoffShell')
    render(<TearoffShell view="agents" windowId="tw1" />)
    expect(mockSetState).toHaveBeenCalledWith(
      expect.objectContaining({
        activeView: 'agents'
      })
    )
  })

  it('renders single view (not PanelRenderer) when store has one tab', async () => {
    // Default mockRoot is a leaf with 1 tab
    const { TearoffShell } = await import('../TearoffShell')
    render(<TearoffShell view="agents" windowId="tw1" />)
    expect(screen.queryByTestId('panel-renderer')).not.toBeInTheDocument()
  })

  describe('multi-tab / panel mode (split root)', () => {
    beforeEach(() => {
      const left = createLeaf('agents')
      const right = createLeaf('ide')
      const splitRoot: PanelNode = {
        type: 'split',
        direction: 'horizontal',
        children: [left, right],
        sizes: [50, 50]
      }
      setRoot(splitRoot)
      setFocusedPanelId(left.panelId)
    })

    it('renders PanelRenderer when store is in split mode', async () => {
      const { TearoffShell } = await import('../TearoffShell')
      render(<TearoffShell view="agents" windowId="tw1" />)
      expect(screen.getByTestId('panel-renderer')).toBeInTheDocument()
    })

    it('shows "Return all tabs to main window" button in split mode', async () => {
      const { TearoffShell } = await import('../TearoffShell')
      render(<TearoffShell view="agents" windowId="tw1" />)
      expect(
        screen.getByRole('button', { name: 'Return all tabs to main window' })
      ).toBeInTheDocument()
    })

    it('calls returnAll when "Return all tabs" button is clicked', async () => {
      const { TearoffShell } = await import('../TearoffShell')
      render(<TearoffShell view="agents" windowId="tw1" />)
      fireEvent.click(screen.getByRole('button', { name: 'Return all tabs to main window' }))
      expect(mockReturnAll).toHaveBeenCalledWith(
        expect.objectContaining({ windowId: 'tw1', views: expect.any(Array) })
      )
    })
  })

  describe('multi-tab leaf mode (leaf with 2+ tabs)', () => {
    beforeEach(() => {
      const multiLeaf: PanelNode = {
        type: 'leaf',
        panelId: 'p99',
        tabs: [
          { viewKey: 'agents', label: 'Agents' },
          { viewKey: 'ide', label: 'IDE' }
        ],
        activeTab: 0
      }
      setRoot(multiLeaf)
      setFocusedPanelId('p99')
    })

    it('renders PanelRenderer when leaf has multiple tabs', async () => {
      const { TearoffShell } = await import('../TearoffShell')
      render(<TearoffShell view="agents" windowId="tw1" />)
      expect(screen.getByTestId('panel-renderer')).toBeInTheDocument()
    })

    it('renders TearoffTabBar in panel mode', async () => {
      const { TearoffShell } = await import('../TearoffShell')
      render(<TearoffShell view="agents" windowId="tw1" />)
      expect(screen.getByTestId('tearoff-tab-bar')).toBeInTheDocument()
    })

    it('shows "Return all tabs to main window" button in multi-tab leaf mode', async () => {
      const { TearoffShell } = await import('../TearoffShell')
      render(<TearoffShell view="agents" windowId="tw1" />)
      expect(
        screen.getByRole('button', { name: 'Return all tabs to main window' })
      ).toBeInTheDocument()
    })
  })
})
