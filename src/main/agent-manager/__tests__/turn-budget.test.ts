import { describe, it, expect } from 'vitest'
import { computeMaxTurns, PIPELINE_DISALLOWED_TOOLS } from '../turn-budget'

describe('computeMaxTurns', () => {
  it('returns the default budget for a short single-file spec', () => {
    const spec = '## Fix\nAdjust the header logo padding.'
    expect(computeMaxTurns(spec)).toBe(30)
  })

  it('returns the multi-file budget when the explicit opt-in header is present', () => {
    const spec = '## Multi-File: true\n## Refactor\nBroad refactor across services.'
    expect(computeMaxTurns(spec)).toBe(75)
  })

  it('returns the mixed-stack budget when spec mentions both .tsx and .css', () => {
    const spec = 'Update Header.tsx with a new className; styles in Header.css.'
    expect(computeMaxTurns(spec)).toBe(50)
  })

  it('returns the mixed-stack budget when at least 3 src/ paths appear', () => {
    const spec = 'Touch src/a.ts, src/b.ts, and src/c.ts to wire up the feature.'
    expect(computeMaxTurns(spec)).toBe(50)
  })
})

describe('PIPELINE_DISALLOWED_TOOLS — recon entries', () => {
  it('blocks git log, status, ls-remote, diff, reflog', () => {
    expect(PIPELINE_DISALLOWED_TOOLS).toContain('Bash(git log:*)')
    expect(PIPELINE_DISALLOWED_TOOLS).toContain('Bash(git status:*)')
    expect(PIPELINE_DISALLOWED_TOOLS).toContain('Bash(git ls-remote:*)')
    expect(PIPELINE_DISALLOWED_TOOLS).toContain('Bash(git diff:*)')
    expect(PIPELINE_DISALLOWED_TOOLS).toContain('Bash(git reflog:*)')
  })
})

describe('PIPELINE_DISALLOWED_TOOLS — network exfil entries', () => {
  it('blocks curl and wget Bash subcommands', () => {
    expect(PIPELINE_DISALLOWED_TOOLS).toContain('Bash(curl:*)')
    expect(PIPELINE_DISALLOWED_TOOLS).toContain('Bash(wget:*)')
  })

  it('blocks ssh, scp, and nc Bash subcommands', () => {
    expect(PIPELINE_DISALLOWED_TOOLS).toContain('Bash(ssh:*)')
    expect(PIPELINE_DISALLOWED_TOOLS).toContain('Bash(scp:*)')
    expect(PIPELINE_DISALLOWED_TOOLS).toContain('Bash(nc:*)')
  })

  it('blocks the gh CLI', () => {
    expect(PIPELINE_DISALLOWED_TOOLS).toContain('Bash(gh:*)')
  })

  it('blocks the WebFetch and WebSearch built-in tools', () => {
    expect(PIPELINE_DISALLOWED_TOOLS).toContain('WebFetch')
    expect(PIPELINE_DISALLOWED_TOOLS).toContain('WebSearch')
  })
})
