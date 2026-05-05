import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QualityChip } from '../QualityChip'

describe('QualityChip', () => {
  it('renders nothing when q is null', () => {
    const { container } = render(<QualityChip q={null} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders with the failed color when score is below 75', () => {
    render(<QualityChip q={74} />)
    const chip = screen.getByText('q74')
    expect(chip).toHaveStyle({ color: 'var(--st-failed)' })
  })

  it('renders with the blocked (amber) color at threshold 75', () => {
    render(<QualityChip q={75} />)
    const chip = screen.getByText('q75')
    expect(chip).toHaveStyle({ color: 'var(--st-blocked)' })
  })

  it('renders with the blocked (amber) color at score 89', () => {
    render(<QualityChip q={89} />)
    const chip = screen.getByText('q89')
    expect(chip).toHaveStyle({ color: 'var(--st-blocked)' })
  })

  it('renders with the done (green) color at threshold 90', () => {
    render(<QualityChip q={90} />)
    const chip = screen.getByText('q90')
    expect(chip).toHaveStyle({ color: 'var(--st-done)' })
  })
})
