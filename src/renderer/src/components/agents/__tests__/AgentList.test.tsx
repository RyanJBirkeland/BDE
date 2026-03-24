import { describe, it, expect } from 'vitest'
import { groupAgents } from '../AgentList'
import type { AgentMeta } from '../../../../../shared/types'

const base: Omit<AgentMeta, 'id' | 'status' | 'startedAt' | 'finishedAt'> = {
  pid: null,
  bin: 'claude',
  model: 'sonnet',
  repo: 'test',
  repoPath: '/tmp/test',
  task: 'do stuff',
  exitCode: null,
  logPath: '/tmp/log',
  source: 'bde', costUsd: null, tokensIn: null, tokensOut: null, sprintTaskId: null,
}

describe('groupAgents', () => {
  it('groups agents into running, recent, and history', () => {
    const now = Date.now()
    const agents: AgentMeta[] = [
      { ...base, id: '1', status: 'running', startedAt: new Date(now).toISOString(), finishedAt: null },
      { ...base, id: '2', status: 'done', startedAt: new Date(now - 7200_000).toISOString(), finishedAt: new Date(now - 3600_000).toISOString() },
      { ...base, id: '3', status: 'done', startedAt: new Date(now - 96 * 3600_000).toISOString(), finishedAt: new Date(now - 48 * 3600_000).toISOString() },
    ]
    const groups = groupAgents(agents)
    expect(groups.running).toHaveLength(1)
    expect(groups.recent).toHaveLength(1)
    expect(groups.history).toHaveLength(1)
  })

  it('returns empty groups for empty input', () => {
    const groups = groupAgents([])
    expect(groups.running).toHaveLength(0)
    expect(groups.recent).toHaveLength(0)
    expect(groups.history).toHaveLength(0)
  })

  it('classifies failed agents as recent or history based on finishedAt', () => {
    const now = Date.now()
    const agents: AgentMeta[] = [
      { ...base, id: '1', status: 'failed', startedAt: new Date(now - 1000).toISOString(), finishedAt: new Date(now - 500).toISOString() },
    ]
    const groups = groupAgents(agents)
    expect(groups.running).toHaveLength(0)
    expect(groups.recent).toHaveLength(1)
  })
})
