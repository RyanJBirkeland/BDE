import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'
import type { AgentEvent } from '../types'

// --- Module mocks ---

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}))

vi.mock('../../settings', () => ({
  getAgentBinary: vi.fn().mockReturnValue('claude'),
  getAgentPermissionMode: vi.fn().mockReturnValue('bypassPermissions'),
}))

import { spawn } from 'child_process'
import { CliProvider } from '../cli-provider'

// --- Helpers ---

function createMockChild(pid: number) {
  const stdout = new EventEmitter()
  const stderr = new EventEmitter()
  const child = Object.assign(new EventEmitter(), {
    pid,
    stdin: { write: vi.fn(), destroyed: false },
    stdout,
    stderr,
    unref: vi.fn(),
    kill: vi.fn(),
  })
  return child
}

describe('CliProvider', () => {
  beforeEach(() => vi.clearAllMocks())

  // ── spawn shape ──────────────────────────────────────────────────────

  it('spawn() returns an AgentHandle with expected shape', async () => {
    vi.mocked(spawn).mockReturnValue(createMockChild(1001) as never)

    const handle = await new CliProvider().spawn({
      prompt: 'test',
      workingDirectory: '/tmp/test',
    })

    expect(handle.id).toBeDefined()
    expect(handle.events).toBeDefined()
    expect(typeof handle.steer).toBe('function')
    expect(typeof handle.stop).toBe('function')
  })

  // ── spawn args ───────────────────────────────────────────────────────

  it('spawns claude with stream-json flags and detached mode', async () => {
    vi.mocked(spawn).mockReturnValue(createMockChild(1002) as never)

    await new CliProvider().spawn({ prompt: 'test', workingDirectory: '/tmp/repo' })

    expect(spawn).toHaveBeenCalledWith(
      'claude',
      expect.arrayContaining([
        '--output-format', 'stream-json',
        '--input-format', 'stream-json',
        '--permission-mode', 'bypassPermissions',
      ]),
      expect.objectContaining({
        cwd: '/tmp/repo',
        detached: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      }),
    )
  })

  it('augments PATH with common CLI install locations', async () => {
    vi.mocked(spawn).mockReturnValue(createMockChild(1003) as never)

    await new CliProvider().spawn({ prompt: 'test', workingDirectory: '/tmp' })

    const opts = vi.mocked(spawn).mock.calls[0][2] as { env: { PATH: string } }
    expect(opts.env.PATH).toContain('/usr/local/bin')
    expect(opts.env.PATH).toContain('/opt/homebrew/bin')
    expect(opts.env.PATH).toContain('.local/bin')
  })

  // ── stdin / prompt ───────────────────────────────────────────────────

  it('sends initial prompt as JSON user message on stdin', async () => {
    const child = createMockChild(1004)
    vi.mocked(spawn).mockReturnValue(child as never)

    await new CliProvider().spawn({ prompt: 'hello world', workingDirectory: '/tmp' })

    const written = child.stdin.write.mock.calls[0][0] as string
    expect(JSON.parse(written.trim())).toEqual({
      type: 'user',
      message: { role: 'user', content: 'hello world' },
    })
  })

  it('prepends templatePrefix to prompt', async () => {
    const child = createMockChild(1005)
    vi.mocked(spawn).mockReturnValue(child as never)

    await new CliProvider().spawn({
      prompt: 'do stuff',
      workingDirectory: '/tmp',
      templatePrefix: 'You are a reviewer.',
    })

    const written = child.stdin.write.mock.calls[0][0] as string
    expect(JSON.parse(written.trim()).message.content).toBe(
      'You are a reviewer.\n\ndo stuff',
    )
  })

  // ── agentId ──────────────────────────────────────────────────────────

  it('uses agentId from options when provided', async () => {
    vi.mocked(spawn).mockReturnValue(createMockChild(1006) as never)

    const handle = await new CliProvider().spawn({
      prompt: 'test',
      workingDirectory: '/tmp',
      agentId: 'my-custom-id',
    })

    expect(handle.id).toBe('my-custom-id')
  })

  it('generates a UUID when agentId is not provided', async () => {
    vi.mocked(spawn).mockReturnValue(createMockChild(1007) as never)

    const handle = await new CliProvider().spawn({
      prompt: 'test',
      workingDirectory: '/tmp',
    })

    expect(handle.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    )
  })

  // ── model mapping ────────────────────────────────────────────────────

  it('maps model "opus" to claude-opus-4-6 flag', async () => {
    vi.mocked(spawn).mockReturnValue(createMockChild(1008) as never)

    await new CliProvider().spawn({
      prompt: 'test',
      workingDirectory: '/tmp',
      model: 'opus',
    })

    const args = vi.mocked(spawn).mock.calls[0][1] as string[]
    expect(args[args.indexOf('--model') + 1]).toBe('claude-opus-4-6')
  })

  it('defaults to claude-sonnet-4-6 for unspecified model', async () => {
    vi.mocked(spawn).mockReturnValue(createMockChild(1009) as never)

    await new CliProvider().spawn({ prompt: 'test', workingDirectory: '/tmp' })

    const args = vi.mocked(spawn).mock.calls[0][1] as string[]
    expect(args[args.indexOf('--model') + 1]).toBe('claude-sonnet-4-6')
  })

  // ── steer ────────────────────────────────────────────────────────────

  it('steer() writes JSON user message to stdin', async () => {
    const child = createMockChild(1010)
    vi.mocked(spawn).mockReturnValue(child as never)

    const handle = await new CliProvider().spawn({
      prompt: 'test',
      workingDirectory: '/tmp',
    })

    await handle.steer('follow up')

    const lastWrite = child.stdin.write.mock.calls.at(-1)![0] as string
    expect(JSON.parse(lastWrite.trim())).toEqual({
      type: 'user',
      message: { role: 'user', content: 'follow up' },
    })
  })

  it('steer() throws when stdin is destroyed', async () => {
    const child = createMockChild(1011)
    vi.mocked(spawn).mockReturnValue(child as never)

    const handle = await new CliProvider().spawn({
      prompt: 'test',
      workingDirectory: '/tmp',
    })

    child.stdin.destroyed = true

    await expect(handle.steer('hello')).rejects.toThrow('stdin')
  })

  // ── stop ─────────────────────────────────────────────────────────────

  it('stop() sends SIGTERM to process', async () => {
    const child = createMockChild(1012)
    vi.mocked(spawn).mockReturnValue(child as never)

    const handle = await new CliProvider().spawn({
      prompt: 'test',
      workingDirectory: '/tmp',
    })

    await handle.stop()

    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
  })

  // ── event stream ─────────────────────────────────────────────────────

  it('events stream parses system event to agent:started', async () => {
    const child = createMockChild(1013)
    vi.mocked(spawn).mockReturnValue(child as never)

    const handle = await new CliProvider().spawn({
      prompt: 'test',
      workingDirectory: '/tmp',
    })

    const events: AgentEvent[] = []
    const done = (async () => {
      for await (const event of handle.events) {
        events.push(event)
      }
    })()

    child.stdout.emit(
      'data',
      Buffer.from(
        JSON.stringify({ type: 'system', model: 'claude-sonnet-4-5' }) + '\n',
      ),
    )
    child.emit('close', 0)
    await done

    expect(events[0]).toMatchObject({ type: 'agent:started', model: 'claude-sonnet-4-5' })
  })

  it('events stream parses assistant text to agent:text', async () => {
    const child = createMockChild(1014)
    vi.mocked(spawn).mockReturnValue(child as never)

    const handle = await new CliProvider().spawn({
      prompt: 'test',
      workingDirectory: '/tmp',
    })

    const events: AgentEvent[] = []
    const done = (async () => {
      for await (const event of handle.events) {
        events.push(event)
      }
    })()

    child.stdout.emit(
      'data',
      Buffer.from(
        JSON.stringify({
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'Hello!' }] },
        }) + '\n',
      ),
    )
    child.emit('close', 0)
    await done

    expect(events.some((e) => e.type === 'agent:text' && e.text === 'Hello!')).toBe(true)
  })

  it('events stream parses tool_use to agent:tool_call', async () => {
    const child = createMockChild(1015)
    vi.mocked(spawn).mockReturnValue(child as never)

    const handle = await new CliProvider().spawn({
      prompt: 'test',
      workingDirectory: '/tmp',
    })

    const events: AgentEvent[] = []
    const done = (async () => {
      for await (const event of handle.events) {
        events.push(event)
      }
    })()

    child.stdout.emit(
      'data',
      Buffer.from(
        JSON.stringify({
          type: 'assistant',
          message: {
            content: [
              { type: 'tool_use', name: 'Read', input: { path: '/tmp/foo' } },
            ],
          },
        }) + '\n',
      ),
    )
    child.emit('close', 0)
    await done

    const toolEvent = events.find((e) => e.type === 'agent:tool_call')
    expect(toolEvent).toBeDefined()
    expect(toolEvent!.type === 'agent:tool_call' && toolEvent!.tool).toBe('Read')
  })

  it('events stream parses result to agent:completed with cost data', async () => {
    const child = createMockChild(1016)
    vi.mocked(spawn).mockReturnValue(child as never)

    const handle = await new CliProvider().spawn({
      prompt: 'test',
      workingDirectory: '/tmp',
    })

    const events: AgentEvent[] = []
    const done = (async () => {
      for await (const event of handle.events) {
        events.push(event)
      }
    })()

    child.stdout.emit(
      'data',
      Buffer.from(
        JSON.stringify({
          type: 'result',
          total_cost_usd: 0.05,
          duration_ms: 12000,
          usage: { input_tokens: 1000, output_tokens: 500 },
        }) + '\n',
      ),
    )
    child.emit('close', 0)
    await done

    const completed = events.find((e) => e.type === 'agent:completed')
    expect(completed).toBeDefined()
    if (completed?.type === 'agent:completed') {
      expect(completed.costUsd).toBe(0.05)
      expect(completed.tokensIn).toBe(1000)
      expect(completed.tokensOut).toBe(500)
      expect(completed.durationMs).toBe(12000)
    }
  })

  it('events stream emits agent:completed on process exit even without result event', async () => {
    const child = createMockChild(1017)
    vi.mocked(spawn).mockReturnValue(child as never)

    const handle = await new CliProvider().spawn({
      prompt: 'test',
      workingDirectory: '/tmp',
    })

    const events: AgentEvent[] = []
    const done = (async () => {
      for await (const event of handle.events) {
        events.push(event)
      }
    })()

    // Close without any stdout events
    child.emit('close', 1)
    await done

    const completed = events.find((e) => e.type === 'agent:completed')
    expect(completed).toBeDefined()
    if (completed?.type === 'agent:completed') {
      expect(completed.exitCode).toBe(1)
    }
  })

  it('events stream unwraps stream_event wrappers', async () => {
    const child = createMockChild(1018)
    vi.mocked(spawn).mockReturnValue(child as never)

    const handle = await new CliProvider().spawn({
      prompt: 'test',
      workingDirectory: '/tmp',
    })

    const events: AgentEvent[] = []
    const done = (async () => {
      for await (const event of handle.events) {
        events.push(event)
      }
    })()

    // Emit wrapped event
    child.stdout.emit(
      'data',
      Buffer.from(
        JSON.stringify({
          type: 'stream_event',
          event: { type: 'system', model: 'claude-sonnet-4-5' },
        }) + '\n',
      ),
    )
    child.emit('close', 0)
    await done

    expect(events[0]).toMatchObject({ type: 'agent:started', model: 'claude-sonnet-4-5' })
  })

  it('events stream handles partial lines split across chunks', async () => {
    const child = createMockChild(1019)
    vi.mocked(spawn).mockReturnValue(child as never)

    const handle = await new CliProvider().spawn({
      prompt: 'test',
      workingDirectory: '/tmp',
    })

    const events: AgentEvent[] = []
    const done = (async () => {
      for await (const event of handle.events) {
        events.push(event)
      }
    })()

    // Split a JSON line across two chunks
    const fullLine = JSON.stringify({ type: 'system', model: 'test-model' })
    child.stdout.emit('data', Buffer.from(fullLine.slice(0, 10)))
    child.stdout.emit('data', Buffer.from(fullLine.slice(10) + '\n'))
    child.emit('close', 0)
    await done

    expect(events[0]).toMatchObject({ type: 'agent:started', model: 'test-model' })
  })

  it('calls child.unref() so parent can exit independently', async () => {
    const child = createMockChild(1020)
    vi.mocked(spawn).mockReturnValue(child as never)

    await new CliProvider().spawn({ prompt: 'test', workingDirectory: '/tmp' })

    expect(child.unref).toHaveBeenCalled()
  })
})
