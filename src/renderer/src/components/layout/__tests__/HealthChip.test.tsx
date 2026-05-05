import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { HealthChip } from '../HealthChip'

describe('HealthChip', () => {
  const noop = vi.fn()

  it('does not render the pulse dot when activeCount is zero', () => {
    const { container } = render(
      <HealthChip
        managerState="idle"
        activeCount={0}
        queuedCount={0}
        failedCount={0}
        onClick={noop}
      />
    )
    expect(container.querySelector('.fleet-pulse')).toBeNull()
  })

  it('renders the pulse dot when there are active agents', () => {
    const { container } = render(
      <HealthChip
        managerState="running"
        activeCount={2}
        queuedCount={0}
        failedCount={0}
        onClick={noop}
      />
    )
    expect(container.querySelector('.fleet-pulse')).not.toBeNull()
  })

  it('renders the queued count pill when queuedCount > 0', () => {
    render(
      <HealthChip
        managerState="running"
        activeCount={0}
        queuedCount={3}
        failedCount={0}
        onClick={noop}
      />
    )
    expect(screen.getByText('3q')).toBeInTheDocument()
  })

  it('renders the failed count pill when failedCount > 0', () => {
    render(
      <HealthChip
        managerState="error"
        activeCount={0}
        queuedCount={0}
        failedCount={1}
        onClick={noop}
      />
    )
    expect(screen.getByText('1!')).toBeInTheDocument()
  })

  it('hides queued and failed pills when both counts are zero', () => {
    render(
      <HealthChip
        managerState="idle"
        activeCount={0}
        queuedCount={0}
        failedCount={0}
        onClick={noop}
      />
    )
    expect(screen.queryByText(/q$/)).toBeNull()
    expect(screen.queryByText(/!$/)).toBeNull()
  })
})
