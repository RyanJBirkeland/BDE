import type { FailureReason } from '../../shared/types'

export type FailurePattern = { type: FailureReason; keywords: string[] }

const failurePatternRegistry: FailurePattern[] = []

export function registerFailurePattern(entry: FailurePattern): void {
  failurePatternRegistry.push(entry)
}

registerFailurePattern({
  type: 'auth',
  keywords: ['invalid api key', 'authentication failed', 'unauthorized', 'token expired', 'invalid token']
})
registerFailurePattern({
  type: 'timeout',
  keywords: ['exceeded maximum runtime', 'timeout', 'timed out', 'watchdog']
})
registerFailurePattern({
  type: 'test_failure',
  keywords: ['npm test failed', 'test failed', 'vitest failed', 'jest failed', 'tests failed']
})
registerFailurePattern({
  type: 'compilation',
  keywords: ['compilation error', 'compilation failed', 'tsc failed', 'typescript error', 'type error', 'build failed']
})
registerFailurePattern({
  type: 'spawn',
  keywords: ['spawn failed', 'failed to spawn', 'enoent', 'command not found']
})

export function classifyFailureReason(notes: string | undefined): FailureReason {
  if (!notes) return 'unknown'

  const lower = notes.toLowerCase()
  return failurePatternRegistry.find(p => p.keywords.some(k => lower.includes(k)))?.type ?? 'unknown'
}
