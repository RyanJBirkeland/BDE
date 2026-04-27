import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { NeonProgress } from '../NeonProgress'

describe('NeonProgress', () => {
  it('renders with correct width percentage', () => {
    const { container } = render(<NeonProgress value={65} accent="cyan" />)
    const bar = container.querySelector('[data-role="progress-fill"]') as HTMLElement
    expect(bar.style.width).toBe('65%')
  })

  it('renders label when provided', () => {
    render(<NeonProgress value={50} accent="pink" label="Sprint Progress" />)
    expect(screen.getByText('Sprint Progress')).toBeInTheDocument()
  })

  it('clamps value between 0 and 100', () => {
    const { container } = render(<NeonProgress value={150} accent="blue" />)
    const bar = container.querySelector('[data-role="progress-fill"]') as HTMLElement
    expect(bar.style.width).toBe('100%')
  })

  it('uses CSS custom property for track background', () => {
    const { container } = render(<NeonProgress value={50} accent="cyan" />)
    const fill = container.querySelector('[data-role="progress-fill"]') as HTMLElement
    const track = fill.parentElement as HTMLElement
    expect(track.style.background).toBe('var(--fleet-surface)')
  })

  it('uses CSS custom property for label font size', () => {
    const { container } = render(<NeonProgress value={50} accent="cyan" label="Test" />)
    // The label is the first child div of the root div
    const root = container.querySelector('div') as HTMLElement
    const label = root.firstElementChild as HTMLElement
    expect(label.style.fontSize).toBe('var(--fleet-size-xs)')
  })

  it('uses CSS custom property for label margin bottom', () => {
    const { container } = render(<NeonProgress value={50} accent="cyan" label="Test" />)
    const root = container.querySelector('div') as HTMLElement
    const label = root.firstElementChild as HTMLElement
    expect(label.style.marginBottom).toBe('var(--fleet-space-1)')
  })

  it('does not render label element when label is not provided', () => {
    const { container } = render(<NeonProgress value={50} accent="cyan" />)
    const root = container.querySelector('div') as HTMLElement
    // Without label, root has only the track div as first child
    const fill = container.querySelector('[data-role="progress-fill"]') as HTMLElement
    const track = fill.parentElement as HTMLElement
    expect(track.parentElement).toBe(root)
    expect(root.children).toHaveLength(1)
  })
})
