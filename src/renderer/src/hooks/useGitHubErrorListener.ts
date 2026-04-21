import { useEffect } from 'react'
import { toast } from '../stores/toasts'
import { openSettings } from '../components/settings/settings-nav'
import type { GitHubErrorKind } from '../../../shared/types/github-errors'

interface GitHubErrorPayload {
  kind: GitHubErrorKind
  message: string
  status?: number | undefined
}

const BILLING_SETTINGS_URL = 'https://github.com/settings/billing'

/**
 * Listens for `github:error` IPC events from the main process and
 * surfaces appropriate toasts per error kind.
 *
 * This is the single listener for every GitHub failure classification.
 * Both `githubFetch` (rate-limit warnings, 401 token-expired) and
 * `githubFetchJson` (everything else) route through the same
 * `broadcastGitHubError` path with a structured `GitHubError` payload,
 * so this hook handles all kinds uniformly.
 *
 * `not-found` is intentionally not broadcast from the main process at
 * all (it's often valid missing-resource state), so it never reaches
 * this handler.
 */
export function useGitHubErrorListener(): void {
  useEffect(() => {
    const unsub = window.api.pr.onGitHubError((payload: GitHubErrorPayload) => {
      switch (payload.kind) {
        case 'billing':
          // Persistent, actionable: the user needs to actually go fix billing.
          toast.info(
            `GitHub Actions disabled by billing or spending limit. Code is still verified locally by the pre-push hook — CI is just a safety net.`,
            {
              action: 'Open billing settings',
              onAction: () => {
                void window.api.window.openExternal(BILLING_SETTINGS_URL)
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

        case 'rate-limit':
          // The main process pre-formats the message with remaining/limit
          // and a UTC reset time, so we display it as-is.
          toast.info(payload.message, { durationMs: 8_000 })
          break

        case 'token-expired':
          toast.error(payload.message, 12_000)
          break

        case 'unknown':
          toast.error(`GitHub API error: ${payload.message}`, 6_000)
          break

        // Never broadcast from main — 404 is often valid missing-resource state.
        case 'not-found':
          break
      }
    })
    return unsub
  }, [])
}
