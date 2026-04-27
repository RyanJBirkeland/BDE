import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const spawnFleetAgentMock = vi.fn()

vi.mock('rbt-coding-agent/adapters/fleet', () => ({
  spawnFleetAgent: spawnFleetAgentMock
}))

import { spawnLocalAgent } from '../local-adapter'

function fakeHandle() {
  return {
    sessionId: 'fake-session',
    messages: (async function* () {
      yield { type: 'system', session_id: 'fake-session' }
    })(),
    abort: () => {},
    steer: async () => ({ delivered: false })
  }
}

describe('spawnLocalAgent', () => {
  const previousBase = process.env.OPENAI_API_BASE

  beforeEach(() => {
    spawnFleetAgentMock.mockReset()
    spawnFleetAgentMock.mockResolvedValue(fakeHandle())
  })

  afterEach(() => {
    if (previousBase === undefined) delete process.env.OPENAI_API_BASE
    else process.env.OPENAI_API_BASE = previousBase
  })

  it('forwards prompt / cwd / model to spawnFleetAgent', async () => {
    await spawnLocalAgent({
      prompt: 'do the thing',
      cwd: '/tmp/work',
      model: 'openai/qwen/qwen3.6-35b-a3b',
      endpoint: 'http://localhost:1234/v1'
    })
    expect(spawnFleetAgentMock).toHaveBeenCalledWith({
      prompt: 'do the thing',
      cwd: '/tmp/work',
      model: 'openai/qwen/qwen3.6-35b-a3b'
    })
  })

  it('sets OPENAI_API_BASE during the spawn call', async () => {
    let observed: string | undefined
    spawnFleetAgentMock.mockImplementation(async () => {
      observed = process.env.OPENAI_API_BASE
      return fakeHandle()
    })
    await spawnLocalAgent({
      prompt: 'p',
      cwd: '/tmp/w',
      model: 'm',
      endpoint: 'http://test-endpoint:9999/v1'
    })
    expect(observed).toBe('http://test-endpoint:9999/v1')
  })

  it('restores the previous OPENAI_API_BASE after the spawn call', async () => {
    process.env.OPENAI_API_BASE = 'http://original:1234/v1'
    await spawnLocalAgent({
      prompt: 'p',
      cwd: '/tmp/w',
      model: 'm',
      endpoint: 'http://overridden:9999/v1'
    })
    expect(process.env.OPENAI_API_BASE).toBe('http://original:1234/v1')
  })

  it('unsets OPENAI_API_BASE after the call when it was unset beforehand', async () => {
    delete process.env.OPENAI_API_BASE
    await spawnLocalAgent({
      prompt: 'p',
      cwd: '/tmp/w',
      model: 'm',
      endpoint: 'http://overridden:9999/v1'
    })
    expect(process.env.OPENAI_API_BASE).toBeUndefined()
  })

  it('propagates errors from spawnFleetAgent', async () => {
    spawnFleetAgentMock.mockRejectedValue(new Error('preflight blew up'))
    await expect(
      spawnLocalAgent({
        prompt: 'p',
        cwd: '/tmp/w',
        model: 'm',
        endpoint: 'http://localhost:1234/v1'
      })
    ).rejects.toThrow('preflight blew up')
  })

  it('restores OPENAI_API_BASE even when spawnFleetAgent throws', async () => {
    process.env.OPENAI_API_BASE = 'http://original:1234/v1'
    spawnFleetAgentMock.mockRejectedValue(new Error('boom'))
    await expect(
      spawnLocalAgent({
        prompt: 'p',
        cwd: '/tmp/w',
        model: 'm',
        endpoint: 'http://overridden:9999/v1'
      })
    ).rejects.toThrow('boom')
    expect(process.env.OPENAI_API_BASE).toBe('http://original:1234/v1')
  })
})
