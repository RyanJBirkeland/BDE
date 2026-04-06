import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { FailureBreakdown } from '../FailureBreakdown'

describe('FailureBreakdown', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(window.api.sprint as unknown as Record<string, unknown>).failureBreakdown = vi
      .fn()
      .mockResolvedValue([])
  })

  it('shows No failures when data is empty', async () => {
    render(<FailureBreakdown />)
    await waitFor(() => {
      expect(screen.getByText('No failures')).toBeInTheDocument()
    })
  })

  it('renders failure reasons', async () => {
    ;(window.api.sprint as unknown as Record<string, unknown>).failureBreakdown = vi
      .fn()
      .mockResolvedValue([
        { reason: 'Timeout', count: 5 },
        { reason: 'Compile error', count: 3 }
      ])

    render(<FailureBreakdown />)
    await waitFor(() => {
      expect(screen.getByText('Timeout')).toBeInTheDocument()
      expect(screen.getByText('5')).toBeInTheDocument()
      expect(screen.getByText('Compile error')).toBeInTheDocument()
    })
  })

  it('shows error state', async () => {
    ;(window.api.sprint as unknown as Record<string, unknown>).failureBreakdown = vi
      .fn()
      .mockRejectedValue(new Error('fetch failed'))

    render(<FailureBreakdown />)
    await waitFor(() => {
      expect(screen.getByText('fetch failed')).toBeInTheDocument()
    })
  })
})
