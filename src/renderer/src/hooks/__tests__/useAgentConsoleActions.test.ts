import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useAgentConsoleActions } from '../useAgentConsoleActions'
import type { AgentMeta } from '../../../../shared/types'

function makeAgent(overrides: Partial<AgentMeta> = {}): AgentMeta {
  return {
    id: 'agent-1',
    pid: 123,
    bin: 'claude',
    model: 'sonnet',
    repo: 'fleet',
    repoPath: '/tmp/repo',
    task: 'do thing',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    exitCode: null,
    status: 'running',
    logPath: '/tmp/log.json',
    source: 'adhoc',
    costUsd: null,
    tokensIn: null,
    tokensOut: null,
    sprintTaskId: null,
    worktreePath: '/tmp/wt',
    branch: 'agent/foo',
    ...overrides
  }
}

describe('useAgentConsoleActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const agentsApi = window.api.agents as unknown as Record<string, ReturnType<typeof vi.fn>>
    agentsApi.kill.mockResolvedValue({ ok: true })
    agentsApi.promoteToReview.mockResolvedValue({ ok: true, taskId: 'task-99' })
    agentsApi.getContextTokens.mockResolvedValue(null)
    agentsApi.tailLog.mockResolvedValue({ content: 'log body', nextByte: 0 })
    const gitApi = window.api.git as unknown as Record<string, ReturnType<typeof vi.fn>>
    gitApi.status.mockResolvedValue({ files: [], branch: 'main' })
  })

  it('killAgent uses sprintTaskId when present (pipeline agent)', async () => {
    const { result } = renderHook(() =>
      useAgentConsoleActions(makeAgent({ sprintTaskId: 'sprint-7' }))
    )
    await act(async () => {
      await result.current.killAgent()
    })
    expect(window.api.agents.kill).toHaveBeenCalledWith('sprint-7')
  })

  it('killAgent falls back to agent.id for adhoc agents', async () => {
    const { result } = renderHook(() => useAgentConsoleActions(makeAgent()))
    await act(async () => {
      await result.current.killAgent()
    })
    expect(window.api.agents.kill).toHaveBeenCalledWith('agent-1')
  })

  it('promoteToReview surfaces taskId and switches view on success', async () => {
    const { result } = renderHook(() => useAgentConsoleActions(makeAgent()))
    await act(async () => {
      await result.current.promoteToReview()
    })
    expect(window.api.agents.promoteToReview).toHaveBeenCalledWith('agent-1')
  })

  it('polls context tokens for running agents', async () => {
    const agentsApi = window.api.agents as unknown as Record<string, ReturnType<typeof vi.fn>>
    agentsApi.getContextTokens.mockResolvedValue({
      contextWindowTokens: 12_000,
      peakContextTokens: 20_000
    })
    const { result } = renderHook(() => useAgentConsoleActions(makeAgent()))
    await waitFor(() => {
      expect(result.current.contextTokens).toEqual({ current: 12_000, peak: 20_000 })
    })
    expect(window.api.agents.getContextTokens).toHaveBeenCalledWith('agent-1')
  })

  it('buildKillConfirmation marks worktrees with uncommitted files as danger', async () => {
    const gitApi = window.api.git as unknown as Record<string, ReturnType<typeof vi.fn>>
    gitApi.status.mockResolvedValue({
      files: [{ status: 'M', path: 'src/foo.ts' }],
      branch: 'main'
    })
    const { result } = renderHook(() => useAgentConsoleActions(makeAgent()))
    const confirmation = await result.current.buildKillConfirmation()
    expect(confirmation.hasUncommittedWork).toBe(true)
    expect(confirmation.message).toContain('uncommitted changes')
  })

  it('buildKillConfirmation reports clean worktrees as non-danger', async () => {
    const { result } = renderHook(() => useAgentConsoleActions(makeAgent()))
    const confirmation = await result.current.buildKillConfirmation()
    expect(confirmation.hasUncommittedWork).toBe(false)
  })
})
