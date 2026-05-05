import { describe, it, expect } from 'vitest'
import { describeAgentStep } from '../describeAgentStep'

describe('describeAgentStep', () => {
  it('returns "running…" for undefined', () => {
    expect(describeAgentStep(undefined)).toBe('running…')
  })

  it('formats agent:tool_call with tool and summary', () => {
    expect(
      describeAgentStep({ type: 'agent:tool_call', tool: 'Read', summary: 'src/foo.ts' })
    ).toBe('$ Read: src/foo.ts')
  })

  it('truncates agent:tool_call at 52 chars', () => {
    const longSummary = 'a'.repeat(60)
    const result = describeAgentStep({ type: 'agent:tool_call', tool: 'Bash', summary: longSummary })
    expect(result.length).toBe(52)
    expect(result.endsWith('…')).toBe(true)
  })

  it('returns "running…" for agent:tool_call with missing fields', () => {
    expect(describeAgentStep({ type: 'agent:tool_call' })).toBe('running…')
  })

  it('formats agent:text with first non-empty line', () => {
    expect(
      describeAgentStep({ type: 'agent:text', text: '\nLooking at the file\nMore text' })
    ).toBe('Looking at the file')
  })

  it('truncates agent:text at 52 chars', () => {
    const longText = 'b'.repeat(80)
    const result = describeAgentStep({ type: 'agent:text', text: longText })
    expect(result.length).toBe(52)
    expect(result.endsWith('…')).toBe(true)
  })

  it('returns "running…" for agent:text with only whitespace', () => {
    expect(describeAgentStep({ type: 'agent:text', text: '   \n  ' })).toBe('running…')
  })

  it('returns "running…" for agent:started', () => {
    expect(describeAgentStep({ type: 'agent:started' })).toBe('running…')
  })

  it('returns "running…" for agent:thinking', () => {
    expect(describeAgentStep({ type: 'agent:thinking' })).toBe('running…')
  })

  it('returns "running…" for agent:completed', () => {
    expect(describeAgentStep({ type: 'agent:completed' })).toBe('running…')
  })
})
