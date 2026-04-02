import React from 'react'
import type { ReactNode } from 'react'
import { useSprintPolling } from '../hooks/useSprintPolling'
import { usePrStatusPolling } from '../hooks/usePrStatusPolling'
import { useHealthCheckPolling } from '../hooks/useHealthCheck'
import { useDashboardPolling } from '../hooks/useDashboardPolling'
import { useGitStatusPolling } from '../hooks/useGitStatusPolling'
import { useAgentSessionPolling } from '../hooks/useAgentSessionPolling'
import { useCostPolling } from '../hooks/useCostPolling'

export function PollingProvider({ children }: { children: ReactNode }): React.JSX.Element {
  useSprintPolling()
  usePrStatusPolling()
  useHealthCheckPolling()
  useDashboardPolling()
  useGitStatusPolling()
  useAgentSessionPolling()
  useCostPolling()

  return <>{children}</>
}
