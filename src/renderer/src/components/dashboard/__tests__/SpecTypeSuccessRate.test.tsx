import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { SpecTypeSuccessRate } from '../SpecTypeSuccessRate'

describe('SpecTypeSuccessRate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(window.api.sprint as unknown as Record<string, unknown>).getSuccessRateBySpecType = vi
      .fn()
      .mockResolvedValue([])
  })

  it('shows empty state when no data', async () => {
    render(<SpecTypeSuccessRate />)
    await waitFor(() => {
      expect(screen.getByText('No completed tasks yet')).toBeInTheDocument()
    })
  })

  it('renders success rate data', async () => {
    ;(window.api.sprint as unknown as Record<string, unknown>).getSuccessRateBySpecType = vi
      .fn()
      .mockResolvedValue([
        { spec_type: 'spec', done: 8, total: 10, success_rate: 0.8 },
        { spec_type: null, done: 3, total: 5, success_rate: 0.6 }
      ])

    render(<SpecTypeSuccessRate />)
    await waitFor(() => {
      expect(screen.getByText('spec')).toBeInTheDocument()
      expect(screen.getByText('8/10 (80%)')).toBeInTheDocument()
      expect(screen.getByText('Unknown')).toBeInTheDocument()
      expect(screen.getByText('3/5 (60%)')).toBeInTheDocument()
    })
  })

  it('renders the title', async () => {
    render(<SpecTypeSuccessRate />)
    expect(screen.getByText('Success Rate by Spec Type')).toBeInTheDocument()
  })
})
