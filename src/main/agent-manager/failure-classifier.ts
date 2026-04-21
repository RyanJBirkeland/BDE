import type { FailureReason } from '../../shared/types'

export type FailurePattern = { type: FailureReason; keywords: string[] }

const failurePatternRegistry: FailurePattern[] = []

export function registerFailurePattern(entry: FailurePattern): void {
  failurePatternRegistry.push(entry)
}

registerFailurePattern({
  type: 'environmental',
  keywords: [
    'main repo has uncommitted changes',
    'refusing to proceed',
    'is not configured in bde settings',
    'credential unavailable',
    'no claude subscription token',
    'unable to access https://',
    'unable to access http://',
    'could not resolve host',
    'getaddrinfo enotfound',
    'enetunreach',
    'econnrefused'
  ]
})
registerFailurePattern({
  type: 'auth',
  keywords: [
    'invalid api key',
    'authentication failed',
    'unauthorized',
    'token expired',
    'invalid token',
    'invalid_api_key',
    'token_expired',
    'invalid_token',
    'authentication_failed'
  ]
})
registerFailurePattern({
  type: 'no_commits',
  keywords: [
    'no commits',
    'produced no commits',
    'no output captured',
    'agent produced no commits',
    'produced only scratch files'
  ]
})
registerFailurePattern({
  type: 'timeout',
  keywords: ['exceeded maximum runtime', 'timeout', 'timed out', 'watchdog', 'max_turns_exceeded']
})
registerFailurePattern({
  type: 'test_failure',
  keywords: ['npm test failed', 'test failed', 'vitest failed', 'jest failed', 'tests failed']
})
registerFailurePattern({
  type: 'compilation',
  keywords: [
    'compilation error',
    'compilation failed',
    'tsc failed',
    'typescript error',
    'type error',
    'build failed'
  ]
})
registerFailurePattern({
  type: 'spawn',
  keywords: ['spawn failed', 'failed to spawn', 'enoent', 'command not found']
})

export function classifyFailureReason(notes: string | undefined): FailureReason {
  if (!notes) return 'unknown'

  const lower = notes.toLowerCase()
  return (
    failurePatternRegistry.find((p) => p.keywords.some((k) => lower.includes(k)))?.type ?? 'unknown'
  )
}
