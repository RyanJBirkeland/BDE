import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../settings', () => ({
  getSettingJson: vi.fn(),
  setSettingJson: vi.fn()
}))

import * as settings from '../../settings'
import {
  DEFAULT_SETTINGS,
  loadBackendSettings,
  resolveAgentRuntime,
  saveBackendSettings,
  SETTING_BACKEND_CONFIG,
  type BackendSettings
} from '../backend-selector'

describe('loadBackendSettings', () => {
  beforeEach(() => {
    vi.mocked(settings.getSettingJson).mockReset()
    vi.mocked(settings.setSettingJson).mockReset()
  })

  it('returns DEFAULT_SETTINGS when nothing has been saved', () => {
    vi.mocked(settings.getSettingJson).mockReturnValue(null)
    expect(loadBackendSettings()).toEqual(DEFAULT_SETTINGS)
  })

  it('reads from the expected setting key', () => {
    vi.mocked(settings.getSettingJson).mockReturnValue(null)
    loadBackendSettings()
    expect(settings.getSettingJson).toHaveBeenCalledWith(SETTING_BACKEND_CONFIG)
  })

  it('merges partial stored settings on top of defaults', () => {
    vi.mocked(settings.getSettingJson).mockReturnValue({
      pipeline: { backend: 'local', model: 'openai/qwen/qwen3.6-35b-a3b' }
    })
    const result = loadBackendSettings()
    expect(result.pipeline).toEqual({
      backend: 'local',
      model: 'openai/qwen/qwen3.6-35b-a3b'
    })
    expect(result.synthesizer).toEqual(DEFAULT_SETTINGS.synthesizer)
    expect(result.localEndpoint).toBe(DEFAULT_SETTINGS.localEndpoint)
  })

  it('honours a caller-specified localEndpoint override', () => {
    vi.mocked(settings.getSettingJson).mockReturnValue({
      localEndpoint: 'http://remote:9999/v1'
    })
    expect(loadBackendSettings().localEndpoint).toBe('http://remote:9999/v1')
  })
})

describe('saveBackendSettings', () => {
  beforeEach(() => {
    vi.mocked(settings.setSettingJson).mockReset()
  })

  it('writes to the expected key with the full settings object', () => {
    const next: BackendSettings = {
      ...DEFAULT_SETTINGS,
      pipeline: { backend: 'local', model: 'openai/qwen/foo' }
    }
    saveBackendSettings(next)
    expect(settings.setSettingJson).toHaveBeenCalledWith(SETTING_BACKEND_CONFIG, next)
  })
})

describe('resolveAgentRuntime', () => {
  const settingsWithPipelineLocal: BackendSettings = {
    ...DEFAULT_SETTINGS,
    pipeline: { backend: 'local', model: 'openai/qwen/qwen3.6-35b-a3b' }
  }

  it('returns the per-agent-type config from the provided settings', () => {
    expect(resolveAgentRuntime('pipeline', settingsWithPipelineLocal)).toEqual({
      backend: 'local',
      model: 'openai/qwen/qwen3.6-35b-a3b'
    })
  })

  it('leaves other agent types on claude when pipeline is flipped to local', () => {
    expect(resolveAgentRuntime('synthesizer', settingsWithPipelineLocal).backend).toBe('claude')
    expect(resolveAgentRuntime('copilot', settingsWithPipelineLocal).backend).toBe('claude')
    expect(resolveAgentRuntime('assistant', settingsWithPipelineLocal).backend).toBe('claude')
    expect(resolveAgentRuntime('adhoc', settingsWithPipelineLocal).backend).toBe('claude')
    expect(resolveAgentRuntime('reviewer', settingsWithPipelineLocal).backend).toBe('claude')
  })

  it('falls back to loadBackendSettings when no settings argument is passed', () => {
    vi.mocked(settings.getSettingJson).mockReturnValue(null)
    const resolved = resolveAgentRuntime('pipeline')
    expect(resolved).toEqual(DEFAULT_SETTINGS.pipeline)
  })

  it('covers every AgentType the settings schema enumerates', () => {
    const allTypes = [
      'pipeline',
      'synthesizer',
      'copilot',
      'assistant',
      'adhoc',
      'reviewer'
    ] as const
    for (const type of allTypes) {
      expect(resolveAgentRuntime(type, DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS[type])
    }
  })
})

describe('opencode backend kind', () => {
  it('DEFAULT_SETTINGS has backend claude for all agent types', () => {
    const agentTypes = [
      'pipeline',
      'synthesizer',
      'copilot',
      'assistant',
      'adhoc',
      'reviewer'
    ] as const
    for (const type of agentTypes) {
      expect(DEFAULT_SETTINGS[type].backend).toBe('claude')
    }
  })

  it('DEFAULT_SETTINGS.opencodeExecutable equals opencode', () => {
    expect(DEFAULT_SETTINGS.opencodeExecutable).toBe('opencode')
  })

  it('mergeWithDefaults fills opencodeExecutable from defaults when stored value is absent', () => {
    vi.mocked(settings.getSettingJson).mockReturnValue({
      pipeline: { backend: 'opencode', model: 'opencode/gpt-5-nano' }
    })
    const result = loadBackendSettings()
    expect(result.opencodeExecutable).toBe('opencode')
  })

  it('mergeWithDefaults honours a stored opencodeExecutable override', () => {
    vi.mocked(settings.getSettingJson).mockReturnValue({
      opencodeExecutable: '/usr/local/bin/opencode'
    })
    const result = loadBackendSettings()
    expect(result.opencodeExecutable).toBe('/usr/local/bin/opencode')
  })

  it('resolveAgentRuntime returns opencode backend when pipeline is set to opencode', () => {
    const opencodeSettings: BackendSettings = {
      ...DEFAULT_SETTINGS,
      pipeline: { backend: 'opencode', model: 'opencode/claude-sonnet-4-5' }
    }
    const resolved = resolveAgentRuntime('pipeline', opencodeSettings)
    expect(resolved).toEqual({ backend: 'opencode', model: 'opencode/claude-sonnet-4-5' })
  })
})
