import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'
import { _resetIdCounter, createLeaf, splitNode } from '../../../stores/panelLayout'
import { PanelRenderer } from '../PanelRenderer'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('react-resizable-panels', () => ({
  Group: ({ children }: { children: React.ReactNode }) => <div data-testid="panel-group">{children}</div>,
  Panel: ({ children }: { children: React.ReactNode }) => <div data-testid="panel">{children}</div>,
  Separator: () => <div data-testid="resize-handle" />,
}))

vi.mock('../../../views/AgentsView', () => ({ AgentsView: () => <div>Agents</div> }))
vi.mock('../../../views/TerminalView', () => ({ TerminalView: () => <div>Terminal</div> }))
vi.mock('../../../views/SprintView', () => ({ default: () => <div>Sprint</div> }))
vi.mock('../../../views/MemoryView', () => ({ default: () => <div>Memory</div> }))
vi.mock('../../../views/CostView', () => ({ default: () => <div>Cost</div> }))
vi.mock('../../../views/SettingsView', () => ({ default: () => <div>Settings</div> }))
vi.mock('../../../views/PRStationView', () => ({ default: () => <div>PRStation</div> }))

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PanelRenderer', () => {
  beforeEach(() => {
    _resetIdCounter()
  })

  it('renders a single leaf node', () => {
    const leaf = createLeaf('agents')
    render(<PanelRenderer node={leaf} />)
    expect(screen.getByText('Agents')).toBeTruthy()
  })

  it('renders a horizontal split with two leaves', () => {
    const leaf = createLeaf('agents')
    const splitRoot = splitNode(leaf, leaf.panelId, 'horizontal', 'terminal')
    if (splitRoot === null) throw new Error('splitNode returned null')

    render(<PanelRenderer node={splitRoot} />)

    expect(screen.getByText('Agents')).toBeTruthy()
    expect(screen.getByText('Terminal')).toBeTruthy()
    expect(screen.getByTestId('panel-group')).toBeTruthy()
    expect(screen.getAllByTestId('panel')).toHaveLength(2)
  })

  it('renders a nested three-panel layout', async () => {
    const leaf = createLeaf('agents')
    const splitRoot = splitNode(leaf, leaf.panelId, 'horizontal', 'terminal')
    if (splitRoot === null) throw new Error('splitNode returned null')

    // splitRoot is now: split(agents, terminal)
    // split the terminal leaf vertically to get: split(agents, split(terminal, sprint))
    if (splitRoot.type !== 'split') throw new Error('expected split node')
    const terminalLeaf = splitRoot.children[1]
    if (terminalLeaf.type !== 'leaf') throw new Error('expected leaf')

    const nestedRoot = splitNode(splitRoot, terminalLeaf.panelId, 'vertical', 'sprint')
    if (nestedRoot === null) throw new Error('splitNode returned null')

    render(<PanelRenderer node={nestedRoot} />)

    expect(screen.getByText('Agents')).toBeTruthy()
    expect(screen.getByText('Terminal')).toBeTruthy()
    // Sprint is lazy-loaded, wait for it to resolve
    expect(await screen.findByText('Sprint')).toBeTruthy()

    // Two PanelGroup elements: the outer horizontal split and the inner vertical split
    expect(screen.getAllByTestId('panel-group')).toHaveLength(2)
    // Four Panel elements total: outer (2) + inner (2)
    expect(screen.getAllByTestId('panel')).toHaveLength(4)
    // Two resize handles
    expect(screen.getAllByTestId('resize-handle')).toHaveLength(2)
  })
})
