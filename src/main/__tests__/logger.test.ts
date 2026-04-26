import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock node:fs (callback-based appendFile + sync setup ops)
vi.mock('node:fs', () => ({
  appendFile: vi.fn(),
  existsSync: vi.fn(() => true),
  mkdirSync: vi.fn(),
  chmodSync: vi.fn()
}))

// Mock node:fs/promises (async rotation ops)
vi.mock('node:fs/promises', () => ({
  stat: vi.fn().mockResolvedValue({ size: 100 }),
  rename: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined)
}))

import { createLogger } from '../logger'
import { appendFile, chmodSync } from 'node:fs'
import { stat, rename, rm } from 'node:fs/promises'

/** Flush all pending microtasks (async rotation calls) */
async function flushPromises(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve))
}

describe('logger.event()', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('writes a parseable JSON line to bde.log', () => {
    const logger = createLogger('test-module')
    logger.event('agent.spawn', { taskId: 'abc123', model: 'claude-opus-4-7' })

    const calls = vi.mocked(appendFile).mock.calls
    const eventCall = calls.find((c) => {
      const line = String(c[1])
      return line.includes('"event"')
    })
    expect(eventCall).toBeDefined()
    const parsed = JSON.parse(String(eventCall![1]).trim())
    expect(parsed.event).toBe('agent.spawn')
    expect(parsed.taskId).toBe('abc123')
    expect(parsed.model).toBe('claude-opus-4-7')
    expect(parsed.ts).toBeDefined()
    expect(parsed.level).toBe('INFO')
    expect(parsed.module).toBe('test-module')
  })

  it('does not include missing optional fields', () => {
    const logger = createLogger('test-module')
    logger.event('drain.tick.idle', { tickId: 'x1' })

    const calls = vi.mocked(appendFile).mock.calls
    const eventCall = calls.find((c) => String(c[1]).includes('"drain.tick.idle"'))
    expect(eventCall).toBeDefined()
    const parsed = JSON.parse(String(eventCall![1]).trim())
    expect(parsed.tickId).toBe('x1')
    expect(parsed.taskId).toBeUndefined()
  })

  it('extra fields from the caller pass through to the JSON line', () => {
    const logger = createLogger('test-module')
    logger.event('agent.watchdog.kill', { taskId: 't-1', runtimeMs: 5000, limitMs: 3600000, agentType: 'pipeline', verdict: 'timeout' })

    const calls = vi.mocked(appendFile).mock.calls
    const eventCall = calls.find((c) => String(c[1]).includes('"agent.watchdog.kill"'))
    expect(eventCall).toBeDefined()
    const parsed = JSON.parse(String(eventCall![1]).trim())
    expect(parsed.runtimeMs).toBe(5000)
    expect(parsed.verdict).toBe('timeout')
  })
})

describe('createLogger', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates a logger with info/warn/error methods', () => {
    const logger = createLogger('test')
    expect(logger.info).toBeDefined()
    expect(logger.warn).toBeDefined()
    expect(logger.error).toBeDefined()
  })

  it('applies 0600 mode to the log file on createLogger so tokens are not world-readable', () => {
    createLogger('test')
    expect(chmodSync).toHaveBeenCalledWith(expect.stringContaining('bde.log'), 0o600)
  })

  it('writes new log lines with mode:0o600 so any rotation-created file is tightened', () => {
    const logger = createLogger('test')
    logger.info('hello')
    expect(appendFile).toHaveBeenCalledWith(
      expect.stringContaining('bde.log'),
      expect.any(String),
      expect.objectContaining({ mode: 0o600 }),
      expect.any(Function)
    )
  })

  it('writes to log file with correct format', () => {
    const logger = createLogger('my-module')
    logger.info('hello world')
    expect(appendFile).toHaveBeenCalledWith(
      expect.stringContaining('bde.log'),
      expect.stringMatching(/\[INFO\] \[my-module\] hello world/),
      expect.any(Object),
      expect.any(Function)
    )
  })

  it('includes timestamp in log entries', () => {
    const logger = createLogger('test')
    logger.warn('warning message')
    const call = vi.mocked(appendFile).mock.calls[0]
    expect(String(call[1])).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('renames log to .old when size exceeds MAX_LOG_SIZE', async () => {
    const MAX_LOG_SIZE = 10 * 1024 * 1024
    vi.mocked(stat).mockResolvedValueOnce({ size: MAX_LOG_SIZE + 1 } as Awaited<ReturnType<typeof stat>>)
    createLogger('test')
    await flushPromises()
    expect(rename).toHaveBeenCalledWith(
      expect.stringContaining('bde.log'),
      expect.stringContaining('bde.log.old')
    )
  })

  it('removes existing .old file before renaming', async () => {
    const MAX_LOG_SIZE = 10 * 1024 * 1024
    vi.mocked(stat).mockResolvedValueOnce({ size: MAX_LOG_SIZE + 1 } as Awaited<ReturnType<typeof stat>>)
    createLogger('test')
    await flushPromises()
    expect(rm).toHaveBeenCalledWith(expect.stringContaining('.old'))
    expect(rename).toHaveBeenCalled()
  })

  it('does not rename log when size is within limit', async () => {
    vi.mocked(stat).mockResolvedValueOnce({ size: 100 } as Awaited<ReturnType<typeof stat>>)
    createLogger('test')
    await flushPromises()
    expect(rename).not.toHaveBeenCalled()
  })
})
