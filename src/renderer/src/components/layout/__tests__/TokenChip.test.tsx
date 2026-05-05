import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const mockState = { totalTokens: 0 }

vi.mock('../../../stores/costData', () => ({
  useCostDataStore: vi.fn((selector?: (s: { totalTokens: number }) => unknown) =>
    selector ? selector(mockState) : mockState
  )
}))

import { TokenChip } from '../TokenChip'

describe('TokenChip', () => {
  it('renders 0 when no tokens have been spent', () => {
    mockState.totalTokens = 0
    render(<TokenChip />)
    expect(screen.getByText('0')).toBeInTheDocument()
  })

  it('renders compact K format for thousand-scale token counts', () => {
    mockState.totalTokens = 1000
    render(<TokenChip />)
    expect(screen.getByText(/1\.0K/)).toBeInTheDocument()
  })

  it('renders the tok eyebrow label alongside the count', () => {
    mockState.totalTokens = 250
    render(<TokenChip />)
    expect(screen.getByText('tok')).toBeInTheDocument()
  })

  it('exposes a stable test id for downstream selection', () => {
    mockState.totalTokens = 0
    render(<TokenChip />)
    expect(screen.getByTestId('token-chip')).toBeInTheDocument()
  })
})
