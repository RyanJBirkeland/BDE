import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { PollingProvider } from '../PollingProvider'

vi.mock('../../hooks/useSprintPolling', () => ({ useSprintPolling: vi.fn() }))
vi.mock('../../hooks/usePrStatusPolling', () => ({ usePrStatusPolling: vi.fn() }))
vi.mock('../../hooks/useHealthCheck', () => ({ useHealthCheckPolling: vi.fn() }))
vi.mock('../../hooks/useDashboardPolling', () => ({ useDashboardPolling: vi.fn() }))
vi.mock('../../hooks/useGitStatusPolling', () => ({ useGitStatusPolling: vi.fn() }))
vi.mock('../../hooks/useAgentSessionPolling', () => ({ useAgentSessionPolling: vi.fn() }))
vi.mock('../../hooks/useCostPolling', () => ({ useCostPolling: vi.fn() }))

import { useSprintPolling } from '../../hooks/useSprintPolling'
import { usePrStatusPolling } from '../../hooks/usePrStatusPolling'
import { useHealthCheckPolling } from '../../hooks/useHealthCheck'
import { useDashboardPolling } from '../../hooks/useDashboardPolling'
import { useGitStatusPolling } from '../../hooks/useGitStatusPolling'
import { useAgentSessionPolling } from '../../hooks/useAgentSessionPolling'
import { useCostPolling } from '../../hooks/useCostPolling'

describe('PollingProvider', () => {
  it('renders children', () => {
    render(
      <PollingProvider>
        <div data-testid="child">Hello</div>
      </PollingProvider>
    )
    expect(screen.getByTestId('child')).toBeInTheDocument()
    expect(screen.getByText('Hello')).toBeInTheDocument()
  })

  it('calls all 7 polling hooks', () => {
    render(
      <PollingProvider>
        <span>test</span>
      </PollingProvider>
    )
    expect(useSprintPolling).toHaveBeenCalled()
    expect(usePrStatusPolling).toHaveBeenCalled()
    expect(useHealthCheckPolling).toHaveBeenCalled()
    expect(useDashboardPolling).toHaveBeenCalled()
    expect(useGitStatusPolling).toHaveBeenCalled()
    expect(useAgentSessionPolling).toHaveBeenCalled()
    expect(useCostPolling).toHaveBeenCalled()
  })
})
