import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock fs before import
vi.mock('node:fs', () => ({
  appendFileSync: vi.fn(),
  statSync: vi.fn(() => ({ size: 100 })),
  existsSync: vi.fn(() => true),
  mkdirSync: vi.fn(),
  renameSync: vi.fn(),
  rmSync: vi.fn(),
  chmodSync: vi.fn()
}))

import { createLogger } from '../logger'
import { appendFileSync, statSync, renameSync, rmSync, chmodSync } from 'node:fs'

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
    expect(appendFileSync).toHaveBeenCalledWith(
      expect.stringContaining('bde.log'),
      expect.any(String),
      expect.objectContaining({ mode: 0o600 })
    )
  })

  it('writes to log file with correct format', () => {
    const logger = createLogger('my-module')
    logger.info('hello world')
    expect(appendFileSync).toHaveBeenCalledWith(
      expect.stringContaining('bde.log'),
      expect.stringMatching(/\[INFO\] \[my-module\] hello world/),
      expect.any(Object)
    )
  })

  it('includes timestamp in log entries', () => {
    const logger = createLogger('test')
    logger.warn('warning message')
    const call = vi.mocked(appendFileSync).mock.calls[0]
    // Timestamp format: 2026-03-25T...
    expect(call[1]).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('renames log to .old when size exceeds MAX_LOG_SIZE', () => {
    const MAX_LOG_SIZE = 10 * 1024 * 1024 // 10MB
    vi.mocked(statSync).mockReturnValueOnce({ size: MAX_LOG_SIZE + 1 } as ReturnType<
      typeof statSync
    >)
    createLogger('test')
    expect(renameSync).toHaveBeenCalledWith(
      expect.stringContaining('bde.log'),
      expect.stringContaining('bde.log.old')
    )
  })

  it('removes existing .old file before renaming', () => {
    const MAX_LOG_SIZE = 10 * 1024 * 1024 // 10MB
    vi.mocked(statSync).mockReturnValueOnce({ size: MAX_LOG_SIZE + 1 } as ReturnType<
      typeof statSync
    >)
    createLogger('test')
    expect(rmSync).toHaveBeenCalledWith(expect.stringContaining('bde.log.old'))
    expect(renameSync).toHaveBeenCalled()
  })

  it('does not rename log when size is within limit', () => {
    vi.mocked(statSync).mockReturnValueOnce({ size: 100 } as ReturnType<typeof statSync>)
    createLogger('test')
    expect(renameSync).not.toHaveBeenCalled()
  })
})
