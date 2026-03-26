import { describe, it, expect, vi, beforeEach, type MockInstance } from 'vitest'
import { Readable, Writable } from 'node:stream'

// Mock child_process.spawn before importing the module
vi.mock('node:child_process', () => {
  const execFile = vi.fn() as ReturnType<typeof vi.fn> & { [k: symbol]: unknown }
  const { promisify } = require('node:util')
  execFile[promisify.custom] = vi.fn()
  return { spawn: vi.fn(), execFile }
})

// Mock the SDK so we test CLI fallback path
vi.mock('@anthropic-ai/claude-agent-sdk', () => {
  throw new Error('SDK not available')
})

import { spawnAgent } from '../sdk-adapter'
import { spawn } from 'node:child_process'

const mockSpawn = spawn as unknown as MockInstance

function makeMockChild() {
  const stdout = new Readable({ read() {} })
  const stderr = new Readable({ read() {} })
  const stdin = new Writable({
    write(_chunk, _enc, cb) {
      cb()
    }
  })

  vi.spyOn(stdin, 'write')
  const kill = vi.fn()

  const child = {
    stdout,
    stderr,
    stdin,
    kill
  }

  return child
}

describe('spawnAgent (CLI fallback)', () => {
  let child: ReturnType<typeof makeMockChild>

  beforeEach(() => {
    child = makeMockChild()
    mockSpawn.mockReturnValue(child)
  })

  it('returns an AgentHandle with the correct interface', async () => {
    const handle = await spawnAgent({
      prompt: 'Hello',
      cwd: '/tmp',
      model: 'claude-sonnet-4-5'
    })

    expect(handle).toHaveProperty('messages')
    expect(handle).toHaveProperty('sessionId')
    expect(handle).toHaveProperty('abort')
    expect(handle).toHaveProperty('steer')
    expect(typeof handle.sessionId).toBe('string')
    expect(handle.sessionId.length).toBeGreaterThan(0)
    expect(typeof handle.abort).toBe('function')
    expect(typeof handle.steer).toBe('function')
  })

  it('sends the initial prompt via stdin on spawn', async () => {
    await spawnAgent({
      prompt: 'Do the thing',
      cwd: '/tmp',
      model: 'claude-sonnet-4-5'
    })

    expect(child.stdin.write).toHaveBeenCalledOnce()
    const call = (child.stdin.write as unknown as MockInstance).mock.calls[0][0] as string
    const parsed = JSON.parse(call.trim())
    expect(parsed.type).toBe('user')
    expect(parsed.message.content).toBe('Do the thing')
  })

  it('spawns claude CLI with correct flags', async () => {
    await spawnAgent({
      prompt: 'test',
      cwd: '/my/project',
      model: 'claude-opus-4-5'
    })

    expect(mockSpawn).toHaveBeenCalledWith(
      'claude',
      expect.arrayContaining([
        '--output-format',
        'stream-json',
        '--input-format',
        'stream-json',
        '--model',
        'claude-opus-4-5',
        '--permission-mode',
        'bypassPermissions'
      ]),
      expect.objectContaining({ cwd: '/my/project' })
    )
  })

  it('sets ANTHROPIC_API_KEY from OAuth token in env', async () => {
    await spawnAgent({ prompt: 'test', cwd: '/tmp', model: 'claude-sonnet-4-5' })

    const spawnEnv = (mockSpawn as unknown as MockInstance).mock.calls[0][2].env
    // OAuth token is set as ANTHROPIC_API_KEY for agent auth
    expect(spawnEnv).toHaveProperty('ANTHROPIC_API_KEY')
  })

  it('abort() sends SIGTERM to the child process', async () => {
    const handle = await spawnAgent({
      prompt: 'test',
      cwd: '/tmp',
      model: 'claude-sonnet-4-5'
    })

    handle.abort()

    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
  })

  it('steer() sends a message via stdin', async () => {
    const handle = await spawnAgent({
      prompt: 'initial',
      cwd: '/tmp',
      model: 'claude-sonnet-4-5'
    })

    // Reset the mock to isolate steer call
    ;(child.stdin.write as unknown as MockInstance).mockClear()

    await handle.steer('follow-up message')

    expect(child.stdin.write).toHaveBeenCalledOnce()
    const call = (child.stdin.write as unknown as MockInstance).mock.calls[0][0] as string
    const parsed = JSON.parse(call.trim())
    expect(parsed.type).toBe('user')
    expect(parsed.message.content).toBe('follow-up message')
  })

  it('messages AsyncIterable yields parsed JSON lines from stdout', async () => {
    const handle = await spawnAgent({
      prompt: 'test',
      cwd: '/tmp',
      model: 'claude-sonnet-4-5'
    })

    const collected: unknown[] = []
    const iterPromise = (async () => {
      for await (const msg of handle.messages) {
        collected.push(msg)
      }
    })()

    // Push lines to stdout Readable
    child.stdout.push(Buffer.from('{"type":"assistant","text":"hello"}\n'))
    child.stdout.push(Buffer.from('{"type":"result","subtype":"success"}\n'))
    child.stdout.push(null) // EOF

    await iterPromise

    expect(collected).toHaveLength(2)
    expect(collected[0]).toEqual({ type: 'assistant', text: 'hello' })
    expect(collected[1]).toEqual({ type: 'result', subtype: 'success' })
  })

  it('calls onStderr callback for each stderr line', async () => {
    const handle = await spawnAgent({
      prompt: 'test',
      cwd: '/tmp',
      model: 'claude-sonnet-4-5'
    })

    const stderrLines: string[] = []
    handle.onStderr = (line: string) => stderrLines.push(line)

    // Push stderr data
    child.stderr.push(Buffer.from('Warning: deprecated API\nError: something failed\n'))
    child.stderr.push(null) // EOF

    // Allow event handlers to fire
    await new Promise((r) => setTimeout(r, 50))

    expect(stderrLines).toEqual(['Warning: deprecated API', 'Error: something failed'])
  })

  it('does not call onStderr for empty/whitespace-only lines', async () => {
    const handle = await spawnAgent({
      prompt: 'test',
      cwd: '/tmp',
      model: 'claude-sonnet-4-5'
    })

    const stderrLines: string[] = []
    handle.onStderr = (line: string) => stderrLines.push(line)

    child.stderr.push(Buffer.from('real output\n   \n\n'))
    child.stderr.push(null) // EOF

    await new Promise((r) => setTimeout(r, 50))

    expect(stderrLines).toEqual(['real output'])
  })

  it('handles stderr chunks that split across lines', async () => {
    const handle = await spawnAgent({
      prompt: 'test',
      cwd: '/tmp',
      model: 'claude-sonnet-4-5'
    })

    const stderrLines: string[] = []
    handle.onStderr = (line: string) => stderrLines.push(line)

    // Split a line across two chunks
    child.stderr.push(Buffer.from('partial li'))
    child.stderr.push(Buffer.from('ne one\nline two\n'))
    child.stderr.push(null) // EOF

    await new Promise((r) => setTimeout(r, 50))

    expect(stderrLines).toEqual(['partial line one', 'line two'])
  })

  it('flushes remaining stderr buffer on end', async () => {
    const handle = await spawnAgent({
      prompt: 'test',
      cwd: '/tmp',
      model: 'claude-sonnet-4-5'
    })

    const stderrLines: string[] = []
    handle.onStderr = (line: string) => stderrLines.push(line)

    // Push data without trailing newline
    child.stderr.push(Buffer.from('no trailing newline'))
    child.stderr.push(null) // EOF

    await new Promise((r) => setTimeout(r, 50))

    expect(stderrLines).toEqual(['no trailing newline'])
  })

  it('messages AsyncIterable skips non-JSON lines', async () => {
    const handle = await spawnAgent({
      prompt: 'test',
      cwd: '/tmp',
      model: 'claude-sonnet-4-5'
    })

    const collected: unknown[] = []
    const iterPromise = (async () => {
      for await (const msg of handle.messages) {
        collected.push(msg)
      }
    })()

    child.stdout.push(Buffer.from('not json\n{"type":"ok"}\n'))
    child.stdout.push(null) // EOF

    await iterPromise

    expect(collected).toHaveLength(1)
    expect(collected[0]).toEqual({ type: 'ok' })
  })
})
