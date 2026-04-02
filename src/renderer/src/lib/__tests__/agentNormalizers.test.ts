import { describe, it, expect } from 'vitest'
import {
  normalizeStatus,
  normalizeSource,
  truncateTask,
  safeTimestamp,
  buildUnifiedAgentList
} from '../agentNormalizers'
import type { AgentMeta } from '../../../../shared/types'
import type { LocalAgentProcess } from '../../stores/localAgents'

function makeAgentMeta(overrides: Partial<AgentMeta> = {}): AgentMeta {
  return {
    id: 'agent-1',
    pid: 123,
    bin: 'claude',
    model: 'claude-sonnet',
    repo: 'BDE',
    repoPath: '/tmp/bde',
    task: 'Fix the bug',
    startedAt: new Date('2024-01-01T10:00:00Z').toISOString(),
    finishedAt: null,
    exitCode: null,
    status: 'done',
    logPath: '/tmp/log',
    source: 'bde',
    costUsd: null,
    tokensIn: null,
    tokensOut: null,
    sprintTaskId: null,
    ...overrides
  }
}

function makeProcess(overrides: Partial<LocalAgentProcess> = {}): LocalAgentProcess {
  return {
    pid: 999,
    bin: 'claude',
    args: '',
    cwd: '/tmp/my-repo',
    startedAt: Date.now(),
    cpuPct: 0,
    memMb: 0,
    ...overrides
  }
}

describe('normalizeStatus', () => {
  it('maps running to running', () => {
    expect(normalizeStatus('running')).toBe('running')
  })

  it('maps done to done', () => {
    expect(normalizeStatus('done')).toBe('done')
  })

  it('maps completed to done', () => {
    expect(normalizeStatus('completed')).toBe('done')
  })

  it('maps failed to failed', () => {
    expect(normalizeStatus('failed')).toBe('failed')
  })

  it('maps cancelled to cancelled', () => {
    expect(normalizeStatus('cancelled')).toBe('cancelled')
  })

  it('maps timeout to timeout', () => {
    expect(normalizeStatus('timeout')).toBe('timeout')
  })

  it('maps unknown string to unknown', () => {
    expect(normalizeStatus('random-status')).toBe('unknown')
  })

  it('maps undefined to unknown', () => {
    expect(normalizeStatus(undefined)).toBe('unknown')
  })

  it('maps empty string to unknown', () => {
    expect(normalizeStatus('')).toBe('unknown')
  })
})

describe('normalizeSource', () => {
  it('maps bde to local', () => {
    expect(normalizeSource('bde')).toBe('local')
  })

  it('maps external to history', () => {
    expect(normalizeSource('external')).toBe('history')
  })

  it('maps unknown string to history', () => {
    expect(normalizeSource('adhoc')).toBe('history')
  })

  it('maps empty string to history', () => {
    expect(normalizeSource('')).toBe('history')
  })
})

describe('truncateTask', () => {
  it('returns string as-is when under max length', () => {
    expect(truncateTask('Short task', 80)).toBe('Short task')
  })

  it('truncates string when over max length', () => {
    const long = 'A'.repeat(100)
    expect(truncateTask(long, 80)).toBe('A'.repeat(80))
  })

  it('returns string exactly at max length unchanged', () => {
    const exact = 'B'.repeat(80)
    expect(truncateTask(exact, 80)).toBe(exact)
  })

  it('returns undefined for undefined input', () => {
    expect(truncateTask(undefined, 80)).toBeUndefined()
  })

  it('returns undefined for empty string', () => {
    // Empty string is falsy, returns undefined
    expect(truncateTask('', 80)).toBeUndefined()
  })
})

describe('safeTimestamp', () => {
  it('returns 0 for null', () => {
    expect(safeTimestamp(null)).toBe(0)
  })

  it('returns 0 for undefined', () => {
    expect(safeTimestamp(undefined)).toBe(0)
  })

  it('returns number as-is for numeric input', () => {
    expect(safeTimestamp(1700000000000)).toBe(1700000000000)
  })

  it('parses ISO date string to ms', () => {
    const iso = '2024-01-01T10:00:00.000Z'
    expect(safeTimestamp(iso)).toBe(new Date(iso).getTime())
  })

  it('returns 0 for invalid date string', () => {
    expect(safeTimestamp('not-a-date')).toBe(0)
  })

  it('returns 0 for numeric 0', () => {
    expect(safeTimestamp(0)).toBe(0)
  })
})

describe('buildUnifiedAgentList', () => {
  it('returns empty list for no processes and no history', () => {
    expect(buildUnifiedAgentList([], [])).toEqual([])
  })

  it('adds local processes as LocalAgent with id=local:<pid>', () => {
    const proc = makeProcess({ pid: 1234, cwd: '/projects/bde' })
    const result = buildUnifiedAgentList([proc], [])
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('local:1234')
    expect(result[0].source).toBe('local')
    expect(result[0].status).toBe('running')
  })

  it('uses last path segment of cwd as label when cwd is set', () => {
    const proc = makeProcess({ pid: 1, cwd: '/projects/my-cool-repo' })
    const result = buildUnifiedAgentList([proc], [])
    expect(result[0].label).toBe('my-cool-repo')
  })

  it('uses bin as label when cwd is null', () => {
    const proc = makeProcess({ pid: 1, cwd: null as unknown as string, bin: 'claude' })
    const result = buildUnifiedAgentList([proc], [])
    expect(result[0].label).toBe('claude')
  })

  it('adds bde history agents as local source entries', () => {
    const agent = makeAgentMeta({ id: 'hist-1', source: 'bde', status: 'done' })
    const result = buildUnifiedAgentList([], [agent])
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('history:hist-1')
    expect(result[0].source).toBe('local')
  })

  it('adds external history agents as history source entries', () => {
    const agent = makeAgentMeta({ id: 'hist-2', source: 'external', status: 'done' })
    const result = buildUnifiedAgentList([], [agent])
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('history:hist-2')
    expect(result[0].source).toBe('history')
  })

  it('skips running history agents that already have a live process', () => {
    const proc = makeProcess({ pid: 999 })
    const agent = makeAgentMeta({ id: 'running-1', pid: 999, status: 'running', source: 'bde' })
    const result = buildUnifiedAgentList([proc], [agent])
    // Should only have the local process, not a duplicate from history
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('local:999')
  })

  it('does not skip running history agent when pid not in local processes', () => {
    const proc = makeProcess({ pid: 111 })
    const agent = makeAgentMeta({ id: 'running-2', pid: 222, status: 'running', source: 'bde' })
    const result = buildUnifiedAgentList([proc], [agent])
    expect(result).toHaveLength(2)
  })

  it('uses repo as label for history agents with repo set', () => {
    const agent = makeAgentMeta({ id: 'h1', source: 'external', repo: 'my-repo', bin: '' })
    const result = buildUnifiedAgentList([], [agent])
    expect(result[0].label).toBe('my-repo')
  })

  it('uses bin as fallback label when repo is empty', () => {
    const agent = makeAgentMeta({ id: 'h2', source: 'external', repo: '', bin: 'claude' })
    const result = buildUnifiedAgentList([], [agent])
    expect(result[0].label).toBe('claude')
  })

  it('uses id as final fallback label', () => {
    const agent = makeAgentMeta({ id: 'h3', source: 'external', repo: '', bin: '' })
    const result = buildUnifiedAgentList([], [agent])
    expect(result[0].label).toBe('h3')
  })

  it('sets canKill=true for running bde history agents with pid', () => {
    const agent = makeAgentMeta({ id: 'h4', source: 'bde', pid: 555, status: 'running' })
    const result = buildUnifiedAgentList([], [agent])
    const localAgent = result.find((a) => a.id === 'history:h4')
    expect(localAgent).toBeDefined()
    if (localAgent && 'canKill' in localAgent) {
      expect(localAgent.canKill).toBe(true)
    }
  })

  it('sets canKill=false for done bde history agents', () => {
    const agent = makeAgentMeta({ id: 'h5', source: 'bde', pid: 555, status: 'done' })
    const result = buildUnifiedAgentList([], [agent])
    const localAgent = result.find((a) => a.id === 'history:h5')
    if (localAgent && 'canKill' in localAgent) {
      expect(localAgent.canKill).toBe(false)
    }
  })

  it('includes model from history agent', () => {
    const agent = makeAgentMeta({ id: 'h6', source: 'external', model: 'claude-opus' })
    const result = buildUnifiedAgentList([], [agent])
    expect(result[0].model).toBe('claude-opus')
  })

  it('handles multiple processes and history agents', () => {
    const procs = [makeProcess({ pid: 1 }), makeProcess({ pid: 2, cwd: '/other' })]
    const agents = [
      makeAgentMeta({ id: 'a1', source: 'bde', status: 'done' }),
      makeAgentMeta({ id: 'a2', source: 'external', status: 'failed' })
    ]
    const result = buildUnifiedAgentList(procs, agents)
    expect(result).toHaveLength(4)
  })
})
