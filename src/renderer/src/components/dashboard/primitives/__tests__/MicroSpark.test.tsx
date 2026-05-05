import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'

vi.mock('framer-motion', () => ({
  useReducedMotion: () => false
}))

import { MicroSpark } from '../MicroSpark'

describe('MicroSpark', () => {
  it('renders a fallback div with no path when given zero data points', () => {
    const { container } = render(<MicroSpark accent="done" points={[]} />)
    expect(container.querySelector('path')).toBeNull()
    expect(container.querySelector('polyline')).toBeNull()
  })

  it('renders a fallback div with no path when given a single data point', () => {
    const { container } = render(<MicroSpark accent="done" points={[42]} />)
    expect(container.querySelector('path')).toBeNull()
    expect(container.querySelector('polyline')).toBeNull()
  })

  it('renders without NaN attributes when all points are equal', () => {
    const { container } = render(<MicroSpark accent="done" points={[10, 10, 10, 10]} />)
    const path = container.querySelector('path')
    expect(path).not.toBeNull()
    const d = path?.getAttribute('d') ?? ''
    expect(d).not.toContain('NaN')
  })

  it('renders an SVG path element with five points of normal data', () => {
    const { container } = render(<MicroSpark accent="done" points={[1, 2, 3, 4, 5]} />)
    expect(container.querySelector('svg')).not.toBeNull()
    expect(container.querySelector('path')).not.toBeNull()
  })
})
