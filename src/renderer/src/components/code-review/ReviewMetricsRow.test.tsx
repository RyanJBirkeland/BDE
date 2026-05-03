import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ReviewMetricsRow } from './ReviewMetricsRow'

describe('ReviewMetricsRow', () => {
  it('renders all three metrics with accessible labels', () => {
    render(<ReviewMetricsRow qualityScore={92} issuesCount={3} filesCount={8} />)
    expect(screen.getByLabelText(/quality score 92/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/3 issues found/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/8 files changed/i)).toBeInTheDocument()
  })

  it('renders loading placeholders when metrics are undefined', () => {
    render(<ReviewMetricsRow loading />)
    const placeholders = screen.getAllByText('—')
    expect(placeholders.length).toBe(3)
  })

  describe('quality score rubric', () => {
    it('shows threshold guidance in the quality card title for a low score', () => {
      render(<ReviewMetricsRow qualityScore={42} issuesCount={3} filesCount={5} />)
      const qualityCard = screen.getByLabelText(/quality score 42/i)
      expect(qualityCard.getAttribute('title')).toContain('Significant issues')
    })

    it('shows threshold guidance in the quality card title for a high score', () => {
      render(<ReviewMetricsRow qualityScore={82} issuesCount={0} filesCount={2} />)
      const qualityCard = screen.getByLabelText(/quality score 82/i)
      expect(qualityCard.getAttribute('title')).toContain('Good quality')
    })

    it('shows threshold guidance in the quality card title for a mid-range score', () => {
      render(<ReviewMetricsRow qualityScore={60} issuesCount={2} filesCount={3} />)
      const qualityCard = screen.getByLabelText(/quality score 60/i)
      expect(qualityCard.getAttribute('title')).toContain('Minor issues')
    })

    it('shows no title when qualityScore is undefined', () => {
      render(<ReviewMetricsRow issuesCount={0} filesCount={2} />)
      const qualityCard = screen.getByLabelText(/quality score pending/i)
      expect(qualityCard.getAttribute('title')).toBeFalsy()
    })
  })
})
