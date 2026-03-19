import { getGitHubToken } from './config'

const DEFAULT_TIMEOUT_MS = 30_000

export interface AuthenticatedFetchOptions {
  method?: string
  headers?: Record<string, string>
  body?: string
  timeoutMs?: number
}

/**
 * Authenticated GitHub API fetch with automatic 401 retry.
 * On 401, re-reads the token from disk and retries once if it changed,
 * allowing seamless token rotation without app restart.
 */
export async function authenticatedGitHubFetch(
  url: string,
  options?: AuthenticatedFetchOptions
): Promise<Response> {
  const token = getGitHubToken()
  if (!token) throw new Error('GitHub token not configured')

  const doFetch = (authToken: string): Promise<Response> =>
    fetch(url, {
      method: options?.method,
      headers: {
        Accept: 'application/vnd.github+json',
        ...options?.headers,
        Authorization: `Bearer ${authToken}`,
      },
      body: options?.body,
      signal: AbortSignal.timeout(options?.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    })

  const response = await doFetch(token)

  if (response.status === 401) {
    const freshToken = getGitHubToken()
    if (freshToken && freshToken !== token) {
      return doFetch(freshToken)
    }
  }

  return response
}
