import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'
import { _resetIdCounter, createLeaf, splitNode } from '../../../stores/panelLayout'
import { PanelRenderer } from '../PanelRenderer'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('react-resizable-panels', () => ({
  Group: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="panel-group">{children}</div>
  ),
  Panel: ({ children }: { children: React.ReactNode }) => <div data-testid="panel">{children}</div>,
  Separator: () => <div data-testid="resize-handle" />
}))

vi.mock('../../../lib/view-resolver', () => ({
  resolveView: (viewKey: string) => {
    const labels: Record<string, string> = {
      agents: 'Agents',
      ide: 'IDE',
      sprint: 'Sprint',
      settings: 'Settings',
      'pr-station': 'PRStation',
      dashboard: 'Dashboard',
      'task-workbench': 'TaskWorkbench',
      git: 'Git'
    }
    return <div>{labels[viewKey] ?? viewKey}</div>
  }
}))

vi.mock('../../../views/AgentsView', () => ({ AgentsView: () => <div>Agents</div> }))
vi.mock('../../../views/TerminalView', () => ({ TerminalView: () => <div>IDE</div> }))
vi.mock('../../../views/SprintView', () => ({ default: () => <div>Sprint</div> }))
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
    // "Agents" appears in both tab bar label and view content
    expect(screen.getAllByText('Agents').length).toBeGreaterThanOrEqual(1)
  })

  it('renders a horizontal split with two leaves', () => {
    const leaf = createLeaf('agents')
    const splitRoot = splitNode(leaf, leaf.panelId, 'horizontal', 'ide')
    if (splitRoot === null) throw new Error('splitNode returned null')

    render(<PanelRenderer node={splitRoot} />)

    expect(screen.getAllByText('Agents').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('IDE').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByTestId('panel-group')).toBeTruthy()
    expect(screen.getAllByTestId('panel')).toHaveLength(2)
  })

  it('renders a nested three-panel layout', async () => {
    const leaf = createLeaf('agents')
    const splitRoot = splitNode(leaf, leaf.panelId, 'horizontal', 'ide')
    if (splitRoot === null) throw new Error('splitNode returned null')

    if (splitRoot.type !== 'split') throw new Error('expected split node')
    const ideLeaf = splitRoot.children[1]
    if (ideLeaf.type !== 'leaf') throw new Error('expected leaf')

    const nestedRoot = splitNode(splitRoot, ideLeaf.panelId, 'vertical', 'sprint')
    if (nestedRoot === null) throw new Error('splitNode returned null')

    render(<PanelRenderer node={nestedRoot} />)

    expect(screen.getAllByText('Agents').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('IDE').length).toBeGreaterThanOrEqual(1)
    expect(await screen.findByText('Sprint')).toBeTruthy()

    expect(screen.getAllByTestId('panel-group')).toHaveLength(2)
    expect(screen.getAllByTestId('panel')).toHaveLength(4)
    expect(screen.getAllByTestId('resize-handle')).toHaveLength(2)
  })
})
