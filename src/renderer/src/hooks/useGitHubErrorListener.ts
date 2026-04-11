import { useEffect } from 'react'
import { toast } from '../stores/toasts'
import { openSettings } from '../components/settings/settings-nav'
import type { GitHubErrorKind } from '../../../shared/types/github-errors'

interface GitHubErrorPayload {
  kind: GitHubErrorKind
  message: string
  status?: number
}

const BILLING_SETTINGS_URL = 'https://github.com/settings/billing'

/**
 * Listens for `github:error` IPC events from the main process and
 * surfaces appropriate toasts per error kind.
 *
 * This is a separate hook from `useGitHubRateLimitWarning` — that one
 * still handles the legacy `github:rateLimitWarning` and
 * `github:tokenExpired` channels which fire from inside `githubFetch`
 * itself. `github:error` is the newer channel fired from
 * `githubFetchJson`, which classifies every failure into a structured
 * `GitHubError` with a `kind` field.
 *
 * To avoid double-toasting, this hook skips `rate-limit` and
 * `token-expired` kinds — they're already covered by the legacy hook.
 */
export function useGitHubErrorListener(): void {
  useEffect(() => {
    const unsub = window.api.onGitHubError((payload: GitHubErrorPayload) => {
      switch (payload.kind) {
        case 'billing':
          // Persistent, actionable: the user needs to actually go fix billing.
          toast.info(
            `GitHub Actions disabled by billing or spending limit. Code is still verified locally by the pre-push hook — CI is just a safety net.`,
            {
              action: 'Open billing settings',
              onAction: () => {
                void window.api.openExternal(BILLING_SETTINGS_URL)
              },
              durationMs: 30_000
            }
          )
          break

        case 'no-token':
          toast.info(
            `No GitHub token configured. PR status and check runs won't work until you set one in Settings → Connections.`,
            {
              action: 'Open Settings',
              onAction: () => openSettings('connections'),
              durationMs: 12_000
            }
          )
          break

        case 'network':
          toast.error('GitHub is unreachable — retrying in the background', 5_000)
          break

        case 'permission':
          toast.error(
            `GitHub API forbidden: ${payload.message}. Check your token scope in Settings → Connections.`,
            10_000
          )
          break

        case 'server':
          toast.error(
            `GitHub server error${payload.status ? ` (${payload.status})` : ''} — retrying`,
            6_000
          )
          break

        case 'validation':
          toast.error(`GitHub API validation failed: ${payload.message}`, 8_000)
          break

        case 'unknown':
          toast.error(`GitHub API error: ${payload.message}`, 6_000)
          break

        // Handled by the legacy useGitHubRateLimitWarning hook to avoid
        // duplicate toasts. `not-found` is not broadcast from the main
        // process at all (it's often valid missing-resource state).
        case 'rate-limit':
        case 'token-expired':
        case 'not-found':
          break
      }
    })
    return unsub
  }, [])
}
