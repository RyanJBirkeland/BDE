import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PanelLeaf } from '../PanelLeaf'
import type { PanelLeafNode } from '../../../stores/panelLayout'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFocusPanel = vi.fn()
const mockMoveTab = vi.fn()
const mockAddTab = vi.fn()
const mockSplitPanel = vi.fn()
let mockFocusedPanelId = 'panel-1'

vi.mock('../../../stores/panelLayout', async () => {
  const actual = await vi.importActual('../../../stores/panelLayout')
  const store = vi.fn((sel: (s: unknown) => unknown) =>
    sel({
      get focusedPanelId() { return mockFocusedPanelId },
      focusPanel: mockFocusPanel,
      setActiveTab: vi.fn(),
      closeTab: vi.fn(),
      root: { type: 'split' },
    })
  )
  ;(store as any).subscribe = vi.fn()
  ;(store as any).getState = () => ({
    get focusedPanelId() { return mockFocusedPanelId },
    focusPanel: mockFocusPanel,
    moveTab: mockMoveTab,
    addTab: mockAddTab,
    splitPanel: mockSplitPanel,
    setActiveTab: vi.fn(),
    closeTab: vi.fn(),
    root: { type: 'split' },
  })
  return { ...(actual as object), usePanelLayoutStore: store }
})

// Mock views used in PanelLeaf
vi.mock('../../../views/AgentsView', () => ({ AgentsView: () => <div data-testid="agents-view">Agents</div> }))
vi.mock('../../../views/IDEView', () => ({ default: () => <div data-testid="ide-view">IDE</div>, IDEView: () => <div data-testid="ide-view">IDE</div> }))
vi.mock('../../../views/SprintView', () => ({ default: () => <div data-testid="sprint-view">Sprint</div> }))
vi.mock('../../../views/MemoryView', () => ({ default: () => <div data-testid="memory-view">Memory</div> }))
vi.mock('../../../views/CostView', () => ({ default: () => <div data-testid="cost-view">Cost</div> }))
vi.mock('../../../views/SettingsView', () => ({ default: () => <div data-testid="settings-view">Settings</div> }))
vi.mock('../../../views/PRStationView', () => ({ default: () => <div data-testid="pr-station-view">PRStation</div> }))

// Mock PanelDropOverlay to avoid complex drag logic in these tests
vi.mock('../PanelDropOverlay', () => ({
  PanelDropOverlay: ({ panelId, onDrop }: { panelId: string; onDrop: (panelId: string, zone: string, data: unknown) => void }) => (
    <div data-testid="drop-overlay" data-panel-id={panelId} onClick={() => onDrop(panelId, 'center', { viewKey: 'sprint' })}>
      Drop Overlay
    </div>
  ),
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLeaf(overrides: Partial<PanelLeafNode> = {}): PanelLeafNode {
  return {
    type: 'leaf',
    panelId: 'panel-1',
    tabs: [{ viewKey: 'agents', label: 'Agents' }],
    activeTab: 0,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PanelLeaf', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFocusedPanelId = 'panel-1'
  })

  it('renders the active view', async () => {
    const node = makeLeaf()
    render(<PanelLeaf node={node} />)
    // The active view (agents) should be visible
    expect(await screen.findByTestId('agents-view')).toBeInTheDocument()
  })

  it('does not render tab bar when panel is focused', async () => {
    mockFocusedPanelId = 'panel-1'
    const node = makeLeaf({ panelId: 'panel-1' })
    render(<PanelLeaf node={node} />)
    // Should not have slim label when focused
    expect(screen.queryByText('Agents', { selector: '.panel-label-slim *' })).not.toBeInTheDocument()
  })

  it('renders slim label when panel is not focused', async () => {
    mockFocusedPanelId = 'panel-other'
    const node = makeLeaf({ panelId: 'panel-1', tabs: [{ viewKey: 'agents', label: 'Agents' }] })
    const { container } = render(<PanelLeaf node={node} />)
    // Should have slim label with tab name
    const slimLabel = container.querySelector('.panel-label-slim')
    expect(slimLabel).toBeInTheDocument()
    expect(slimLabel).toHaveTextContent('Agents')
  })

  it('slim label focuses panel when clicked', async () => {
    const user = userEvent.setup()
    mockFocusedPanelId = 'panel-other'
    const node = makeLeaf({ panelId: 'panel-1' })
    const { container } = render(<PanelLeaf node={node} />)

    const slimLabel = container.querySelector('.panel-label-slim')
    expect(slimLabel).toBeInTheDocument()

    await user.click(slimLabel as HTMLElement)
    expect(mockFocusPanel).toHaveBeenCalledWith('panel-1')
  })

  it('clicking the panel container calls focusPanel', async () => {
    const user = userEvent.setup()
    const node = makeLeaf()
    const { container } = render(<PanelLeaf node={node} />)

    // Click the outermost container div
    await user.click(container.firstChild as HTMLElement)

    expect(mockFocusPanel).toHaveBeenCalledWith('panel-1')
  })

  it('renders multiple tabs but only shows active one', async () => {
    const node = makeLeaf({
      tabs: [
        { viewKey: 'agents', label: 'Agents' },
        { viewKey: 'ide', label: 'IDE' },
      ],
      activeTab: 0,
    })
    render(<PanelLeaf node={node} />)

    // Agents is active (display: flex), terminal is hidden (display: none)
    const agentsView = await screen.findByTestId('agents-view')
    expect(agentsView).toBeInTheDocument()

    const ideView = await screen.findByTestId('ide-view')
    // IDE is rendered but hidden via display:none
    expect(ideView.parentElement?.style.display).toBe('none')
  })

  it('shows focused panel with accent outline', () => {
    mockFocusedPanelId = 'panel-1'
    const node = makeLeaf({ panelId: 'panel-1' })
    const { container } = render(<PanelLeaf node={node} />)
    const outerDiv = container.firstChild as HTMLElement
    expect(outerDiv.style.outline).toContain('1px solid')
  })

  it('shows non-focused panel with transparent outline', () => {
    mockFocusedPanelId = 'panel-other'
    const node = makeLeaf({ panelId: 'panel-1' })
    const { container } = render(<PanelLeaf node={node} />)
    const outerDiv = container.firstChild as HTMLElement
    expect(outerDiv.style.outline).toBe('1px solid transparent')
  })

  it('shows drop overlay when drag enters with bde-panel data type', () => {
    const node = makeLeaf()
    const { container } = render(<PanelLeaf node={node} />)
    const outerDiv = container.firstChild as HTMLElement

    fireEvent.dragEnter(outerDiv, {
      dataTransfer: { types: ['application/bde-panel'] },
    })

    expect(screen.getByTestId('drop-overlay')).toBeInTheDocument()
  })

  it('does not show drop overlay for non-bde-panel drag types', () => {
    const node = makeLeaf()
    const { container } = render(<PanelLeaf node={node} />)
    const outerDiv = container.firstChild as HTMLElement

    fireEvent.dragEnter(outerDiv, {
      dataTransfer: { types: ['text/plain'] },
    })

    expect(screen.queryByTestId('drop-overlay')).not.toBeInTheDocument()
  })

  it('drop calls addTab when zone is center and viewKey provided', async () => {
    const user = userEvent.setup()
    const node = makeLeaf()
    const { container } = render(<PanelLeaf node={node} />)
    const outerDiv = container.firstChild as HTMLElement

    // Trigger drag enter to show overlay
    fireEvent.dragEnter(outerDiv, {
      dataTransfer: { types: ['application/bde-panel'] },
    })

    const overlay = screen.getByTestId('drop-overlay')
    await user.click(overlay) // overlay onClick fires onDrop with center zone

    expect(mockAddTab).toHaveBeenCalledWith('panel-1', 'sprint')
    // Overlay should be gone after drop
    expect(screen.queryByTestId('drop-overlay')).not.toBeInTheDocument()
  })

  it('renders sprint view when tab viewKey is sprint', async () => {
    const node = makeLeaf({ tabs: [{ viewKey: 'sprint', label: 'Sprint' }] })
    render(<PanelLeaf node={node} />)
    expect(await screen.findByTestId('sprint-view')).toBeInTheDocument()
  })

  it('renders pr-station view when tab viewKey is pr-station', async () => {
    const node = makeLeaf({ tabs: [{ viewKey: 'pr-station', label: 'PR Station' }] })
    render(<PanelLeaf node={node} />)
    expect(await screen.findByTestId('pr-station-view')).toBeInTheDocument()
  })
})
