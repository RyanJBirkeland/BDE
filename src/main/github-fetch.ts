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
import { getErrorMessage } from '../shared/errors'
import type { GitHubError, GitHubResult } from '../shared/types/github-errors'

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

/**
 * Once-per-session gate for 401 token-expired broadcasts. The user only needs
 * to be told once until they fix the token (or the app restarts); re-toasting
 * on every subsequent 401 would be spammy even with the 60s debounce.
 */
let tokenExpiredEmitted = false

function checkRateLimitThreshold(): void {
  const { remaining, limit, resetEpoch, warningEmitted } = state
  if (remaining === null || limit === null || resetEpoch === null) return
  if (remaining > RATE_LIMIT_WARNING_THRESHOLD) return
  if (warningEmitted) return

  state.warningEmitted = true
  // HH:MM in UTC — locale-agnostic, unambiguous, and cheap to format.
  const resetTime = new Date(resetEpoch * 1_000).toISOString().slice(11, 16)
  logger.warn(`Rate limit low: ${remaining}/${limit} remaining. Resets at ${resetTime} UTC.`)
  broadcastGitHubError({
    kind: 'rate-limit',
    status: 403,
    message: `GitHub API rate limit low: ${remaining}/${limit} remaining. Resets at ${resetTime} UTC.`,
    retryable: true
  })
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
      if (!tokenExpiredEmitted) {
        tokenExpiredEmitted = true
        broadcastGitHubError({
          kind: 'token-expired',
          status: 401,
          message: 'GitHub token is invalid or expired. Update it in Settings.',
          retryable: false
        })
      }
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
  // Also clear the github:error broadcast debounce so each test starts clean.
  // Without this, rate-limit and token-expired broadcasts from earlier tests
  // silently suppress identical broadcasts in later tests via the 60s debounce.
  lastBroadcastAt.clear()
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

// ---------------------------------------------------------------------------
// Structured error classification + typed JSON fetch
// ---------------------------------------------------------------------------

/**
 * Classify an HTTP error Response into a structured `GitHubError`.
 * Uses header/body signals to distinguish rate-limit, billing (Actions
 * disabled), permission (missing scope), not-found, and server errors.
 */
export function classifyHttpError(response: Response, body: string): GitHubError {
  const status = response.status
  if (status === 401) {
    return {
      kind: 'token-expired',
      status,
      message: 'GitHub token is invalid or expired',
      retryable: false
    }
  }
  if (status === 403) {
    const remaining = response.headers.get('x-ratelimit-remaining')
    if (remaining === '0') {
      return {
        kind: 'rate-limit',
        status,
        message: 'GitHub API rate limit exceeded',
        retryable: true
      }
    }
    // Body-text heuristic for Actions-disabled / billing-blocked responses.
    // GitHub returns this when workflow jobs fail to start due to account
    // payment issues or spending-limit cap.
    if (/not started|spending limit|billing|payment has failed|payment/i.test(body)) {
      return {
        kind: 'billing',
        status,
        message: 'GitHub Actions disabled — billing issue or spending limit reached',
        retryable: false
      }
    }
    return {
      kind: 'permission',
      status,
      message: `GitHub API forbidden: ${body.slice(0, 200) || 'no details'}`,
      retryable: false
    }
  }
  if (status === 404) {
    return { kind: 'not-found', status, message: 'Resource not found', retryable: false }
  }
  if (status === 422) {
    return {
      kind: 'validation',
      status,
      message: `Validation failed: ${body.slice(0, 200) || 'no details'}`,
      retryable: false
    }
  }
  if (status >= 500 && status < 600) {
    return { kind: 'server', status, message: `GitHub server error (${status})`, retryable: true }
  }
  return { kind: 'unknown', status, message: `HTTP ${status}`, retryable: false }
}

/**
 * Classify a thrown error from `fetch()` (not an HTTP error — a transport
 * failure) into a structured `GitHubError`. All transport failures collapse
 * to `kind: 'network'` and are retryable.
 */
export function classifyNetworkError(err: unknown): GitHubError {
  const msg = getErrorMessage(err)
  if (err instanceof Error && err.name === 'AbortError') {
    return { kind: 'network', message: 'Request timed out', retryable: true }
  }
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT/.test(msg)) {
    return { kind: 'network', message: `Network error: ${msg}`, retryable: true }
  }
  return { kind: 'network', message: `Network error: ${msg}`, retryable: true }
}

// Debounce error broadcasts so a 60s poll loop doesn't spam identical toasts.
const lastBroadcastAt: Map<string, number> = new Map()
const BROADCAST_DEBOUNCE_MS = 60_000

function broadcastGitHubError(error: GitHubError): void {
  const now = Date.now()
  const last = lastBroadcastAt.get(error.kind) ?? 0
  if (now - last < BROADCAST_DEBOUNCE_MS) return
  lastBroadcastAt.set(error.kind, now)
  broadcast('github:error', { kind: error.kind, message: error.message, status: error.status })
}

/** Reset broadcast debounce state — tests only. */
export function _resetGitHubErrorBroadcasts(): void {
  lastBroadcastAt.clear()
}

/**
 * JSON-flavored `githubFetch`. Handles token absence, network errors,
 * and HTTP errors in a single Result shape. Errors are automatically
 * broadcast (debounced) to the renderer via `github:error` so the UI
 * can surface toasts/banners without every consumer wiring it up.
 *
 * Note: not-found errors are intentionally NOT broadcast — a 404 is
 * often a valid "missing resource" state, not a failure worth alerting.
 */
export async function githubFetchJson<T>(
  url: string,
  token: string | null,
  options?: GithubFetchOptions
): Promise<GitHubResult<T>> {
  if (!token) {
    return {
      ok: false,
      error: {
        kind: 'no-token',
        message: 'No GitHub token configured. Set one in Settings → Connections.',
        retryable: false
      }
    }
  }

  let response: Response
  try {
    response = await githubFetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        ...options?.headers
      }
    })
  } catch (err) {
    const error = classifyNetworkError(err)
    logger.warn(`[githubFetchJson] network error for ${url}: ${error.message}`)
    broadcastGitHubError(error)
    return { ok: false, error }
  }

  if (response.ok) {
    try {
      const data = (await response.json()) as T
      return { ok: true, data }
    } catch (parseErr) {
      const error: GitHubError = {
        kind: 'unknown',
        message: `JSON parse failed: ${getErrorMessage(parseErr)}`,
        retryable: false
      }
      return { ok: false, error }
    }
  }

  const body = await response.text().catch(() => '')
  const error = classifyHttpError(response, body)
  // Don't spam users about missing resources — 404 is often expected state.
  if (error.kind !== 'not-found') {
    broadcastGitHubError(error)
  }
  return { ok: false, error }
}
