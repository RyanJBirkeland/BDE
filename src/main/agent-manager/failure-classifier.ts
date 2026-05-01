import type { FailureReason } from '../../shared/types'
import type { Logger } from '../logger'

export type FailurePattern = {
  /** Machine type used for task failure_reason field. */
  type: FailureReason
  /** Human-readable label logged when this pattern matches. Defaults to `type`. */
  name?: string
  keywords: string[]
}

/**
 * Built-in failure patterns in priority order. The first matching pattern wins.
 * Frozen so callers cannot mutate the default set — pass `additionalPatterns`
 * to `classifyFailureReason` for test overrides or custom extensions.
 */
export const BUILTIN_FAILURE_PATTERNS: readonly FailurePattern[] = Object.freeze([
  {
    type: 'environmental' as FailureReason,
    keywords: [
      'main repo has uncommitted changes',
      'refusing to proceed',
      'is not configured in fleet settings',
      'credential unavailable',
      'no claude subscription token',
      'unable to access https://',
      'unable to access http://',
      'could not resolve host',
      'getaddrinfo enotfound',
      'enetunreach',
      'econnrefused',
      'model not found',
      'failed to connect to ollama',
      'cannot connect to ollama',
      'ollama server',
      'failed to pull model'
    ]
  },
  {
    type: 'auth' as FailureReason,
    keywords: [
      'invalid api key',
      'authentication failed',
      'unauthorized',
      'token expired',
      'invalid token',
      'invalid_api_key',
      'token_expired',
      'invalid_token',
      'authentication_failed',
      'not logged in',
      'please run /login',
      'claude code returned an error result: not logged'
    ]
  },
  {
    type: 'no_commits' as FailureReason,
    keywords: [
      'no commits',
      'produced no commits',
      'no output captured',
      'agent produced no commits',
      'produced only scratch files'
    ]
  },
  {
    type: 'timeout' as FailureReason,
    keywords: ['exceeded maximum runtime', 'timeout', 'timed out', 'watchdog', 'max_turns_exceeded']
  },
  {
    type: 'test_failure' as FailureReason,
    keywords: ['npm test failed', 'test failed', 'vitest failed', 'jest failed', 'tests failed']
  },
  {
    type: 'compilation' as FailureReason,
    keywords: [
      'compilation error',
      'compilation failed',
      'tsc failed',
      'typescript error',
      'type error',
      'build failed'
    ]
  },
  {
    type: 'spawn' as FailureReason,
    keywords: ['spawn failed', 'failed to spawn', 'enoent', 'command not found']
  },
  {
    type: 'incomplete_files' as FailureReason,
    keywords: ['missing:', 'incomplete files', 'files to change checklist']
  }
])

/**
 * Classifies an agent failure by matching keywords against the built-in
 * pattern set, followed by any `additionalPatterns` supplied by the caller.
 *
 * `additionalPatterns` is the test-safe extension point — pass custom entries
 * here instead of mutating module-level state.
 */
export function classifyFailureReason(
  notes: string | undefined,
  logger?: Logger,
  taskId?: string,
  additionalPatterns?: FailurePattern[]
): FailureReason {
  if (!notes) return 'unknown'

  const lower = notes.toLowerCase()
  const allPatterns = additionalPatterns
    ? ([...BUILTIN_FAILURE_PATTERNS, ...additionalPatterns] as FailurePattern[])
    : (BUILTIN_FAILURE_PATTERNS as FailurePattern[])

  const matched = allPatterns.find((p) => p.keywords.some((k) => lower.includes(k)))
  if (!matched) return 'unknown'

  logger?.debug(
    `[failure-classifier] matched pattern "${matched.name ?? matched.type}" verdict=${matched.type}${taskId ? ` taskId=${taskId}` : ''}`
  )
  return matched.type
}
