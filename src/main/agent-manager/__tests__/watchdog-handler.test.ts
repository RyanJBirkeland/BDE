import { describe, it, expect } from 'vitest'
import { handleWatchdogVerdict } from '../watchdog-handler'
import type { ConcurrencyState } from '../concurrency'

const NOW = '2026-04-25T18:00:00.000Z'
const BASE_CONCURRENCY: ConcurrencyState = {
  active: 1,
  max: 2,
  backpressureUntil: null
}

describe('handleWatchdogVerdict', () => {
  it('max-runtime: transitions to error with runtime note and notifies terminal', () => {
    const result = handleWatchdogVerdict('max-runtime', BASE_CONCURRENCY, NOW, 3600000)
    expect(result.taskUpdate?.status).toBe('error')
    expect(result.taskUpdate?.completed_at).toBe(NOW)
    expect(result.taskUpdate?.claimed_by).toBeNull()
    expect(result.shouldNotifyTerminal).toBe(true)
    expect(result.terminalStatus).toBe('error')
    expect(String(result.taskUpdate?.notes)).toContain('60 minutes')
    expect(result.shouldRequeue).toBeUndefined()
  })

  it('max-runtime: uses provided maxRuntimeMs for minute calculation', () => {
    const result = handleWatchdogVerdict('max-runtime', BASE_CONCURRENCY, NOW, 1800000)
    expect(String(result.taskUpdate?.notes)).toContain('30 minutes')
  })

  it('idle: transitions to error with idle note and notifies terminal', () => {
    const result = handleWatchdogVerdict('idle', BASE_CONCURRENCY, NOW)
    expect(result.taskUpdate?.status).toBe('error')
    expect(result.shouldNotifyTerminal).toBe(true)
    expect(result.terminalStatus).toBe('error')
    expect(String(result.taskUpdate?.notes)).toContain('no output for 15 minutes')
    expect(result.shouldRequeue).toBeUndefined()
  })

  it('rate-limit-loop: requeues with backpressure, does not notify terminal', () => {
    const result = handleWatchdogVerdict('rate-limit-loop', BASE_CONCURRENCY, NOW)
    expect(result.taskUpdate?.status).toBe('queued')
    expect(result.shouldNotifyTerminal).toBe(false)
    expect(result.shouldRequeue).toBe(true)
    expect(result.taskUpdate?.claimed_by).toBeNull()
    expect(result.concurrency).not.toBe(BASE_CONCURRENCY) // backpressure applied
  })

  it('cost-budget-exceeded: transitions to error with budget note and notifies terminal', () => {
    const result = handleWatchdogVerdict('cost-budget-exceeded', BASE_CONCURRENCY, NOW)
    expect(result.taskUpdate?.status).toBe('error')
    expect(result.shouldNotifyTerminal).toBe(true)
    expect(result.terminalStatus).toBe('error')
    expect(String(result.taskUpdate?.notes)).toContain('cost budget')
    expect(result.shouldRequeue).toBeUndefined()
  })

  it('unknown verdict: no-op result', () => {
    const result = handleWatchdogVerdict('unknown-verdict' as never, BASE_CONCURRENCY, NOW)
    expect(result.taskUpdate).toBeNull()
    expect(result.shouldNotifyTerminal).toBe(false)
    expect(result.concurrency).toBe(BASE_CONCURRENCY)
  })

  it('preserves concurrency on terminal verdicts', () => {
    const concurrency: ConcurrencyState = { active: 2, max: 3, backpressureUntil: null }
    const result = handleWatchdogVerdict('max-runtime', concurrency, NOW)
    expect(result.concurrency).toBe(concurrency)
  })
})
