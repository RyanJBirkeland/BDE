import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runSdkStreaming } from '../sdk-streaming'
import * as sdk from '@anthropic-ai/claude-agent-sdk'

vi.mock('@anthropic-ai/claude-agent-sdk')
vi.mock('../env-utils', () => ({
  buildAgentEnvWithAuth: vi.fn(() => ({ PATH: '/usr/bin', ANTHROPIC_API_KEY: 'test-key' })),
  getClaudeCliPath: vi.fn(() => '/usr/local/bin/claude')
}))

describe('sdk-streaming', () => {
  let activeStreams: Map<string, { close: () => void }>
  let onChunkMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    activeStreams = new Map()
    onChunkMock = vi.fn()

    vi.mocked(sdk.query).mockReturnValue(
      (async function* () {
        yield {
          type: 'assistant',
          message: {
            content: [{ type: 'text', text: 'Hello world' }]
          }
        }
      })()
    )
  })

  it('should stream text chunks to callback', async () => {
    const result = await runSdkStreaming(
      'Test prompt',
      onChunkMock,
      activeStreams,
      'stream-1',
      180_000,
      {
        model: 'claude-sonnet-4-5'
      }
    )

    expect(onChunkMock).toHaveBeenCalledWith('Hello world')
    expect(result).toBe('Hello world')
  })

  it('should use provided cwd option', async () => {
    await runSdkStreaming('Test', onChunkMock, activeStreams, 'stream-1', 180_000, {
      model: 'claude-sonnet-4-5',
      cwd: '/custom/path'
    })

    expect(sdk.query).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({ cwd: '/custom/path' })
      })
    )
  })

  it('should restrict tools when specified', async () => {
    await runSdkStreaming('Test', onChunkMock, activeStreams, 'stream-1', 180_000, {
      model: 'claude-sonnet-4-5',
      tools: ['Read', 'Grep']
    })

    expect(sdk.query).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({ tools: ['Read', 'Grep'] })
      })
    )
  })

  it('does NOT pass bypassPermissions when permissionMode is omitted', async () => {
    vi.mocked(sdk.query).mockClear()
    await runSdkStreaming('Test', onChunkMock, activeStreams, 'stream-1', 180_000, {
      model: 'claude-sonnet-4-5'
    })

    const calls = vi.mocked(sdk.query).mock.calls
    const call = calls[calls.length - 1][0] as { options: Record<string, unknown> }
    expect(call.options.permissionMode).toBeUndefined()
    expect(call.options.allowDangerouslySkipPermissions).toBeUndefined()
  })

  it('passes bypassPermissions when the caller explicitly opts in', async () => {
    vi.mocked(sdk.query).mockClear()
    await runSdkStreaming('Test', onChunkMock, activeStreams, 'stream-1', 180_000, {
      model: 'claude-sonnet-4-5',
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true
    })

    const calls = vi.mocked(sdk.query).mock.calls
    const call = calls[calls.length - 1][0] as { options: Record<string, unknown> }
    expect(call.options.permissionMode).toBe('bypassPermissions')
    expect(call.options.allowDangerouslySkipPermissions).toBe(true)
  })

  it('should call onToolUse callback when agent uses tools', async () => {
    const onToolUseMock = vi.fn()

    vi.mocked(sdk.query).mockReturnValue(
      (async function* () {
        yield {
          type: 'assistant',
          message: {
            content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/test.ts' } }]
          }
        }
      })()
    )

    await runSdkStreaming('Test', onChunkMock, activeStreams, 'stream-1', 180_000, {
      model: 'claude-sonnet-4-5',
      onToolUse: onToolUseMock
    })

    expect(onToolUseMock).toHaveBeenCalledWith({
      name: 'Read',
      input: { file_path: '/test.ts' }
    })
  })

  it('should respect maxTurns option', async () => {
    await runSdkStreaming('Test', onChunkMock, activeStreams, 'stream-1', 180_000, {
      model: 'claude-sonnet-4-5',
      maxTurns: 5
    })

    expect(sdk.query).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({ maxTurns: 5 })
      })
    )
  })

  it('should default maxTurns to 1', async () => {
    await runSdkStreaming('Test', onChunkMock, activeStreams, 'stream-1', 180_000, {
      model: 'claude-sonnet-4-5'
    })

    expect(sdk.query).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({ maxTurns: 1 })
      })
    )
  })

  it('should pass settingSources option', async () => {
    await runSdkStreaming('Test', onChunkMock, activeStreams, 'stream-1', 180_000, {
      model: 'claude-sonnet-4-5',
      settingSources: []
    })

    expect(sdk.query).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({ settingSources: [] })
      })
    )
  })

  it('should default settingSources to all sources', async () => {
    await runSdkStreaming('Test', onChunkMock, activeStreams, 'stream-1', 180_000, {
      model: 'claude-sonnet-4-5'
    })

    expect(sdk.query).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({ settingSources: ['user', 'project', 'local'] })
      })
    )
  })

  it('should pass the provided model to the SDK', async () => {
    await runSdkStreaming('Test', onChunkMock, activeStreams, 'stream-1', 180_000, {
      model: 'claude-opus-4-6'
    })

    expect(sdk.query).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({ model: 'claude-opus-4-6' })
      })
    )
  })

  it('requires an explicit model (guards against future drift back to optional)', async () => {
    // @ts-expect-error — model is required; this call omits it on purpose.
    await runSdkStreaming('Test', onChunkMock, activeStreams, 'stream-1', 180_000, {})
  })
})
