/**
 * Rate-limit-aware GitHub API fetch wrapper.
 *
 * Centralises three concerns that every GitHub REST call shares:
 *  (a) X-RateLimit-Remaining header inspection
 *  (b) Retry-After handling on 403 rate-limit responses
 *  (c) Exponential backoff with jitter for transient errors
 *  (d) User notification when the remaining quota drops below a threshold
 *
 * All main-process code that hits api.github.com should call `githubFetch`
 * instead of the bare `fetch`.
 */

import { broadcast } from './broadcast'
import { createLogger } from './logger'

const logger = createLogger('github-fetch')

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_RETRIES = 3
const BASE_BACKOFF_MS = 1_000
const MAX_BACKOFF_MS = 30_000
const DEFAULT_TIMEOUT_MS = 30_000

/** Warn the user when fewer than this many requests remain. */
const RATE_LIMIT_WARNING_THRESHOLD = 100

// ---------------------------------------------------------------------------
// Rate-limit state (module-level singleton)
// ---------------------------------------------------------------------------

interface RateLimitState {
  remaining: number | null
  limit: number | null
  resetEpoch: number | null
  warningEmitted: boolean
}

const state: RateLimitState = {
  remaining: null,
  limit: null,
  resetEpoch: null,
  warningEmitted: false
}

// ---------------------------------------------------------------------------
// Header parsing
// ---------------------------------------------------------------------------

interface RateLimitHeaders {
  remaining: number | null
  limit: number | null
  resetEpoch: number | null
  retryAfterMs: number | null
}

export function parseRateLimitHeaders(headers: Headers): RateLimitHeaders {
  const remaining = headers.get('x-ratelimit-remaining')
  const limit = headers.get('x-ratelimit-limit')
  const reset = headers.get('x-ratelimit-reset')
  const retryAfter = headers.get('retry-after')

  return {
    remaining: remaining !== null ? parseInt(remaining, 10) : null,
    limit: limit !== null ? parseInt(limit, 10) : null,
    resetEpoch: reset !== null ? parseInt(reset, 10) : null,
    retryAfterMs: retryAfter !== null ? parseInt(retryAfter, 10) * 1_000 : null
  }
}

// ---------------------------------------------------------------------------
// State management
// ---------------------------------------------------------------------------

function updateRateLimitState(rl: RateLimitHeaders): void {
  if (rl.remaining !== null) state.remaining = rl.remaining
  if (rl.limit !== null) state.limit = rl.limit
  if (rl.resetEpoch !== null) state.resetEpoch = rl.resetEpoch

  // Allow re-emitting once quota recovers
  if (state.remaining !== null && state.remaining > RATE_LIMIT_WARNING_THRESHOLD) {
    state.warningEmitted = false
  }
}

// ---------------------------------------------------------------------------
// User notification (main → renderer IPC push)
// ---------------------------------------------------------------------------

function broadcastRateLimitWarning(remaining: number, limit: number, resetEpoch: number): void {
  broadcast('github:rateLimitWarning', { remaining, limit, resetEpoch })
}

let tokenExpiredEmitted = false

function broadcastTokenExpired(): void {
  if (tokenExpiredEmitted) return
  tokenExpiredEmitted = true
  broadcast('github:tokenExpired', {})
}

function checkRateLimitThreshold(): void {
  const { remaining, limit, resetEpoch, warningEmitted } = state
  if (remaining === null || limit === null || resetEpoch === null) return
  if (remaining > RATE_LIMIT_WARNING_THRESHOLD) return
  if (warningEmitted) return

  state.warningEmitted = true
  logger.warn(
    `Rate limit low: ${remaining}/${limit} remaining. Resets at ${new Date(resetEpoch * 1_000).toISOString()}`
  )
  broadcastRateLimitWarning(remaining, limit, resetEpoch)
}

// ---------------------------------------------------------------------------
// Retry helpers
// ---------------------------------------------------------------------------

function isRateLimitExhausted(status: number, remaining: number | null): boolean {
  return status === 403 && remaining !== null && remaining <= 0
}

export function computeBackoffMs(attempt: number): number {
  const exponential = BASE_BACKOFF_MS * Math.pow(2, attempt)
  const jitter = Math.random() * BASE_BACKOFF_MS
  return Math.min(exponential + jitter, MAX_BACKOFF_MS)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isRetryableServerError(status: number): boolean {
  return status >= 500 && status < 600
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface GithubFetchOptions {
  method?: string
  headers?: Record<string, string>
  body?: string | null
  timeoutMs?: number
}

/**
 * Drop-in replacement for `fetch()` targeting api.github.com.
 *
 * Automatically inspects rate-limit headers, retries on 403 rate-limit
 * exhaustion (honouring Retry-After) or 5xx errors with exponential
 * backoff, and broadcasts a warning to the renderer when the remaining
 * quota is low.
 */
export async function githubFetch(url: string, options?: GithubFetchOptions): Promise<Response> {
  const { method, headers, body, timeoutMs = DEFAULT_TIMEOUT_MS } = options ?? {}

  let lastResponse!: Response

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    lastResponse = await fetch(url, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(timeoutMs)
    })

    const rl = parseRateLimitHeaders(lastResponse.headers)
    updateRateLimitState(rl)
    checkRateLimitThreshold()

    // --- 401 Unauthorized → token expired or invalid, fail fast (no retry) ---
    if (lastResponse.status === 401) {
      logger.error('401 Unauthorized — GitHub token is invalid or expired')
      broadcastTokenExpired()
      return lastResponse
    }

    // --- (b) 403 rate-limit → honour Retry-After or fall back to backoff ---
    if (isRateLimitExhausted(lastResponse.status, rl.remaining) && attempt < MAX_RETRIES) {
      const waitMs = rl.retryAfterMs ?? computeBackoffMs(attempt)
      logger.warn(
        `Rate limited (${rl.remaining} remaining). Retrying in ${waitMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})`
      )
      await sleep(waitMs)
      continue
    }

    // --- (c) 5xx server errors → exponential backoff ---
    if (isRetryableServerError(lastResponse.status) && attempt < MAX_RETRIES) {
      const waitMs = computeBackoffMs(attempt)
      logger.warn(
        `Server error ${lastResponse.status}. Retrying in ${waitMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})`
      )
      await sleep(waitMs)
      continue
    }

    return lastResponse
  }

  // All retries exhausted — return the last response so the caller can inspect its status
  return lastResponse
}

/** Snapshot of current rate-limit bookkeeping (useful for diagnostics). */
export function getRateLimitState(): {
  remaining: number | null
  limit: number | null
  resetEpoch: number | null
} {
  return {
    remaining: state.remaining,
    limit: state.limit,
    resetEpoch: state.resetEpoch
  }
}

/** Reset module state — only for tests. */
export function _resetRateLimitState(): void {
  state.remaining = null
  state.limit = null
  state.resetEpoch = null
  state.warningEmitted = false
  tokenExpiredEmitted = false
}

// ---------------------------------------------------------------------------
// Pagination helpers
// ---------------------------------------------------------------------------

/** Extract the "next" URL from a GitHub `Link` header. */
export function parseNextLink(linkHeader: string | null): string | null {
  if (!linkHeader) return null
  const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/)
  return match ? match[1] : null
}

interface FetchAllPagesOptions {
  token: string
  timeoutMs?: number
  headers?: Record<string, string>
}

/**
 * Fetch every page of a GitHub REST API list endpoint.
 * Follows `rel="next"` Link headers until exhausted.
 * Returns [] (not throw) on any HTTP error so callers degrade gracefully.
 */
export async function fetchAllGitHubPages<T>(
  url: string,
  opts: FetchAllPagesOptions
): Promise<T[]> {
  const items: T[] = []
  let nextUrl: string | null = url

  while (nextUrl) {
    const res = await githubFetch(nextUrl, {
      headers: {
        Authorization: `Bearer ${opts.token}`,
        Accept: 'application/vnd.github+json',
        ...opts.headers
      },
      timeoutMs: opts.timeoutMs
    })

    if (!res.ok) return items

    const data = (await res.json()) as T[]
    items.push(...data)
    nextUrl = parseNextLink(res.headers.get('Link'))
  }

  return items
}
