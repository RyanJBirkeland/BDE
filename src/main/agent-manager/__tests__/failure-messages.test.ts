import { describe, it, expect } from 'vitest'
import { FAST_FAIL_EXHAUSTED_NOTE, NO_COMMITS_NOTE, NOOP_RUN_NOTE } from '../failure-messages'

describe('FAST_FAIL_EXHAUSTED_NOTE', () => {
  it('points users at ~/.bde/bde.log, not the legacy agent-manager.log', () => {
    expect(FAST_FAIL_EXHAUSTED_NOTE).toContain('~/.bde/bde.log')
    expect(FAST_FAIL_EXHAUSTED_NOTE).not.toContain('agent-manager.log')
  })

  it('directs users to the Retry button instead of raw SQLite reset instructions', () => {
    expect(FAST_FAIL_EXHAUSTED_NOTE).toContain('Retry button')
    expect(FAST_FAIL_EXHAUSTED_NOTE).not.toContain('reset task status')
    expect(FAST_FAIL_EXHAUSTED_NOTE).not.toContain('claimed_by')
  })

  it('still names the common root causes so users can self-diagnose', () => {
    expect(FAST_FAIL_EXHAUSTED_NOTE).toContain('OAuth token')
    expect(FAST_FAIL_EXHAUSTED_NOTE).toContain('npm dependencies')
    expect(FAST_FAIL_EXHAUSTED_NOTE).toContain('task spec')
  })
})

describe('NO_COMMITS_NOTE', () => {
  it('points users at ~/.bde/bde.log, not the legacy agent-manager.log', () => {
    expect(NO_COMMITS_NOTE).toContain('~/.bde/bde.log')
    expect(NO_COMMITS_NOTE).not.toContain('agent-manager.log')
  })
})

describe('NOOP_RUN_NOTE', () => {
  it('mentions neither the legacy log file nor stale SQLite reset guidance', () => {
    expect(NOOP_RUN_NOTE).not.toContain('agent-manager.log')
    expect(NOOP_RUN_NOTE).not.toContain('reset task status')
  })
})
