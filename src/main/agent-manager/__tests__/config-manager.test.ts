import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../settings', () => ({
  getSetting: vi.fn(),
  getSettingJson: vi.fn()
}))

import { reloadConfiguration, type ConfigManagerDeps } from '../config-manager'
import { getSetting, getSettingJson } from '../../settings'
import { makeConcurrencyState } from '../concurrency'
import type { AgentManagerConfig } from '../types'

function makeConfig(overrides: Partial<AgentManagerConfig> = {}): AgentManagerConfig {
  return {
    maxConcurrent: 2,
    worktreeBase: '/tmp/worktrees',
    maxRuntimeMs: 3_600_000,
    idleTimeoutMs: 900_000,
    pollIntervalMs: 30_000,
    defaultModel: 'claude-sonnet-4-5',
    ...overrides
  }
}

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}

function makeDeps(overrides: Partial<ConfigManagerDeps> = {}): ConfigManagerDeps {
  return {
    config: makeConfig(),
    concurrency: makeConcurrencyState(2),
    runAgentDeps: { defaultModel: 'claude-sonnet-4-5' },
    logger: makeLogger(),
    ...overrides
  }
}

describe('reloadConfiguration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getSetting).mockReturnValue(undefined)
    vi.mocked(getSettingJson).mockReturnValue(undefined)
  })

  it('returns empty arrays when no settings have changed', () => {
    const deps = makeDeps()
    const result = reloadConfiguration(deps)
    expect(result.updated).toEqual([])
    expect(result.requiresRestart).toEqual([])
  })

  it('hot-reloads maxConcurrent when changed', () => {
    const deps = makeDeps()
    vi.mocked(getSettingJson).mockImplementation((key) =>
      key === 'agentManager.maxConcurrent' ? 4 : undefined
    )
    const result = reloadConfiguration(deps)
    expect(result.updated).toContain('maxConcurrent')
    expect(deps.config.maxConcurrent).toBe(4)
    expect(deps.concurrency.maxSlots).toBe(4)
  })

  it('does not update maxConcurrent when value is unchanged', () => {
    const deps = makeDeps()
    vi.mocked(getSettingJson).mockImplementation((key) =>
      key === 'agentManager.maxConcurrent' ? 2 : undefined
    )
    const result = reloadConfiguration(deps)
    expect(result.updated).not.toContain('maxConcurrent')
  })

  it('hot-reloads maxRuntimeMs when changed', () => {
    const deps = makeDeps()
    vi.mocked(getSettingJson).mockImplementation((key) =>
      key === 'agentManager.maxRuntimeMs' ? 7_200_000 : undefined
    )
    const result = reloadConfiguration(deps)
    expect(result.updated).toContain('maxRuntimeMs')
    expect(deps.config.maxRuntimeMs).toBe(7_200_000)
  })

  it('hot-reloads defaultModel when changed', () => {
    const deps = makeDeps()
    vi.mocked(getSetting).mockImplementation((key) =>
      key === 'agentManager.defaultModel' ? 'claude-opus-4-5' : undefined
    )
    const result = reloadConfiguration(deps)
    expect(result.updated).toContain('defaultModel')
    expect(deps.config.defaultModel).toBe('claude-opus-4-5')
    expect(deps.runAgentDeps.defaultModel).toBe('claude-opus-4-5')
  })

  it('flags worktreeBase as requiresRestart when changed', () => {
    const deps = makeDeps()
    vi.mocked(getSetting).mockImplementation((key) =>
      key === 'agentManager.worktreeBase' ? '/new/worktrees' : undefined
    )
    const result = reloadConfiguration(deps)
    expect(result.requiresRestart).toContain('worktreeBase')
    // config.worktreeBase should NOT be updated in-place
    expect(deps.config.worktreeBase).toBe('/tmp/worktrees')
  })

  it('logs updated fields', () => {
    const deps = makeDeps()
    vi.mocked(getSettingJson).mockImplementation((key) =>
      key === 'agentManager.maxConcurrent' ? 5 : undefined
    )
    reloadConfiguration(deps)
    expect(deps.logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Hot-reloaded config fields')
    )
  })

  it('logs requiresRestart fields', () => {
    const deps = makeDeps()
    vi.mocked(getSetting).mockImplementation((key) =>
      key === 'agentManager.worktreeBase' ? '/new/worktrees' : undefined
    )
    reloadConfiguration(deps)
    expect(deps.logger.info).toHaveBeenCalledWith(expect.stringContaining('require restart'))
  })

  it('does not log when nothing changed', () => {
    const deps = makeDeps()
    reloadConfiguration(deps)
    expect(deps.logger.info).not.toHaveBeenCalled()
  })
})
