import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { HealthBar } from '../HealthBar'

describe('HealthBar', () => {
  it('shows connected status when SSE is connected', () => {
    render(<HealthBar connected={true} stats={{ queued: 3, active: 2, doneToday: 14, failed: 0 }} />)
    expect(screen.getByText('Connected')).toBeDefined()
  })

  it('shows not-configured when task runner is absent', () => {
    render(<HealthBar connected={false} stats={null} />)
    expect(screen.getByText(/not configured/i)).toBeDefined()
  })

  it('displays queue stats when provided', () => {
    render(<HealthBar connected={true} stats={{ queued: 5, active: 1, doneToday: 10, failed: 2 }} />)
    expect(screen.getByText(/Queued/)).toBeDefined()
    expect(screen.getByText(/Active/)).toBeDefined()
  })
})
