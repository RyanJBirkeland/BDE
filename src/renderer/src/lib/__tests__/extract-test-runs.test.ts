import { describe, it, expect } from 'vitest'
import { extractTestRuns, extractLatestTestRun } from '../extract-test-runs'
import type { AgentEvent } from '../../../../shared/types'

function call(cmd: string, ts = 1): AgentEvent {
  return {
    type: 'agent:tool_call',
    tool: 'Bash',
    summary: cmd,
    input: { command: cmd },
    timestamp: ts
  }
}

function result(text: string, success = true, ts = 2): AgentEvent {
  return {
    type: 'agent:tool_result',
    tool: 'Bash',
    success,
    summary: text.slice(0, 100),
    output: text,
    timestamp: ts
  }
}

describe('extractTestRuns', () => {
  it('returns empty array for no events', () => {
    expect(extractTestRuns([])).toEqual([])
    expect(extractTestRuns(undefined)).toEqual([])
  })

  it('pairs npm test call with its result', () => {
    const runs = extractTestRuns([
      call('npm test', 100),
      result('Test Files  3 passed\nTests  12 passed', true, 200)
    ])
    expect(runs).toHaveLength(1)
    expect(runs[0].command).toContain('npm test')
    expect(runs[0].output).toContain('3 passed')
    expect(runs[0].success).toBe(true)
  })

  it('detects npm run test and vitest and pnpm test', () => {
    const runs = extractTestRuns([
      call('npm run test:main'),
      result('ok'),
      call('npx vitest run'),
      result('ok'),
      call('pnpm test'),
      result('ok')
    ])
    expect(runs).toHaveLength(3)
  })

  it('captures failed test runs', () => {
    const runs = extractTestRuns([call('npm test'), result('AssertionError', false)])
    expect(runs).toHaveLength(1)
    expect(runs[0].success).toBe(false)
    expect(runs[0].output).toBe('AssertionError')
  })

  it('ignores non-test bash commands', () => {
    const runs = extractTestRuns([
      call('ls -la'),
      result('file1'),
      call('git status'),
      result('clean')
    ])
    expect(runs).toEqual([])
  })

  it('stringifies tool_result content arrays', () => {
    const events: AgentEvent[] = [
      call('npm test'),
      {
        type: 'agent:tool_result',
        tool: 'Bash',
        success: true,
        summary: 'test output',
        output: { content: [{ type: 'text', text: 'Tests: 5 passed' }] },
        timestamp: 2
      }
    ]
    const runs = extractTestRuns(events)
    expect(runs[0].output).toBe('Tests: 5 passed')
  })

  it('extractLatestTestRun returns the final run', () => {
    const runs = extractTestRuns([
      call('npm test', 100),
      result('first', true, 101),
      call('npm test', 200),
      result('second', true, 201)
    ])
    expect(runs).toHaveLength(2)
    const latest = extractLatestTestRun([
      call('npm test', 100),
      result('first', true, 101),
      call('npm test', 200),
      result('second', true, 201)
    ])
    expect(latest?.output).toBe('second')
  })

  it('extractLatestTestRun returns null when no runs found', () => {
    expect(extractLatestTestRun([call('ls'), result('x')])).toBeNull()
  })
})
