/**
 * Structured GitHub API error types, shared across main and renderer.
 *
 * These let consumers react to specific failure modes (billing blocked,
 * rate-limited, offline, token expired) instead of lumping everything
 * into a generic failure sentinel.
 */

export type GitHubErrorKind =
  /** No GitHub token configured in settings */
  | 'no-token'
  /** 401 — token invalid or expired */
  | 'token-expired'
  /** 403 with x-ratelimit-remaining=0 — hit the hourly quota */
  | 'rate-limit'
  /** 403 with body mentioning payment / spending limit — Actions disabled */
  | 'billing'
  /** 403 other — missing scope, repo access denied */
  | 'permission'
  /** 404 — resource not found (deleted repo, wrong owner, etc.) */
  | 'not-found'
  /** 422 — validation failed (bad request body) */
  | 'validation'
  /** 5xx after retries exhausted */
  | 'server'
  /** fetch() threw: DNS failure, ECONNREFUSED, timeout (AbortError), etc. */
  | 'network'
  /** Anything else: unrecognized status, JSON parse failure, etc. */
  | 'unknown'

export interface GitHubError {
  kind: GitHubErrorKind
  /** HTTP status code, if applicable */
  status?: number
  /** Human-readable description suitable for user-facing toasts */
  message: string
  /** Whether a retry might succeed without user intervention */
  retryable: boolean
}

/** Discriminated-union result wrapper. Use instead of throwing. */
export type GitHubResult<T> = { ok: true; data: T } | { ok: false; error: GitHubError }
