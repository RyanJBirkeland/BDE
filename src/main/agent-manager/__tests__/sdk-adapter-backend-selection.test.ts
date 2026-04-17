import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------- mocks ----------

const mockLoadBackendSettings = vi.fn()
const mockResolveBackend = vi.fn()
const mockSpawnLocalAgent = vi.fn()
const mockSpawnViaSdk = vi.fn()
const mockSpawnViaCli = vi.fn()

vi.mock('../backend-selector', () => ({
  loadBackendSettings: () => mockLoadBackendSettings(),
  resolveBackend: (...args: unknown[]) => mockResolveBackend(...args)
}))

vi.mock('../local-adapter', () => ({
  spawnLocalAgent: (...args: unknown[]) => mockSpawnLocalAgent(...args)
}))

vi.mock('../spawn-sdk', () => ({
  spawnViaSdk: (...args: unknown[]) => mockSpawnViaSdk(...args)
}))

vi.mock('../spawn-cli', () => ({
  spawnViaCli: (...args: unknown[]) => mockSpawnViaCli(...args),
  AGENT_PROCESS_MAX_OLD_SPACE_MB: 4096,
  withMaxOldSpaceOption: (existing: string | undefined) => existing ?? ''
}))

vi.mock('../../env-utils', () => ({
  buildAgentEnv: vi.fn(() => ({ PATH: '/usr/local/bin' })),
  getOAuthToken: vi.fn(() => 'mock-oauth-token'),
  getClaudeCliPath: vi.fn(() => '/mock/claude-cli')
}))

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn()
}))

import { spawnAgent } from '../sdk-adapter'

// ---------- helpers ----------

const CLAUDE_SETTINGS = {
  pipeline: { backend: 'claude' as const, model: 'claude-sonnet-4-5' },
  synthesizer: { backend: 'claude' as const, model: 'claude-sonnet-4-5' },
  copilot: { backend: 'claude' as const, model: 'claude-sonnet-4-5' },
  assistant: { backend: 'claude' as const, model: 'claude-sonnet-4-5' },
  adhoc: { backend: 'claude' as const, model: 'claude-sonnet-4-5' },
  reviewer: { backend: 'claude' as const, model: 'claude-sonnet-4-5' },
  localEndpoint: 'http://localhost:1234/v1'
}

const LOCAL_PIPELINE_SETTINGS = {
  ...CLAUDE_SETTINGS,
  pipeline: { backend: 'local' as const, model: 'openai/qwen/qwen3.6-35b-a3b' }
}

function fakeHandle(id = 'fake-session') {
  return {
    sessionId: id,
    messages: (async function* () {
      yield { type: 'system', session_id: id }
    })(),
    abort: () => {},
    steer: async () => ({ delivered: false })
  }
}

// ---------- tests ----------

describe('spawnAgent — backend selection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSpawnViaSdk.mockResolvedValue(fakeHandle('claude-session'))
    mockSpawnViaCli.mockResolvedValue(fakeHandle('claude-cli-session'))
    mockSpawnLocalAgent.mockResolvedValue(fakeHandle('local-session'))
  })

  it('routes to the local adapter when settings say local for the agent type', async () => {
    mockLoadBackendSettings.mockReturnValue(LOCAL_PIPELINE_SETTINGS)
    mockResolveBackend.mockReturnValue(LOCAL_PIPELINE_SETTINGS.pipeline)

    const handle = await spawnAgent({
      prompt: 'task',
      cwd: '/tmp/work',
      model: 'caller-supplied-model',
      agentType: 'pipeline'
    })

    expect(mockSpawnLocalAgent).toHaveBeenCalledTimes(1)
    expect(mockSpawnLocalAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'task',
        cwd: '/tmp/work',
        model: 'openai/qwen/qwen3.6-35b-a3b',
        endpoint: 'http://localhost:1234/v1'
      })
    )
    expect(mockSpawnViaSdk).not.toHaveBeenCalled()
    expect(handle.sessionId).toBe('local-session')
  })

  it('defaults to pipeline when no agentType is supplied', async () => {
    mockLoadBackendSettings.mockReturnValue(LOCAL_PIPELINE_SETTINGS)
    mockResolveBackend.mockReturnValue(LOCAL_PIPELINE_SETTINGS.pipeline)

    await spawnAgent({
      prompt: 'task',
      cwd: '/tmp/work',
      model: 'claude-sonnet-4-5'
    })

    expect(mockResolveBackend).toHaveBeenCalledWith('pipeline', LOCAL_PIPELINE_SETTINGS)
  })

  it('routes to the Claude SDK path when settings say claude', async () => {
    mockLoadBackendSettings.mockReturnValue(CLAUDE_SETTINGS)
    mockResolveBackend.mockReturnValue(CLAUDE_SETTINGS.pipeline)

    await spawnAgent({
      prompt: 'task',
      cwd: '/tmp/work',
      model: 'whatever'
    })

    expect(mockSpawnLocalAgent).not.toHaveBeenCalled()
    expect(mockSpawnViaSdk).toHaveBeenCalledTimes(1)
  })

  it('uses the settings-resolved model on the Claude path, not the caller-supplied one', async () => {
    mockLoadBackendSettings.mockReturnValue(CLAUDE_SETTINGS)
    mockResolveBackend.mockReturnValue({ backend: 'claude', model: 'claude-opus-4-7' })

    await spawnAgent({
      prompt: 'task',
      cwd: '/tmp/work',
      model: 'caller-model-ignored'
    })

    const sdkCall = mockSpawnViaSdk.mock.calls[0]
    const optsArg = sdkCall?.[1] as { model: string } | undefined
    expect(optsArg?.model).toBe('claude-opus-4-7')
  })

  it('falls back to the Claude path when the local adapter throws', async () => {
    mockLoadBackendSettings.mockReturnValue(LOCAL_PIPELINE_SETTINGS)
    mockResolveBackend.mockReturnValue(LOCAL_PIPELINE_SETTINGS.pipeline)
    mockSpawnLocalAgent.mockRejectedValue(new Error('LM Studio unreachable'))

    const handle = await spawnAgent({
      prompt: 'task',
      cwd: '/tmp/work',
      model: 'caller-supplied-model'
    })

    expect(mockSpawnLocalAgent).toHaveBeenCalledTimes(1)
    expect(mockSpawnViaSdk).toHaveBeenCalledTimes(1)
    expect(handle.sessionId).toBe('claude-session')
  })

  it('logs the reason via the caller-provided logger when it falls back', async () => {
    mockLoadBackendSettings.mockReturnValue(LOCAL_PIPELINE_SETTINGS)
    mockResolveBackend.mockReturnValue(LOCAL_PIPELINE_SETTINGS.pipeline)
    mockSpawnLocalAgent.mockRejectedValue(new Error('preflight failed'))

    const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }
    await spawnAgent({
      prompt: 'task',
      cwd: '/tmp/work',
      model: 'caller',
      logger: logger as unknown as Parameters<typeof spawnAgent>[0]['logger']
    })

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('local backend for pipeline failed')
    )
  })

  it('uses the caller-supplied model when falling back from a local failure with a non-claude resolved model', async () => {
    mockLoadBackendSettings.mockReturnValue(LOCAL_PIPELINE_SETTINGS)
    mockResolveBackend.mockReturnValue(LOCAL_PIPELINE_SETTINGS.pipeline)
    mockSpawnLocalAgent.mockRejectedValue(new Error('down'))

    await spawnAgent({
      prompt: 'task',
      cwd: '/tmp/work',
      model: 'claude-sonnet-4-5'
    })

    const sdkCall = mockSpawnViaSdk.mock.calls[0]
    const optsArg = sdkCall?.[1] as { model: string } | undefined
    expect(optsArg?.model).toBe('claude-sonnet-4-5')
  })
})
