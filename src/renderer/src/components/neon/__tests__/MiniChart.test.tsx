import { render, fireEvent } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { MiniChart, type ChartBar } from '../MiniChart'
import { tokens } from '../../../design-system/tokens'

const data: ChartBar[] = [
  { value: 70, accent: 'cyan' },
  { value: 45, accent: 'pink' },
  { value: 85, accent: 'blue' },
  { value: 30, accent: 'orange' }
]

describe('MiniChart', () => {
  it('renders correct number of data points', () => {
    const { container } = render(<MiniChart data={data} />)
    const points = container.querySelectorAll('[data-role="chart-bar"]')
    expect(points).toHaveLength(4)
  })

  it('renders SVG sparkline path', () => {
    const { container } = render(<MiniChart data={data} />)
    const paths = container.querySelectorAll('path')
    // fill path + line path
    expect(paths.length).toBeGreaterThanOrEqual(2)
  })

  it('renders empty state when no data', () => {
    const { container } = render(<MiniChart data={[]} />)
    expect(container.textContent).toContain('No data')
    const emptyDiv = container.firstElementChild as HTMLElement
    expect(emptyDiv.style.color).toBe(tokens.neon.textDim)
    expect(emptyDiv.style.fontSize).toBe(tokens.size.xs)
  })

  it('uses cyan as default accent when bar has no accent', () => {
    const noAccentData: ChartBar[] = [{ value: 50 }, { value: 30 }]
    const { container } = render(<MiniChart data={noAccentData} />)
    const line = container.querySelector('path:nth-of-type(2)') as SVGPathElement
    expect(line.getAttribute('stroke')).toContain('var(--neon-cyan)')
  })

  it('shows tooltip on hover', () => {
    const labeled: ChartBar[] = [
      { value: 10, label: '2026-03-27T14:00:00' },
      { value: 20, label: '2026-03-27T15:00:00' }
    ]
    const { container } = render(<MiniChart data={labeled} />)
    const hitArea = container.querySelector('[data-role="chart-bar"] circle')!
    fireEvent.mouseEnter(hitArea)
    expect(container.textContent).toContain('10')
  })
})
