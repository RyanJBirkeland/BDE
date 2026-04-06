import { describe, it, expect } from 'vitest'
import { derivePhaseLabel } from '../agent-phase'
import type { AgentEvent } from '../../../../shared/types'

const NOW = 1_700_000_000_000

function ev(e: Partial<AgentEvent> & { type: AgentEvent['type']; timestamp?: number }): AgentEvent {
  return { timestamp: NOW, ...e } as AgentEvent
}

describe('derivePhaseLabel', () => {
  it('returns Idle for empty or undefined events', () => {
    expect(derivePhaseLabel([], NOW)).toBe('Idle')
    expect(derivePhaseLabel(undefined, NOW)).toBe('Idle')
  })

  it('maps Read/Grep/Glob to "Exploring code"', () => {
    for (const tool of ['Read', 'Grep', 'Glob']) {
      const result = derivePhaseLabel(
        [ev({ type: 'agent:tool_call', tool, summary: tool, timestamp: NOW })],
        NOW
      )
      expect(result).toBe('Exploring code')
    }
  })

  it('maps Edit/Write to "Writing code"', () => {
    for (const tool of ['Edit', 'Write', 'MultiEdit']) {
      const result = derivePhaseLabel(
        [ev({ type: 'agent:tool_call', tool, summary: tool, timestamp: NOW })],
        NOW
      )
      expect(result).toBe('Writing code')
    }
  })

  it('detects "Running tests" for npm test bash commands', () => {
    const result = derivePhaseLabel(
      [
        ev({
          type: 'agent:tool_call',
          tool: 'Bash',
          summary: 'npm test',
          input: { command: 'npm test' },
          timestamp: NOW
        })
      ],
      NOW
    )
    expect(result).toBe('Running tests')
  })

  it('detects "Running tests" for vitest and npm run test', () => {
    expect(
      derivePhaseLabel(
        [
          ev({
            type: 'agent:tool_call',
            tool: 'Bash',
            summary: 'vitest',
            input: { command: 'npx vitest run' },
            timestamp: NOW
          })
        ],
        NOW
      )
    ).toBe('Running tests')

    expect(
      derivePhaseLabel(
        [
          ev({
            type: 'agent:tool_call',
            tool: 'Bash',
            summary: 'npm run test',
            input: { command: 'npm run test:main' },
            timestamp: NOW
          })
        ],
        NOW
      )
    ).toBe('Running tests')
  })

  it('detects "Committing" for git commit', () => {
    const result = derivePhaseLabel(
      [
        ev({
          type: 'agent:tool_call',
          tool: 'Bash',
          summary: 'git commit',
          input: { command: 'git commit -m "fix"' },
          timestamp: NOW
        })
      ],
      NOW
    )
    expect(result).toBe('Committing')
  })

  it('maps text/thinking events to "Thinking"', () => {
    expect(derivePhaseLabel([ev({ type: 'agent:text', text: 'hi', timestamp: NOW })], NOW)).toBe(
      'Thinking'
    )
    expect(
      derivePhaseLabel([ev({ type: 'agent:thinking', tokenCount: 1, timestamp: NOW })], NOW)
    ).toBe('Thinking')
  })

  it('returns Idle when newest event is older than recent window', () => {
    const stale = NOW - 5 * 60_000
    const result = derivePhaseLabel(
      [ev({ type: 'agent:tool_call', tool: 'Read', summary: 'r', timestamp: stale })],
      NOW
    )
    expect(result).toBe('Idle')
  })

  it('walks past unknown bash commands to find a classifiable event', () => {
    const result = derivePhaseLabel(
      [
        ev({ type: 'agent:tool_call', tool: 'Read', summary: 'r', timestamp: NOW - 1000 }),
        ev({
          type: 'agent:tool_call',
          tool: 'Bash',
          summary: 'ls',
          input: { command: 'ls -la' },
          timestamp: NOW
        })
      ],
      NOW
    )
    expect(result).toBe('Exploring code')
  })

  it('uses the latest event when multiple are present', () => {
    const result = derivePhaseLabel(
      [
        ev({ type: 'agent:text', text: 'hi', timestamp: NOW - 1000 }),
        ev({ type: 'agent:tool_call', tool: 'Edit', summary: 'e', timestamp: NOW })
      ],
      NOW
    )
    expect(result).toBe('Writing code')
  })
})
