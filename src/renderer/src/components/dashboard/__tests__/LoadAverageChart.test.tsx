import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LoadAverageChart } from '../LoadAverageChart'

interface LoadSample {
  t: number
  load1: number
  load5: number
  load15: number
}

function makeSamples(vals: [number, number, number][]): LoadSample[] {
  return vals.map(([a, b, c], i) => ({ t: 1000 + i * 5000, load1: a, load5: b, load15: c }))
}

describe('LoadAverageChart', () => {
  it('shows empty state with < 2 samples', () => {
    render(<LoadAverageChart samples={makeSamples([[1, 1, 1]])} cpuCount={8} />)
    expect(screen.getByText(/Collecting samples/i)).toBeInTheDocument()
  })

  it('big number has green class when load1 < cpuCount', () => {
    const { container } = render(
      <LoadAverageChart
        samples={makeSamples([
          [1, 1, 1],
          [3, 2, 1]
        ])}
        cpuCount={8}
      />
    )
    const el = container.querySelector('[data-testid="load-value"]')
    expect(el).toBeTruthy()
    expect(el?.className).toMatch(/green|healthy/)
  })

  it('big number has amber class when cpuCount <= load1 < 2×cpuCount', () => {
    const { container } = render(
      <LoadAverageChart
        samples={makeSamples([
          [1, 1, 1],
          [10, 2, 1]
        ])}
        cpuCount={8}
      />
    )
    const el = container.querySelector('[data-testid="load-value"]')
    expect(el?.className).toMatch(/amber|warn/)
  })

  it('big number has red class when load1 >= 2×cpuCount', () => {
    const { container } = render(
      <LoadAverageChart
        samples={makeSamples([
          [1, 1, 1],
          [20, 2, 1]
        ])}
        cpuCount={8}
      />
    )
    const el = container.querySelector('[data-testid="load-value"]')
    expect(el?.className).toMatch(/red|critical/)
  })

  it('trend shows cooling when load1 < load5', () => {
    render(
      <LoadAverageChart
        samples={makeSamples([
          [1, 1, 1],
          [5, 10, 15]
        ])}
        cpuCount={8}
      />
    )
    expect(screen.getByText(/cooling/i)).toBeInTheDocument()
  })

  it('trend shows climbing when load1 > load5 × 1.05', () => {
    render(
      <LoadAverageChart
        samples={makeSamples([
          [1, 1, 1],
          [15, 10, 5]
        ])}
        cpuCount={8}
      />
    )
    expect(screen.getByText(/climbing/i)).toBeInTheDocument()
  })

  it('trend shows steady otherwise', () => {
    render(
      <LoadAverageChart
        samples={makeSamples([
          [1, 1, 1],
          [10.2, 10, 10]
        ])}
        cpuCount={8}
      />
    )
    expect(screen.getByText(/steady/i)).toBeInTheDocument()
  })

  it('renders three line paths + saturation reference line', () => {
    const { container } = render(
      <LoadAverageChart
        samples={makeSamples([
          [1, 2, 3],
          [4, 5, 6],
          [7, 8, 9]
        ])}
        cpuCount={8}
      />
    )
    expect(container.querySelector('[data-role="line-1min"]')).toBeTruthy()
    expect(container.querySelector('[data-role="line-5min"]')).toBeTruthy()
    expect(container.querySelector('[data-role="line-15min"]')).toBeTruthy()
    expect(container.querySelector('[data-role="saturation-line"]')).toBeTruthy()
  })

  it('Y-axis yMax respects max(cpuCount × 1.5, 4) floor', () => {
    const { container } = render(
      <LoadAverageChart
        samples={makeSamples([
          [1, 1, 1],
          [2, 2, 2]
        ])}
        cpuCount={8}
      />
    )
    const yMax = Number(container.querySelector('[data-testid="y-max-value"]')?.textContent)
    expect(yMax).toBeGreaterThanOrEqual(12) // 8 * 1.5 = 12
  })
})
