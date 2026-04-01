import { useEffect } from 'react'
import { useDashboardDataStore } from '../stores/dashboardData'
import { useBackoffInterval } from './useBackoffInterval'
import { POLL_DASHBOARD_INTERVAL } from '../lib/constants'

export function useDashboardPolling(): void {
  const fetchAll = useDashboardDataStore((s) => s.fetchAll)

  useEffect(() => {
    fetchAll()
  }, [fetchAll])

  useBackoffInterval(fetchAll, POLL_DASHBOARD_INTERVAL)

  useEffect(() => {
    return window.api.onExternalSprintChange(() => {
      fetchAll()
    })
  }, [fetchAll])
}
