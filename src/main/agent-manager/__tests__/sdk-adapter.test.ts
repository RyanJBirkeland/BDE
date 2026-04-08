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

// Mock env-utils so getOAuthToken returns a token on CI
vi.mock('../../env-utils', () => ({
  getOAuthToken: vi.fn().mockReturnValue('test-oauth-token'),
  buildAgentEnv: vi.fn().mockReturnValue({ PATH: '/usr/bin', HOME: '/home/test' }),
  buildAgentEnvWithAuth: vi.fn().mockReturnValue({
    PATH: '/usr/bin',
    HOME: '/home/test',
    ANTHROPIC_API_KEY: 'test-oauth-token'
  }),
  invalidateOAuthToken: vi.fn(),
  refreshOAuthTokenFromKeychain: vi.fn().mockResolvedValue(false)
}))

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
    kill,
    on: vi.fn()
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

  it('spawns claude CLI with correct flags (AM-1: no bypassPermissions)', async () => {
    await spawnAgent({
      prompt: 'test',
      cwd: '/my/project',
      model: 'claude-opus-4-5'
    })

    const callArgs = mockSpawn.mock.calls[0]
    const flags = callArgs[1] as string[]

    expect(mockSpawn).toHaveBeenCalledWith(
      'claude',
      expect.arrayContaining([
        '--output-format',
        'stream-json',
        '--input-format',
        'stream-json',
        '--model',
        'claude-opus-4-5'
      ]),
      expect.objectContaining({ cwd: '/my/project' })
    )

    // AM-1: Verify bypassPermissions is NOT present
    expect(flags).not.toContain('bypassPermissions')
    expect(flags).not.toContain('--permission-mode')
  })

  it('sets ANTHROPIC_API_KEY from OAuth token in env for CLI (AM-2)', async () => {
    await spawnAgent({ prompt: 'test', cwd: '/tmp', model: 'claude-sonnet-4-5' })

    const spawnEnv = (mockSpawn as unknown as MockInstance).mock.calls[0][2].env
    // AM-2: For CLI fallback, OAuth token is set as ANTHROPIC_API_KEY
    // (CLI doesn't support apiKey parameter)
    expect(spawnEnv).toHaveProperty('ANTHROPIC_API_KEY')
  })

  it('caps V8 old-space heap via NODE_OPTIONS for CLI fallback (PHASE3-3.1)', async () => {
    await spawnAgent({ prompt: 'test', cwd: '/tmp', model: 'claude-sonnet-4-5' })

    const spawnEnv = (mockSpawn as unknown as MockInstance).mock.calls[0][2].env
    expect(spawnEnv.NODE_OPTIONS).toBeDefined()
    expect(spawnEnv.NODE_OPTIONS).toContain('--max-old-space-size=1024')
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
    await vi.waitFor(() => expect(stderrLines.length).toBe(2), { timeout: 1000 })

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

    await vi.waitFor(() => expect(stderrLines.length).toBe(1), { timeout: 1000 })

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

    await vi.waitFor(() => expect(stderrLines.length).toBe(2), { timeout: 1000 })

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

    await vi.waitFor(() => expect(stderrLines.length).toBe(1), { timeout: 1000 })

    expect(stderrLines).toEqual(['no trailing newline'])
  })

  it('sets maxListeners=5 on child.stderr to prevent MaxListenersExceededWarning (F-t1-sre-2)', async () => {
    await spawnAgent({
      prompt: 'test',
      cwd: '/tmp',
      model: 'claude-sonnet-4-5'
    })

    // stderr is a real Readable — setMaxListeners should have been called
    expect(child.stderr.getMaxListeners()).toBe(5)
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

describe('withMaxOldSpaceOption (PHASE3-3.1)', () => {
  it('returns the flag alone when no existing NODE_OPTIONS', async () => {
    const { withMaxOldSpaceOption } = await import('../sdk-adapter')
    expect(withMaxOldSpaceOption(undefined, 1024)).toBe('--max-old-space-size=1024')
    expect(withMaxOldSpaceOption('', 1024)).toBe('--max-old-space-size=1024')
    expect(withMaxOldSpaceOption('   ', 1024)).toBe('--max-old-space-size=1024')
  })

  it('appends to existing NODE_OPTIONS without removing them', async () => {
    const { withMaxOldSpaceOption } = await import('../sdk-adapter')
    expect(withMaxOldSpaceOption('--enable-source-maps', 1024)).toBe(
      '--enable-source-maps --max-old-space-size=1024'
    )
  })

  it('does not duplicate when caller already specified --max-old-space-size', async () => {
    const { withMaxOldSpaceOption } = await import('../sdk-adapter')
    expect(withMaxOldSpaceOption('--max-old-space-size=2048', 1024)).toBe(
      '--max-old-space-size=2048'
    )
  })
})
