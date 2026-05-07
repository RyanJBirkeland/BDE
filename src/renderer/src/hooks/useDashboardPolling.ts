import { useCallback, useEffect } from 'react'
import { useDashboardDataStore } from '../stores/dashboardData'
import { useBackoffInterval } from './useBackoffInterval'
import { POLL_DASHBOARD_INTERVAL, POLL_LOAD_AVERAGE } from '../lib/constants'

export function useDashboardPolling(): void {
  const fetchAll = useDashboardDataStore((s) => s.fetchAll)
  const fetchLoad = useDashboardDataStore((s) => s.fetchLoad)

  const fetchLoadIfVisible = useCallback(async () => {
    if (document.hidden) return
    await fetchLoad()
  }, [fetchLoad])

  useEffect(() => {
    fetchAll()
  }, [fetchAll])

  useBackoffInterval(fetchAll, POLL_DASHBOARD_INTERVAL)

  useEffect(() => {
    if (document.hidden) return
    fetchLoad()
  }, [fetchLoad])

  useBackoffInterval(fetchLoadIfVisible, POLL_LOAD_AVERAGE)

  useEffect(() => {
    return window.api.sprint.onExternalChange(() => {
      fetchAll()
    })
  }, [fetchAll])
}
