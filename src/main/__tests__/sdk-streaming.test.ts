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
    const result = await runSdkStreaming('Test prompt', onChunkMock, activeStreams, 'stream-1')

    expect(onChunkMock).toHaveBeenCalledWith('Hello world')
    expect(result).toBe('Hello world')
  })

  it('should use provided cwd option', async () => {
    await runSdkStreaming('Test', onChunkMock, activeStreams, 'stream-1', 180_000, {
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
      tools: ['Read', 'Grep']
    })

    expect(sdk.query).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({ tools: ['Read', 'Grep'] })
      })
    )
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
      onToolUse: onToolUseMock
    })

    expect(onToolUseMock).toHaveBeenCalledWith({
      name: 'Read',
      input: { file_path: '/test.ts' }
    })
  })

  it('should respect maxTurns option', async () => {
    await runSdkStreaming('Test', onChunkMock, activeStreams, 'stream-1', 180_000, { maxTurns: 5 })

    expect(sdk.query).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({ maxTurns: 5 })
      })
    )
  })

  it('should default maxTurns to 1', async () => {
    await runSdkStreaming('Test', onChunkMock, activeStreams, 'stream-1')

    expect(sdk.query).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({ maxTurns: 1 })
      })
    )
  })

  it('should pass settingSources option', async () => {
    await runSdkStreaming('Test', onChunkMock, activeStreams, 'stream-1', 180_000, {
      settingSources: []
    })

    expect(sdk.query).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({ settingSources: [] })
      })
    )
  })

  it('should default settingSources to all sources', async () => {
    await runSdkStreaming('Test', onChunkMock, activeStreams, 'stream-1')

    expect(sdk.query).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({ settingSources: ['user', 'project', 'local'] })
      })
    )
  })
})
