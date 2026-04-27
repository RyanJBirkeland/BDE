import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DEFAULT_CONFIG } from '../types'

// ---------- mocks ----------

const mockLoadBackendSettings = vi.fn()
const mockResolveBackend = vi.fn()
const mockSpawnLocalAgent = vi.fn()
const mockSpawnViaSdk = vi.fn()
const mockSpawnViaCli = vi.fn()
const mockSpawnOpencode = vi.fn()
const mockStartOpencodeSessionMcp = vi.fn()
const mockWriteOpencodeWorktreeConfig = vi.fn()
const mockCreateEpicGroupService = vi.fn()

vi.mock('../backend-selector', () => ({
  loadBackendSettings: () => mockLoadBackendSettings(),
  resolveAgentRuntime: (...args: unknown[]) => mockResolveBackend(...args)
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

vi.mock('../spawn-opencode', () => ({
  spawnOpencode: (...args: unknown[]) => mockSpawnOpencode(...args)
}))

vi.mock('../opencode-session-mcp', () => ({
  startOpencodeSessionMcp: (...args: unknown[]) => mockStartOpencodeSessionMcp(...args)
}))

vi.mock('../opencode-worktree-config', () => ({
  writeOpencodeWorktreeConfig: (...args: unknown[]) => mockWriteOpencodeWorktreeConfig(...args),
  buildOpencodeFirstTurnPrompt: (task: string, branch: string) =>
    `You are working on branch \`${branch}\`.\nCommit format: \`{type}({scope}): {description}\`. Run \`npm run typecheck && npm test\` before every commit.\n\n${task}`
}))

vi.mock('../../services/epic-group-service', () => ({
  createEpicGroupService: () => mockCreateEpicGroupService()
}))

import { spawnAgent } from '../sdk-adapter'

// ---------- helpers ----------

const CLAUDE_SETTINGS = {
  pipeline: { backend: 'claude' as const, model: DEFAULT_CONFIG.defaultModel },
  synthesizer: { backend: 'claude' as const, model: DEFAULT_CONFIG.defaultModel },
  copilot: { backend: 'claude' as const, model: DEFAULT_CONFIG.defaultModel },
  assistant: { backend: 'claude' as const, model: DEFAULT_CONFIG.defaultModel },
  adhoc: { backend: 'claude' as const, model: DEFAULT_CONFIG.defaultModel },
  reviewer: { backend: 'claude' as const, model: DEFAULT_CONFIG.defaultModel },
  localEndpoint: 'http://localhost:1234/v1',
  opencodeExecutable: 'opencode'
}

const LOCAL_PIPELINE_SETTINGS = {
  ...CLAUDE_SETTINGS,
  pipeline: { backend: 'local' as const, model: 'openai/qwen/qwen3.6-35b-a3b' }
}

const OPENCODE_PIPELINE_SETTINGS = {
  ...CLAUDE_SETTINGS,
  pipeline: { backend: 'opencode' as const, model: 'devstral:latest' }
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
    mockSpawnOpencode.mockResolvedValue(fakeHandle('opencode-session'))
    mockStartOpencodeSessionMcp.mockResolvedValue({
      url: 'http://127.0.0.1:12345/mcp',
      token: 'test-session-token',
      close: vi.fn().mockResolvedValue(undefined)
    })
    mockWriteOpencodeWorktreeConfig.mockResolvedValue(undefined)
    mockCreateEpicGroupService.mockReturnValue({})
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
      model: DEFAULT_CONFIG.defaultModel
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
      model: DEFAULT_CONFIG.defaultModel
    })

    const sdkCall = mockSpawnViaSdk.mock.calls[0]
    const optsArg = sdkCall?.[1] as { model: string } | undefined
    expect(optsArg?.model).toBe(DEFAULT_CONFIG.defaultModel)
  })
})

describe('spawnAgent — opencode backend', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSpawnOpencode.mockResolvedValue(fakeHandle('opencode-session'))
    mockStartOpencodeSessionMcp.mockResolvedValue({
      url: 'http://127.0.0.1:12345/mcp',
      token: 'test-session-token',
      close: vi.fn().mockResolvedValue(undefined)
    })
    mockWriteOpencodeWorktreeConfig.mockResolvedValue(undefined)
    mockCreateEpicGroupService.mockReturnValue({})
    mockLoadBackendSettings.mockReturnValue(OPENCODE_PIPELINE_SETTINGS)
    mockResolveBackend.mockReturnValue(OPENCODE_PIPELINE_SETTINGS.pipeline)
  })

  it('starts a per-session MCP server before spawning', async () => {
    await spawnAgent({ prompt: 'task', cwd: '/tmp/wt/task-1', model: 'devstral:latest' })

    expect(mockStartOpencodeSessionMcp).toHaveBeenCalledTimes(1)
  })

  it('writes opencode worktree config with the MCP URL and token', async () => {
    await spawnAgent({ prompt: 'task', cwd: '/tmp/wt/task-1', model: 'devstral:latest' })

    expect(mockWriteOpencodeWorktreeConfig).toHaveBeenCalledWith(
      '/tmp/wt/task-1',
      'http://127.0.0.1:12345/mcp',
      'test-session-token'
    )
  })

  it('closes the MCP server when handle messages are exhausted', async () => {
    const sessionMcpClose = vi.fn().mockResolvedValue(undefined)
    mockStartOpencodeSessionMcp.mockResolvedValue({
      url: 'http://127.0.0.1:12345/mcp',
      token: 'test-session-token',
      close: sessionMcpClose
    })

    const handle = await spawnAgent({ prompt: 'task', cwd: '/tmp/wt/task-1', model: 'devstral:latest' })

    // Exhaust the messages iterator to trigger MCP cleanup
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _ of handle.messages) { /* consume */ }

    expect(sessionMcpClose).toHaveBeenCalledTimes(1)
  })

  it('sends a lightweight branch-prefixed prompt to opencode when branch is provided', async () => {
    await spawnAgent({
      prompt: 'implement feature X',
      cwd: '/tmp/wt/task-1',
      model: 'devstral:latest',
      branch: 'agent/task-1-feature-x'
    })

    const opencodeCall = mockSpawnOpencode.mock.calls[0]
    const opts = opencodeCall?.[0] as { prompt: string } | undefined
    expect(opts?.prompt).toContain('agent/task-1-feature-x')
    expect(opts?.prompt).toContain('implement feature X')
  })

  it('routes to opencode and not to the SDK or local adapter', async () => {
    await spawnAgent({ prompt: 'task', cwd: '/tmp/wt/task-1', model: 'devstral:latest' })

    expect(mockSpawnOpencode).toHaveBeenCalledTimes(1)
    expect(mockSpawnViaSdk).not.toHaveBeenCalled()
    expect(mockSpawnLocalAgent).not.toHaveBeenCalled()
  })

  it('closes the MCP server when spawnOpencode throws before returning a handle', async () => {
    const sessionMcpClose = vi.fn().mockResolvedValue(undefined)
    mockStartOpencodeSessionMcp.mockResolvedValue({
      url: 'http://127.0.0.1:12345/mcp',
      token: 'test-session-token',
      close: sessionMcpClose
    })
    mockSpawnOpencode.mockRejectedValue(new Error('opencode: command not found'))

    await expect(
      spawnAgent({ prompt: 'task', cwd: '/tmp/wt/task-1', model: 'devstral:latest' })
    ).rejects.toThrow('opencode: command not found')

    expect(sessionMcpClose).toHaveBeenCalledTimes(1)
  })
})
