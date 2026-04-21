import { describe, it, expect } from 'vitest'
import { withMaxOldSpaceOption, AGENT_PROCESS_MAX_OLD_SPACE_MB } from '../spawn-cli'

describe('withMaxOldSpaceOption', () => {
  it('adds flag when NODE_OPTIONS is undefined', () => {
    expect(withMaxOldSpaceOption(undefined, 1024)).toBe('--max-old-space-size=1024')
  })

  it('adds flag when NODE_OPTIONS is empty string', () => {
    expect(withMaxOldSpaceOption('', 1024)).toBe('--max-old-space-size=1024')
  })

  it('adds flag when NODE_OPTIONS is whitespace only', () => {
    expect(withMaxOldSpaceOption('  ', 1024)).toBe('--max-old-space-size=1024')
  })

  it('appends flag to existing NODE_OPTIONS', () => {
    expect(withMaxOldSpaceOption('--expose-gc', 1024)).toBe('--expose-gc --max-old-space-size=1024')
  })

  it('does not add duplicate flag when already present', () => {
    expect(withMaxOldSpaceOption('--max-old-space-size=2048', 1024)).toBe(
      '--max-old-space-size=2048'
    )
  })

  it('honors existing value even if different from cap', () => {
    expect(withMaxOldSpaceOption('--expose-gc --max-old-space-size=512', 1024)).toBe(
      '--expose-gc --max-old-space-size=512'
    )
  })

  it('works with the default constant', () => {
    expect(withMaxOldSpaceOption(undefined, AGENT_PROCESS_MAX_OLD_SPACE_MB)).toBe(
      `--max-old-space-size=${AGENT_PROCESS_MAX_OLD_SPACE_MB}`
    )
  })

  it('handles complex NODE_OPTIONS with multiple flags', () => {
    const existing = '--expose-gc --trace-warnings --max-http-header-size=16384'
    expect(withMaxOldSpaceOption(existing, 2048)).toBe(
      '--expose-gc --trace-warnings --max-http-header-size=16384 --max-old-space-size=2048'
    )
  })

  it('preserves exact existing value when flag already present', () => {
    const existing = '--trace-gc --max-old-space-size=8192'
    expect(withMaxOldSpaceOption(existing, 1024)).toBe(existing)
  })
})

describe('AGENT_PROCESS_MAX_OLD_SPACE_MB', () => {
  it('is 1024', () => {
    expect(AGENT_PROCESS_MAX_OLD_SPACE_MB).toBe(1024)
  })
})
