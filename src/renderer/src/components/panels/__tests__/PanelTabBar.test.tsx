import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { PanelTabBar } from '../PanelTabBar'
import type { PanelLeafNode } from '../../../stores/panelLayout'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSetActiveTab = vi.fn()
const mockCloseTab = vi.fn()
const mockFocusPanel = vi.fn()
let mockRoot: { type: string; tabs?: unknown[]; panelId?: string } = { type: 'split' }

vi.mock('../../../stores/panelLayout', async () => {
  const actual = await vi.importActual('../../../stores/panelLayout')
  const store = vi.fn((sel: (s: unknown) => unknown) =>
    sel({
      setActiveTab: mockSetActiveTab,
      closeTab: mockCloseTab,
      focusPanel: mockFocusPanel,
      get root() { return mockRoot },
    })
  )
  ;(store as any).getState = () => ({
    setActiveTab: mockSetActiveTab,
    closeTab: mockCloseTab,
    focusPanel: mockFocusPanel,
    get root() { return mockRoot },
  })
  return { ...(actual as object), usePanelLayoutStore: store }
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLeaf(overrides: Partial<PanelLeafNode> = {}): PanelLeafNode {
  return {
    type: 'leaf',
    panelId: 'panel-1',
    tabs: [
      { viewKey: 'agents', label: 'Agents' },
      { viewKey: 'ide', label: 'IDE' },
    ],
    activeTab: 0,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PanelTabBar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRoot = { type: 'split' } // not a lone leaf by default
  })

  it('renders all tab labels', () => {
    render(<PanelTabBar node={makeLeaf()} />)
    expect(screen.getByText('Agents')).toBeInTheDocument()
    expect(screen.getByText('IDE')).toBeInTheDocument()
  })

  it('clicking a tab calls focusPanel and setActiveTab', async () => {
    const user = userEvent.setup()
    render(<PanelTabBar node={makeLeaf()} />)

    await user.click(screen.getByText('IDE'))

    expect(mockFocusPanel).toHaveBeenCalledWith('panel-1')
    expect(mockSetActiveTab).toHaveBeenCalledWith('panel-1', 1)
  })

  it('clicking active tab also calls setActiveTab', async () => {
    const user = userEvent.setup()
    render(<PanelTabBar node={makeLeaf({ activeTab: 0 })} />)

    await user.click(screen.getByText('Agents'))

    expect(mockSetActiveTab).toHaveBeenCalledWith('panel-1', 0)
  })

  it('shows close button when not the only panel', () => {
    // mockRoot.type = 'split' so isOnlyPanel is false
    render(<PanelTabBar node={makeLeaf()} />)
    const closeButtons = screen.getAllByRole('button')
    expect(closeButtons.length).toBeGreaterThanOrEqual(1)
    expect(closeButtons[0]).toHaveAttribute('aria-label', 'Close Agents')
  })

  it('hides close button when this is the only panel with a single tab', () => {
    // Make it look like the only leaf panel with 1 tab
    mockRoot = { type: 'leaf', panelId: 'panel-1', tabs: [{ viewKey: 'agents', label: 'Agents' }] }
    const node = makeLeaf({ tabs: [{ viewKey: 'agents', label: 'Agents' }] })
    render(<PanelTabBar node={node} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('clicking close button calls closeTab with correct args', async () => {
    const user = userEvent.setup()
    render(<PanelTabBar node={makeLeaf()} />)

    const closeButtons = screen.getAllByRole('button')
    await user.click(closeButtons[0]) // Close Agents

    expect(mockCloseTab).toHaveBeenCalledWith('panel-1', 0)
  })

  it('clicking close button does not trigger tab click (stopPropagation)', async () => {
    const user = userEvent.setup()
    render(<PanelTabBar node={makeLeaf()} />)

    const closeButtons = screen.getAllByRole('button')
    await user.click(closeButtons[0])

    // setActiveTab should NOT be called for the tab itself (only closeTab)
    expect(mockSetActiveTab).not.toHaveBeenCalled()
  })

  it('sets drag data on dragStart', () => {
    render(<PanelTabBar node={makeLeaf()} />)

    const tabDivs = screen.getByText('Agents').closest('div[draggable]')!
    const mockDataTransfer = {
      effectAllowed: '',
      data: {} as Record<string, string>,
      setData(type: string, value: string) { this.data[type] = value },
    }

    const dragEvent = new MouseEvent('dragstart', { bubbles: true }) as unknown as React.DragEvent
    Object.defineProperty(dragEvent, 'dataTransfer', { value: mockDataTransfer })
    tabDivs.dispatchEvent(dragEvent as unknown as Event)

    expect(mockDataTransfer.data['application/bde-panel']).toBeDefined()
    const payload = JSON.parse(mockDataTransfer.data['application/bde-panel'])
    expect(payload).toMatchObject({
      viewKey: 'agents',
      sourcePanelId: 'panel-1',
      sourceTabIndex: 0,
    })
    expect(mockDataTransfer.data['text/plain']).toBe('Agents')
  })

  it('renders single tab without close button in only-panel case', () => {
    const singleTab = { viewKey: 'agents' as const, label: 'Agents' }
    mockRoot = { type: 'leaf' }
    const node: PanelLeafNode = {
      type: 'leaf',
      panelId: 'panel-1',
      tabs: [singleTab],
      activeTab: 0,
    }
    render(<PanelTabBar node={node} />)
    expect(screen.getByText('Agents')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
