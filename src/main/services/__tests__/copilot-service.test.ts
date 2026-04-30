import { describe, it, expect } from 'vitest'
import {
  getCopilotSdkOptions,
  COPILOT_ALLOWED_TOOLS,
  COPILOT_DISALLOWED_TOOLS,
  COPILOT_MAX_BUDGET_USD,
  COPILOT_MAX_TURNS
} from '../copilot-service'

describe('COPILOT_ALLOWED_TOOLS', () => {
  it('only permits read-only tools', () => {
    const allowed = [...COPILOT_ALLOWED_TOOLS] as string[]
    expect(allowed).toContain('Read')
    expect(allowed).toContain('Grep')
    expect(allowed).toContain('Glob')
    // Write-capable tools must not appear in the allowlist
    expect(allowed).not.toContain('Edit')
    expect(allowed).not.toContain('Write')
    expect(allowed).not.toContain('Bash')
  })
})

describe('COPILOT_DISALLOWED_TOOLS', () => {
  it('explicitly denies mutation tools', () => {
    const denied = [...COPILOT_DISALLOWED_TOOLS] as string[]
    expect(denied).toContain('Edit')
    expect(denied).toContain('Write')
    expect(denied).toContain('Bash')
    expect(denied).toContain('WebFetch')
  })
})

describe('getCopilotSdkOptions', () => {
  it('returns the correct allowed tool set', () => {
    const opts = getCopilotSdkOptions('/repos/fleet', 'claude-sonnet-4-5')
    expect(opts.tools).toEqual([...COPILOT_ALLOWED_TOOLS])
  })

  it('returns the correct disallowed tool set', () => {
    const opts = getCopilotSdkOptions('/repos/fleet', 'claude-sonnet-4-5')
    expect(opts.disallowedTools).toEqual([...COPILOT_DISALLOWED_TOOLS])
  })

  it('sets maxTurns to COPILOT_MAX_TURNS', () => {
    const opts = getCopilotSdkOptions('/repos/fleet', 'claude-sonnet-4-5')
    expect(opts.maxTurns).toBe(COPILOT_MAX_TURNS)
  })

  it('sets maxBudgetUsd to COPILOT_MAX_BUDGET_USD', () => {
    const opts = getCopilotSdkOptions('/repos/fleet', 'claude-sonnet-4-5')
    expect(opts.maxBudgetUsd).toBe(COPILOT_MAX_BUDGET_USD)
  })

  it('sets settingSources to empty (skip CLAUDE.md for spec-drafting)', () => {
    const opts = getCopilotSdkOptions(undefined, 'claude-sonnet-4-5')
    expect(opts.settingSources).toEqual([])
  })

  it('enables bypassPermissions since the tool set is already read-only', () => {
    const opts = getCopilotSdkOptions(undefined, 'claude-sonnet-4-5')
    expect(opts.permissionMode).toBe('bypassPermissions')
    expect(opts.allowDangerouslySkipPermissions).toBe(true)
  })

  it('sets cwd to the provided repoPath', () => {
    const opts = getCopilotSdkOptions('/path/to/repo', 'claude-sonnet-4-5')
    expect(opts.cwd).toBe('/path/to/repo')
  })

  it('sets cwd to undefined when no repoPath is provided', () => {
    const opts = getCopilotSdkOptions(undefined, 'claude-sonnet-4-5')
    expect(opts.cwd).toBeUndefined()
  })

  it('passes the model through', () => {
    const opts = getCopilotSdkOptions(undefined, 'claude-opus-4-6')
    expect(opts.model).toBe('claude-opus-4-6')
  })

  it('includes onToolUse callback when provided in extras', () => {
    const onToolUse = vi.fn()
    const opts = getCopilotSdkOptions(undefined, 'claude-sonnet-4-5', { onToolUse })
    expect(opts.onToolUse).toBe(onToolUse)
  })

  it('omits onToolUse when extras are not provided', () => {
    const opts = getCopilotSdkOptions(undefined, 'claude-sonnet-4-5')
    expect(opts.onToolUse).toBeUndefined()
  })
})
