import { useEffect } from 'react'
import { toast } from '../stores/toasts'

/**
 * Listens for `github:rateLimitWarning` and `github:tokenExpired` IPC events
 * from the main process and surfaces toasts so the user can take action.
 */
export function useGitHubRateLimitWarning(): void {
  useEffect(() => {
    const unsubRate = window.api.onGitHubRateLimitWarning(({ remaining, limit, resetEpoch }) => {
      const resetTime = new Date(resetEpoch * 1_000).toLocaleTimeString()
      toast.info(
        `GitHub API rate limit low: ${remaining}/${limit} remaining. Resets at ${resetTime}.`,
        { durationMs: 8_000 }
      )
    })
    const unsubToken = window.api.onGitHubTokenExpired(() => {
      toast.error('GitHub token expired or invalid. Update it in Settings.', 12_000)
    })
    return () => {
      unsubRate()
      unsubToken()
    }
  }, [])
}
