import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { CircuitPipeline, type CircuitNode } from '../CircuitPipeline'

const mockNodes: CircuitNode[] = [
  { id: 'queued', label: 'Queued', count: 5, accent: 'orange', active: false },
  { id: 'active', label: 'Active', count: 3, accent: 'cyan', active: true },
  { id: 'review', label: 'Review', count: 2, accent: 'blue', active: false },
  { id: 'done', label: 'Done', count: 12, accent: 'purple', active: false }
]

describe('CircuitPipeline', () => {
  it('renders all nodes with labels and counts', () => {
    render(<CircuitPipeline nodes={mockNodes} />)

    expect(screen.getByText('Queued')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()

    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()

    expect(screen.getByText('Review')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()

    expect(screen.getByText('Done')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
  })

  it('renders circuit nodes', () => {
    const { container } = render(<CircuitPipeline nodes={mockNodes} />)
    const nodes = container.querySelectorAll('[data-role="circuit-node"]')
    expect(nodes).toHaveLength(4)
  })

  it('renders connecting traces between nodes', () => {
    const { container } = render(<CircuitPipeline nodes={mockNodes} />)
    const traces = container.querySelectorAll('[data-role="circuit-trace"]')
    // Should have n-1 traces for n nodes
    expect(traces).toHaveLength(3)
  })

  it('marks active nodes with data attribute', () => {
    const { container } = render(<CircuitPipeline nodes={mockNodes} />)
    const activeNodes = container.querySelectorAll('[data-active]')
    expect(activeNodes).toHaveLength(1)
  })

  it('renders with vertical orientation', () => {
    const { container } = render(<CircuitPipeline nodes={mockNodes} orientation="vertical" />)
    const pipeline = container.querySelector('.circuit-pipeline')
    expect(pipeline).toHaveAttribute('data-orientation', 'vertical')
  })

  it('renders with horizontal orientation by default', () => {
    const { container } = render(<CircuitPipeline nodes={mockNodes} />)
    const pipeline = container.querySelector('.circuit-pipeline')
    expect(pipeline).toHaveAttribute('data-orientation', 'horizontal')
  })

  it('renders animated current pulses when animated is true', () => {
    const { container } = render(<CircuitPipeline nodes={mockNodes} animated={true} />)
    const pulses = container.querySelectorAll('[data-role="current-pulse"]')
    expect(pulses.length).toBeGreaterThan(0)
  })

  it('does not render current pulses when animated is false', () => {
    const { container } = render(<CircuitPipeline nodes={mockNodes} animated={false} />)
    const pulses = container.querySelectorAll('[data-role="current-pulse"]')
    expect(pulses).toHaveLength(0)
  })

  it('renders with custom className', () => {
    const { container } = render(<CircuitPipeline nodes={mockNodes} className="custom-class" />)
    const pipeline = container.querySelector('.circuit-pipeline')
    expect(pipeline).toHaveClass('custom-class')
  })

  it('renders node icons when provided', () => {
    const nodesWithIcons: CircuitNode[] = [
      { id: '1', label: 'Stage 1', count: 1, accent: 'cyan', icon: '🚀' },
      { id: '2', label: 'Stage 2', count: 2, accent: 'pink', icon: '⚡' }
    ]
    render(<CircuitPipeline nodes={nodesWithIcons} />)
    expect(screen.getByText('🚀')).toBeInTheDocument()
    expect(screen.getByText('⚡')).toBeInTheDocument()
  })

  it('handles empty nodes array', () => {
    const { container } = render(<CircuitPipeline nodes={[]} />)
    const nodes = container.querySelectorAll('[data-role="circuit-node"]')
    expect(nodes).toHaveLength(0)
  })

  it('handles single node without traces', () => {
    const singleNode: CircuitNode[] = [{ id: 'solo', label: 'Solo', count: 1, accent: 'purple' }]
    const { container } = render(<CircuitPipeline nodes={singleNode} />)
    const nodes = container.querySelectorAll('[data-role="circuit-node"]')
    const traces = container.querySelectorAll('[data-role="circuit-trace"]')
    expect(nodes).toHaveLength(1)
    expect(traces).toHaveLength(0)
  })

  it('applies compact styling when compact prop is true', () => {
    const { container } = render(<CircuitPipeline nodes={mockNodes} compact={true} />)
    const pipeline = container.querySelector('.circuit-pipeline')
    expect(pipeline).toBeInTheDocument()
    // Compact mode should still render all nodes
    const nodes = container.querySelectorAll('[data-role="circuit-node"]')
    expect(nodes).toHaveLength(4)
  })
})
